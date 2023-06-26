const { CloudFormation, Lambda, SSM, IAM } = require('aws-sdk');

const logger = require('../../shared/logger');
const { getServiceName } = require('../../shared/env');

const mirrorHandlerPath = '/opt/lambda-mirror.handler';


const lambda = new Lambda({ region: `${process.env.AWS_REGION}` });
const ssm = new SSM({ region: `${process.env.AWS_REGION}` });
const iam = new IAM({ region: `${process.env.AWS_REGION}` });

// * ----- Type Definitions -----
/**
 * Represents a Lambda resource.
 * @typedef {Object} LambdaResource
 * @property {string} name - The name of the Lambda function.
 * @property {Object} config - The configuration of the Lambda function.
 */
/**
 * @typedef {Object} GoferLayerCheckResult
 * @property {boolean} goferLayerExists - Whether the Gofer layer exists in the lambda resource's configuration.
 * @property {boolean} latestGoferLayerExists - Whether the latest version of the Gofer layer exists in the lambda resource's configuration.
 */
// * ----------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getEnvName = async () => {
  try {
    const {
      Parameter: { Value: accountName },
    } = await ssm.getParameter({ Name: '/devops/personal-account-name' }).promise();
    return accountName;
  } catch (error) {
    logger.error('failed fetching ssm /devops/personal-account-name');
    throw error;
  }
};

/**
 * Gets the stack status of the CloudFormation stack associated with a given service.
 *
 * @async
 * @param {string} serviceName - The name of the service to get the stack status for.
 * @returns {Promise<string|null>} A promise that resolves with the status of the CloudFormation stack, or `null` if an error occurred.
 *
 *  Possible status values include:
 * - `"CREATE_IN_PROGRESS"`
 * - `"CREATE_FAILED"`
 * - `"CREATE_COMPLETE"`
 * - `"ROLLBACK_IN_PROGRESS"`
 * - `"ROLLBACK_FAILED"`
 * - `"ROLLBACK_COMPLETE"`
 * - `"DELETE_IN_PROGRESS"`
 * - `"DELETE_FAILED"`
 * - `"DELETE_COMPLETE"`
 * - `"UPDATE_IN_PROGRESS"`
 * - `"UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"`
 * - `"UPDATE_COMPLETE"`
 * - `"UPDATE_ROLLBACK_IN_PROGRESS"`
 * - `"UPDATE_ROLLBACK_FAILED"`
 * - `"UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS"`
 * - `"UPDATE_ROLLBACK_COMPLETE"`
 */
const getStackStatus = async (StackName) => {
  const cloudFormation = new CloudFormation({ region: `${process.env.AWS_REGION}`});
  try {
    const { Stacks } = await cloudFormation.describeStacks({ StackName }).promise();
    return Stacks ? Stacks[0].StackStatus : null;
  } catch (error) {
    logger.error(`failed to fetch stack status: ${error.message}`);
    return null;
  }
};

/**
 * Retrieves a list of all resources in the stack with the given service name.
 *
 * @async
 * @param {string} [stackName=''] - The name of the service to get the stack resources for.
 * @throws {Error} Will throw an error if the stack is not in the UPDATE_COMPLETE or CREATE_COMPLETE state.
 * @returns {Promise<Array<Object>>} - An array of objects representing the stack resources.
 */
const listStackResources = async (stackName) => {
  const cloudFormation = new CloudFormation({ region: `${process.env.AWS_REGION}`});
  const stackStatus = await getStackStatus(stackName);
  if ( !stackStatus.includes('COMPLETE') || stackStatus.includes('IN_PROGRESS')) {
    throw new Error(
      `${stackName} is in ${stackStatus} state. Please redeploy or wait for UPDATE_COMPLETE/CREATE_COMPLETE state to proceed.`
    );
  }

  const stackResources = [];
  let nextToken;

  while (true) {
    try {
      const { StackResourceSummaries, NextToken } = await cloudFormation
        .listStackResources({
          StackName: stackName,
          NextToken: nextToken,
        })
        .promise();

      stackResources.push(...StackResourceSummaries);
      if (!NextToken || !StackResourceSummaries.length) break;

      nextToken = NextToken;
    } catch (error) {
      logger.error('Failed to list stack resources:', error);
      throw error;
    }
  }

  return stackResources;
};

const getFunctionConfiguration = async (FunctionName) => {
  logger.debug(`fetching config for ${FunctionName}`);
  const lambda = new Lambda({ region: `${process.env.AWS_REGION}` });
  try {
    return lambda.getFunctionConfiguration({ FunctionName }).promise();
  } catch (error) {
    logger.error(`FAILED fetching config for ${FunctionName}`);
  }
}

