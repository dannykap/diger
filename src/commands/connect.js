const logger = require('../shared/logger');
const { mapHandlers } = require('./utils/sam-template');
const { isApiRequest, requireUncached } = require('../shared/helpers');
const { populateEnvVars, loadConfigParams, loadLambdaMapping } = require('./utils/env-vars');
const { invokeCleanupAll, startListeningToEvents } = require('../shared/communication');
const { INVOKE_STATUS, LAMBDA_NAME_KEY } = require('../shared/consts');
const { getServiceName } = require('../shared/env');
const { listStackResources, saveNLDResourcesRefs, bindToLambdas } = require('./utils/stacks');

const AWS = require('aws-sdk');
const process = require('process');

async function mapResources(stackName, manualMapping) {
  logger.info('INITIALIZING RESOURCES');

  // map the local handlers
  const localHandlers = manualMapping || (await mapHandlers()); //!test this

  // load the stack's envvars
  const ENVVARS = await populateEnvVars(stackName, manualMapping);
  return { localHandlers, ENVVARS };
}

const getHandle = (rootFolder, codePath, handleFuncName) => {
  try {
    const modulePath = `${rootFolder}/${codePath}`;
    const module = requireUncached(modulePath);
    const keys = handleFuncName.split('.');
    const handler = keys.reduce((object, key) => object[key], module);
    return handler;
  } catch (e) {
    logger.error(`FAILED to import ${modulePath}`);
    return async () => {
      logger.error(
        `FAILED params: \n\trootFolder: ${rootFolder} \n\tcodePath: ${codePath} \n\thandleFuncName: ${handleFuncName}`
      );
      return {
        message: 'The function is not found',
        statusCode: 404,
      };
    };
  }
};

const processItem =
  ({ localHandlers, ENVVARS }) =>
  async ({ lambdaEvent, writeResult, cleanInvoke }) => {
    const rootFolder = process.cwd();
    // const lambdaEvent = JSON.parse(item.body.S);
    // import module, load relevant envvars and trigger the relevant handler
    if (localHandlers[lambdaEvent.lambdaName]) {
      logger.info(`TRIGGERING LAMBDA ${lambdaEvent.lambdaName}`);
      Object.entries(ENVVARS[lambdaEvent.lambdaName]).forEach(([key, val]) => {
        process.env[key] = val;
      });
      const handler = getHandle(
        rootFolder,
        localHandlers[lambdaEvent.lambdaName].pathToHandler,
        localHandlers[lambdaEvent.lambdaName].handlerName
      );

      try {
        const moduleResponse = await handler(lambdaEvent.event);
        await writeResult(moduleResponse, INVOKE_STATUS.COMPLETED);

        if (!isApiRequest(lambdaEvent.event)) {
          logger.info('not api request, cleanup invoke');
          await cleanInvoke();
        }
        logger.info(`LAMBDA ${lambdaEvent.lambdaName} FINISHED EXECUTION`);
      } catch (e) {
        logger.error(e.message);
        await writeResult({ error: e.message }, INVOKE_STATUS.FAILED);
      }
    }
  };

const fetchConfigFile = (manualMapping) => {
  try {
    const manualMappingPath = `${process.cwd()}/${manualMapping}`;
    return require(manualMappingPath);
  } catch (error) {
    throw Error(`was not able to import manual mapping from ${manualMappingPath}`);
  }
};



const startMessageListener = async (flags) => {
  
  let configFile = null;
  let lambdaMapping = null;
  if (flags.configFile){
    configFile = fetchConfigFile(flags.configFile);
    lambdaMapping = loadLambdaMapping(configFile);
    logger.info('LOADED CONFIG FILE');
  }
  loadConfigParams(configFile, flags);

  logger.info(`USING AWS PROFILE ${process.env.AWS_PROFILE} `);
  process.env.AWS_PROFILE ? logger.info(`USING AWS REGION ${process.env.AWS_REGION}`) : null;
  
  const credentials = new AWS.SharedIniFileCredentials({ profile: process.env.AWS_PROFILE });
  AWS.config.credentials = credentials;
  process.env.AWS_SESSION_TOKEN = credentials.sessionToken;
  process.env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
  process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;

  const stackName = configFile?.stackName || flags.stackName;

  // get NLD stack resources
  logger.info('CHECKING NLD RESOURCES');
  const NLDResources = await listStackResources(flags.NLDStackName);

  // store NLD refs
  await saveNLDResourcesRefs(NLDResources);

  // bind NLD to the stacks's lambdas
  logger.info('BINDING TO LAMBDAS');
  await bindToLambdas(stackName , lambdaMapping); //! check if no stack name

  // init
  logger.info('BINDING TO LOCAL HANDLERS');
  const { localHandlers, ENVVARS } = await mapResources(stackName, lambdaMapping);
  if (Object.keys(localHandlers).length === 0) {
    logger.error('found no local lambdas to bind. exiting...');
    return 0;
  }

  if (flags.clean) {
    await invokeCleanupAll(`${process.env.STACK_NAME}`);
  }
  logger.info('READY AND LISTENING FOR NEW EVENTS...');
  await startListeningToEvents(processItem({ localHandlers, ENVVARS }));
};

module.exports = startMessageListener;
