const fs = require('fs');
const samTemplate = require('js-yaml');
const { params } = require('../../shared/params');
const { getServiceName } = require('../../shared/env');
const logger = require('../../shared/logger');

class CustomTag {
  /**
   * @param {string | undefined} type
   * @param {any} data
   */
  constructor(type, data) {
    this.type = type;
    this.data = data;
  }
}

const tags = ['scalar', 'sequence', 'mapping'].map(
  (kind) =>
    new samTemplate.Type('!', {
      kind,
      multi: true,
      representName(/** @type CustomTag */ object) {
        return object.type;
      },
      represent(object) {
        return object.data;
      },
      instanceOf: CustomTag,
      construct(data, type) {
        return new CustomTag(type, data);
      },
    })
);

const SCHEMA = samTemplate.DEFAULT_SCHEMA.extend(tags);
const loadYamlFile = (filename) => samTemplate.load(fs.readFileSync(filename), { schema: SCHEMA });

const createParamsFile = async (paramsFilepath, flags) => {
  const serviceName = flags.serviceName ? flags.serviceName : getServiceName();
  const codeURI = flags.codeUri || '';

  let paramsFile = fs.readFileSync(paramsFilepath, 'utf8').split('\n');
  paramsFile.forEach((line, i) => {
    if (line.includes('SERVICE_NAME')) {
      paramsFile[i] = `\tSERVICE_NAME: "${serviceName}",`;
    }
    if (line.includes('CODE_URI')) {
      paramsFile[i] = `\CODE_URI: "${codeURI}",`;
    }
  });
  fs.writeFileSync(paramsFilepath, paramsFile.join('\n'), 'utf8');
};

// return a mirror version of the template yml object
const updateTemplateWithMirrors = (source) => {
  // create dynamo mirror table
  source.Resources[params.DYNAMO_TABLE_RESOURCE_NAME] = {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      AttributeDefinitions: [
        {
          AttributeName: 'lambdaName',
          AttributeType: 'S',
        },
        {
          AttributeName: 'invokeId',
          AttributeType: 'S',
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        {
          AttributeName: 'lambdaName',
          KeyType: 'HASH',
        },
        {
          AttributeName: 'invokeId',
          KeyType: 'RANGE',
        },
      ],
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: 'true',
      },
    },
  };

  // add to every lambda dynamo ref, dynamo permissions, lambda name and change path to mirror handler
  Object.entries(source.Resources).forEach(([key, resource]) => {
    if (resource.Type === 'AWS::Serverless::Function') {
      if (source.Resources[key].Properties.hasOwnProperty('InlineCode')) {
        return 0;
      }

      if (!source.Resources[key].Properties.Environment) {
        source.Resources[key].Properties.Environment = {};
      }

      if (!source.Resources[key].Properties.Environment.Variables) {
        source.Resources[key].Properties.Environment.Variables = {};
      }

      source.Resources[key].Properties.Environment.Variables.DYNAMO_MIRROR_TABLE_REF = new CustomTag(
        '!Ref',
        params.DYNAMO_TABLE_RESOURCE_NAME
      );
      source.Resources[key].Properties.Environment.Variables.LAMBDA_MIRROR_NAME = key;
      source.Resources[key].Properties.Handler = 'src/lambda-mirror/lambda-mirror.handler';
      source.Resources[key].Properties.Role = undefined;
      source.Resources[key].Properties.CodeUri = './';
      source.Resources[key].Properties.Policies = [];
      source.Resources[key].Properties.Policies.push({
        Statement: [
          {
            Sid: `${params.DYNAMO_TABLE_RESOURCE_NAME}Access`,
            Effect: 'Allow',
            Resource: new CustomTag('!GetAtt', `${params.DYNAMO_TABLE_RESOURCE_NAME}.Arn`),
            Action: [
              'dynamodb:GetItem',
              'dynamodb:Query',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:Scan',
              'dynamodb:DeleteItem',
            ],
          },
        ],
      });
    }
  });
  return source;
};

const newTemplatePath = './gofer/mirrorTemplate.yml';
// create mirror template
const createMirrorTemplate = async () => {
  try {
    fs.exists(newTemplatePath, (exists) => {
      if (exists) {
        fs.rmSync(newTemplatePath);
      }
      fs.copyFileSync('./template.yml', newTemplatePath);
      const mirrorFile = fs.readFileSync(newTemplatePath);
      const updatedTemplate = updateTemplateWithMirrors(samTemplate.load(mirrorFile, { schema: SCHEMA }));
      fs.writeFileSync(newTemplatePath, samTemplate.dump(updatedTemplate, { schema: SCHEMA }));
      logger.info('mirror template created!');
    });
  } catch (error) {
    logger.error(`failed create mirrorTemplate! error: \n${error}`);
  }
};