/**
 * Saves the Physical Resource IDs of the Gofer stack resources into environment variables.
 *
 * @param {Array<{ LogicalResourceId: string, PhysicalResourceId: string }>} NLDResources - An array of objects containing the LogicalResourceId and PhysicalResourceId of each Gofer stack resource.
 * @throws {Error} - Throws an error if any of the required Gofer stack resources are missing.
 * @returns {void}
 */
const saveNLDResourcesRefs = async (NLDResources) => {
  for (const { LogicalResourceId, PhysicalResourceId } of NLDResources) {
    if (LogicalResourceId === 'MirrorCachingTable') {
      process.env.DYNAMO_MIRROR_TABLE_REF = PhysicalResourceId;
      logger.debug(`diger dynamo table name: ${PhysicalResourceId}`);
    } else if (LogicalResourceId.includes('digerLayer')) {
      process.env.DIGER_LAYER_REF = PhysicalResourceId;
    } else if (LogicalResourceId === 'LambdaDynamoPolicy') {
      process.env.DIGER_LAYER_REF_DYNAMO_POLICY_REF = PhysicalResourceId;
    }
  }
  if (!process.env.DYNAMO_MIRROR_TABLE_REF || !process.env.DIGER_LAYER_REF || !process.env.DIGER_DYNAMO_POLICY_REF) {
    const missingResources = [];
    missingResources.push(`dynamo: ${process.env.DYNAMO_MIRROR_TABLE_REF}`);
    missingResources.push(`DIGER layer: ${process.env.DIGER_LAYER_REF}`);
    missingResources.push(`dynamo policy: ${process.env.DIGER_DYNAMO_POLICY_REF}`);
    const errorMsg = `Missing DIGER stack resources!\nPlease verify DIGER was deployed to the this account\t${missingResources.join('\n\t')}\n\tExiting...`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
};

/**
 * Checks whether the Gofer layer exists in the given Lambda function's configuration.
 *
 * @param {LambdaResource} lambdaResource - The Lambda function resource to check.
 * @returns {GoferLayerCheckResult} `{ goferLayerExists, latestGoferLayerExists }` - An object containing the results of the Gofer layer existence check.
 */
const checkGoferExists = (lambdaResource) => {
  const [goferLayerExists, latestGoferLayerExists] = ['DIGERLayer', process.env.DIGER_LAYER_REF].map((layerName) =>
    lambdaResource.config?.Layers?.some((layer) => layer.Arn.includes(layerName))
  );
  logger.debug(`${lambdaResource.name} - DIGER layer exists: ${Boolean(goferLayerExists)}`);
  logger.debug(`${lambdaResource.name} - latest version of DIGER layer exists: ${Boolean(latestGoferLayerExists)}`);
  return { goferLayerExists, latestGoferLayerExists };
};

/**
 * Finds the IAM role name associated with the given Lambda resource.
 *
 * @param {object} params - The input parameters for the function.
 * @param {LambdaResource} params.lambdaResource - The AWS Lambda resource to find the associated IAM role name for.
 * @param {Array<object>} params.stackResources - An array of AWS CloudFormation stack resources.
 * @returns {string|undefined} The IAM role name if found, otherwise undefined.
 *
 */
const findRoleName = (lambdaResource) => {
  const roleString = lambdaResource?.config?.Role || null;
  return roleString ? roleString.substring(roleString.lastIndexOf('/')+1) : null ;
};

const fetchLambdaIDs = async (stackName, manualMapping) => {

  let lambdaResources = [];

  if (stackName){
    // Get the stack's Lambda function resources and filter by manual mapping if it exists
    const stackResources = await listStackResources(stackName);
    lambdaResources = stackResources?.filter((resource) => {
      if (!manualMapping) {
        return resource.ResourceType === 'AWS::Lambda::Function';
      } else {
        return manualMapping.hasOwnProperty(resource.LogicalResourceId);
      }
    });
  }else{
    // map lambdas directly from manual mapping
    Object.keys(manualMapping).forEach((lambdaName) => {lambdaResources.push({LogicalResourceId: lambdaName, PhysicalResourceId:lambdaName})});
  }
  return lambdaResources;
}


const fetchLambdaConfig = async (lambdaResources) => {
  return await Promise.all(
    lambdaResources?.map(async ({ LogicalResourceId, PhysicalResourceId }) => {
      const config = await getFunctionConfiguration(PhysicalResourceId);
      return { name: LogicalResourceId, config };
    })
  );
}

const bindToLambdas = async (stackName, manualMapping) => {

  const lambdaResources = await fetchLambdaIDs(stackName, manualMapping);

  /**
   * Updates the policy of the IAM role associated with the specified Lambda function, by attaching the Gofer DynamoDB policy.
   *
   * @param {LambdaResource} lambdaResource - The Lambda resource to update.   *
   * @returns {Promise<void>} A Promise that resolves when the policy has been updated successfully, or rejects with an error.
   * If the IAM role associated with the Lambda function cannot be found, the function logs an error and returns void.
   */
  const updateLambdaPolicy = async (lambdaResource) => {
    logger.debug(`updating policy of ${lambdaResource.name}`);

    const roleName = findRoleName(lambdaResource);

    if (!roleName) {
      logger.error(`Could not find IAM role for ${lambdaResource.name}`);
      return;
    }

    const policyParams = {
      PolicyArn: process.env.DIGER_DYNAMO_POLICY_REF,
      RoleName: roleName,
    };

    try {
      await iam.attachRolePolicy(policyParams).promise();
    } catch (error) {
      logger.error(`Failed to update role ${roleName} of ${lambdaResource.name}`);
    }
  };

  /**
   * Updates the configuration of a Lambda function by adding a layer, environment variables, and a policy.
   *
   * @async
   * @param {LambdaResource} lambdaResource - The Lambda resource to update.
   * @returns {Promise<void>} A promise that resolves when the Lambda function has been updated.
   * @throws {Error} Throws an error if the Lambda function could not be updated.
   */
  const updateLambdaConfig = async (lambdaResource) => {
    const { goferLayerExists, latestGoferLayerExists } = checkGoferExists(lambdaResource);
    const lambda = new Lambda({ region: `${process.env.AWS_REGION}` });

    const getLayers = (lambdaResource) => {
      const { config: lambdaConfig, name: lambdaName } = lambdaResource;
      const DIGER_LAYER_REF = process.env.DIGER_LAYER_REF;

      if (!lambdaConfig.hasOwnProperty(`Layers`)) {
        return [DIGER_LAYER_REF];
      }
      const { Layers: lambdaLayers } = lambdaConfig;

      if (latestGoferLayerExists) {
        return lambdaLayers.map((layer) => layer.Arn); // no need to update layers
      }
      if (goferLayerExists) {
        return [...lambdaLayers.map((layer) => (layer.Arn.includes('digerLayer') ? DIGER_LAYER_REF : layer.Arn))];
      }
      if (lambdaLayers.length === 5) {
        logger.error(`failed binding Gofer to ${lambdaName}: lambda has max number of allowed layers!`);
        return null; // can't add layer
      }
      return [...lambdaLayers.map((layer) => layer.Arn), DIGER_LAYER_REF];
    };

    const updatedLayers = getLayers(lambdaResource);
    if (!updatedLayers) return;

    //update the lambda only if it's not up to date
    const lambdaEnvVars = lambdaResource.config.Environment.Variables;
    const stringifiedLambdaEnvVars = JSON.stringify(lambdaEnvVars);

    const isUpdateRequired =
      !latestGoferLayerExists ||
      lambdaResource.config.Handler !== mirrorHandlerPath ||
      !stringifiedLambdaEnvVars.includes(process.env.DYNAMO_MIRROR_TABLE_REF) ||
      !stringifiedLambdaEnvVars.includes(lambdaResource.name) ||
      !stringifiedLambdaEnvVars.includes('ORIGINAL_HANDLER');

    if (isUpdateRequired) {
      logger.debug(`Updating config of ${lambdaResource.name}`);
      const configParams = {
        FunctionName: lambdaResource.config.FunctionArn,
        Environment: {
          Variables: {
            ...lambdaEnvVars,
            DYNAMO_MIRROR_TABLE_REF: process.env.DYNAMO_MIRROR_TABLE_REF,
            LAMBDA_MIRROR_NAME: lambdaResource.name,
            ORIGINAL_HANDLER: lambdaEnvVars.hasOwnProperty('ORIGINAL_HANDLER')
              ? lambdaEnvVars['ORIGINAL_HANDLER']
              : lambdaResource.config.Handler,
            STACK_NAME: process.env.STACK_NAME,
          },
        },
        Handler: mirrorHandlerPath,
        Layers: updatedLayers,
      };
      try {
        await lambda.updateFunctionConfiguration(configParams).promise();
        await sleep(1000);
        await updateLambdaPolicy(lambdaResource);
        logger.debug(`Successfully updated config and policy of ${lambdaResource.name}`);
      } catch (error) {
        const message =
          `failed to update lambda config ${lambdaResource.config.FunctionArn} error: ${error} ` +
          (JSON.stringify(error).includes('Rate exceeded')
            ? '\nGOFER FAILED DUE TO AWS REQUEST LIMITS. TRY AGAIN LATER'
            : '');
        throw new Error(message);
      }
    } else {
      logger.debug(`No config change required for ${lambdaResource.name}`);
    }
  };

  /**
   * Updates the configuration of a Lambda function if it doesn't have the Gofer layer,
   * or creates a new version with the Gofer layer and updates the function alias if it exists.
   *
   * @async
   * @function updateLambda
   * @param {LambdaResource} lambdaResource - The Lambda resource to update.
   * @returns {Promise<void>} - A Promise that resolves when the Lambda function is updated or a new version is created.
   * @throws {Error} - If an error occurs while updating or publishing the Lambda function.
   */

  const updateLambda = async (lambdaResource) => {
    const { FunctionArn } = lambdaResource.config;
    const lambda = new Lambda({ region: `${process.env.AWS_REGION}` });
    const aliases = await lambda.listAliases({ FunctionName: FunctionArn }).promise();

    // If there are aliases, create a new version if existing doesn't have Gofer layer
    if (aliases?.Aliases.length) {
      const { FunctionVersion } = aliases.Aliases[0];

      const { Configuration: lambdaVersionConfig } = await lambda
        .getFunction({ FunctionName: `${FunctionArn}:${FunctionVersion}` })
        .promise();

      // Check if the Gofer layer exists in the alias
      const { goferLayerExists, latestGoferLayerExists } = checkGoferExists({
        name: `${lambdaVersionConfig.FunctionName}, version: ${lambdaVersionConfig.Version}`,
        config: lambdaVersionConfig,
      });

      if (!goferLayerExists || !latestGoferLayerExists) {
        try {
          await updateLambdaConfig(lambdaResource);
          await sleep(1000);
          const publishedRes = await lambda.publishVersion({ FunctionName: FunctionArn }).promise();
          await lambda
            .updateAlias({
              FunctionName: FunctionArn,
              Name: aliases.Aliases[0].Name,
              FunctionVersion: publishedRes.Version,
            })
            .promise();
        } catch (error) {
          logger.error(`Failed to publish a new version for ${lambdaResource.name}: ${error}`);
          throw error;
        }
      }
    } else {
      // If there are no aliases, update the lambda directly
      await updateLambdaConfig(lambdaResource);
    }
  };

  const lambdasToUpdate = await fetchLambdaConfig(lambdaResources);

  // Update each Lambda function
  await Promise.all(lambdasToUpdate.map(updateLambda));
};

const detachFromLambdas = async (stackName, manualMapping) => {
  
  const lambda = new Lambda({ region: `${process.env.AWS_REGION}` });

  const lambdaResources = await fetchLambdaIDs(stackName, manualMapping);
  const lambdasToUpdate = await fetchLambdaConfig(lambdaResources);

  const revertLambdaConfig = async (lambdaResource) => {
    const { config } = lambdaResource;
    const originalHandler = config.Environment.Variables['ORIGINAL_HANDLER'];

    if (!originalHandler) {
      return;
    }

    const Layers = (config.Layers || []).filter((layer) => !layer.Arn.includes('digerLayer')).map((layer) => layer.Arn);

    const params = {
      FunctionName: config.FunctionArn,
      Handler: originalHandler,
      Layers,
    };

    try {
      await lambda.updateFunctionConfiguration(params).promise();
    } catch (error) {
      const errorMsg = `failed to update lambda config ${config.FunctionArn} error: ${error.message}`;
      logger.error(errorMsg);
      throw Error(errorMsg);
    }
  };

  const revertLambdaPolicy = async (lambdaResource) => {
    const roleName = findRoleName(lambdaResource);

    if (!roleName) {
      logger.error(`Could not find IAM role for ${lambdaResource.name}`);
      return;
    }

    const params = {
      PolicyArn: process.env.DIGER_DYNAMO_POLICY_REF,
      RoleName: roleName,
    };

    try {
      await iam.detachRolePolicy(params).promise();
      logger.info(`removed DIGER from ${lambdaResource.name}`);
    } catch (error) {
      if (error.code.includes('NoSuchEntity')) {
        logger.info(`removed DIGER from ${lambdaResource.name}`);
      } else {
        logger.error(`failed to update role ${roleName} of ${lambdaResource.name}`);
      }
    }
  };

  await Promise.all(
    lambdasToUpdate.map(async (lambdaResource) => {
      await revertLambdaConfig(lambdaResource);
      await revertLambdaPolicy(lambdaResource);
    })
  );

  logger.info('DIGER DETACHED');
};

module.exports = {
  saveNLDResourcesRefs,
  bindToLambdas,
  getStackStatus,
  getEnvName,
  listStackResources,
  getFunctionConfiguration,
  detachFromLambdas,
};
