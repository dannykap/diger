const AWS = require('aws-sdk');
const { loadConfigParams, loadLambdaMapping } = require('./utils/env-vars');
const { saveNLDResourcesRefs, listStackResources, detachFromLambdas } = require('./utils/stacks');
const logger = require('../shared/logger');

const fetchConfigFile = (manualMapping) => {
  try {
    const manualMappingPath = `${process.cwd()}/${manualMapping}`;
    return require(manualMappingPath);
  } catch (error) {
    throw Error(`was not able to import manual mapping from ${manualMappingPath}`);
  }
};

const detach = async (flags) => {

  let configFile = null;
  let lambdaMapping = null;
  if (flags.configFile){
    configFile = fetchConfigFile(flags.configFile);
    lambdaMapping = loadLambdaMapping(configFile);
    logger.info('LOADED CONFIG FILE');
  }
  loadConfigParams(configFile, flags);

  const credentials = new AWS.SharedIniFileCredentials({ profile: process.env.AWS_PROFILE });
  AWS.config.credentials = credentials;
  process.env.AWS_SESSION_TOKEN = credentials.sessionToken;
  process.env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
  process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;

  //map diger resources
  const NLDResources = await listStackResources(flags.digerStackName);
  await saveNLDResourcesRefs(NLDResources);

  const stackName = configFile?.stackName || flags.stackName;

  // detach diger to the service's lambdas
  await detachFromLambdas(stackName, lambdaMapping);
};

module.exports = detach;