const mapHandlers = async () => {
  //import the package's params
  const handlersMapping = {};
  // read the template
  let doc = '';
  try {
    logger.info(`LOADING HANDLERS MAPPING FROM ${process.env.TEMPLATE_PATH}`);
    doc = samTemplate.load(fs.readFileSync(process.env.TEMPLATE_PATH), { schema: SCHEMA });
  } catch (e) {
    throw Error(
      `FAILED reading ${process.env.TEMPLATE_PATH}. \nverify a SAM template exists at this path or use -t to override it\n`
    );
  }

  // for every lambda
  logger.info('MAPPED HANDLERS:');
  Object.entries(doc.Resources).forEach(([lambdaName]) => {
    if (doc.Resources[lambdaName].Type === 'AWS::Serverless::Function') {
      let pathToHandler = doc.Resources[lambdaName].Properties.Handler.replace(/\.[^/.]+$/, '');
      const lambdaCodeUri = doc.Resources[lambdaName].Properties.CodeUri || '';

      //bind relative path
      const lambdaPathPrefixRef =
        process.env.CODE_URI !== '' ? process.env.CODE_URI : lambdaCodeUri !== '' ? lambdaCodeUri : '';
      const lambdaPathPrefix =
        lambdaPathPrefixRef === ''
          ? ''
          : lambdaPathPrefixRef.slice(-1) !== '/'
          ? `${lambdaPathPrefixRef}/`
          : lambdaPathPrefixRef;
      pathToHandler = `${lambdaPathPrefix}${pathToHandler}`;

      // if more the one "." in handler name (after the last "/")
      const isHandlerInNestedObject = (pathToHandler.match(/^.*\/[^\/\.]+(\.[^\/\.]+){2,}/) || []).length > 0;
      if (isHandlerInNestedObject) {
        const splitted = pathToHandler.split('/');
        const lastInSplitted = splitted[splitted.length - 1];
        splitted.pop();
        pathToHandler = `${splitted.join('/')}/${lastInSplitted.match(/^[^.]+/)[0]}`;
      }

      // get the file type
      const pathToFile = pathToHandler.replace(/\/[^/.]+$/, '');
      let fileList;
      try {
        fileList = fs.readdirSync(pathToFile, (err) => {
          if (err) {
            logger.error(err);
          }
        });
      } catch (error) {
        const isPrefix = lambdaPathPrefixRef == '' ? '' : `using prefix ${lambdaPathPrefixRef}`;
        logger.error(`\n\tfailed reading files in ${pathToFile} ${isPrefix} \n\tconsider overriding base path with '-u' flag`);
      }

      // get the handler function name
      const getHandlerName = (isHandlerInNestedObject) => {
        const getHandlerBy = isHandlerInNestedObject ? 'indexOf' : 'lastIndexOf';
        return doc.Resources[lambdaName].Properties.Handler.substring(
          doc.Resources[lambdaName].Properties.Handler[getHandlerBy]('.') + 1
        );
      };

      const handlerName = getHandlerName(isHandlerInNestedObject);

      console.log(`\t ${lambdaName} \n\t\t file path: ${pathToHandler} \n\t\t handler name: ${handlerName}`);
      handlersMapping[lambdaName] = {
        handlerName,
        pathToHandler: `${pathToHandler}`,
      };
    }
  });
  return handlersMapping;
};

const findResourceByType = (type, templateFile) => {
  const templateYml = loadYamlFile(templateFile);
  const resources = templateYml.Resources;
  const filteredResources = Object.values(resources).filter((resource) => resource.Type === type);
  return filteredResources;
};

const getOpenApiYaml = (templateFile = 'template.yml') => {
  const resources = findResourceByType('AWS::Serverless::Api', templateFile);
  const paths = resources
    .map((res) => res.Properties?.DefinitionBody?.['Fn::Transform']?.Parameters?.Location)
    .filter((path) => path !== undefined); //resources?.[0]?.DefinitionBody?.['Fn::Transform']?.Parameters?.Location;
  return paths;
};

const getStateMachineDefinition = (templateFile = 'template.yml') => {
  const resources = findResourceByType('AWS::Serverless::StateMachine', templateFile);
  return resources.map((res) => res.Properties?.DefinitionUri).filter((path) => path !== undefined);
};

module.exports = {
  createParamsFile,
  createMirrorTemplate,
  mapHandlers,
  getOpenApiYaml,
  getStateMachineDefinition,
};
