const logger = require('../../shared/logger');
const { getStackName, getStackStatus, listStackResources, getFunctionConfiguration } = require('./stacks');

const populateEnvVars = async (stackName, manualMapping) => {
  logger.info(`IMPORTING LAMBDA ENVVARS`);
  //! test this!
  let lambdaNames = [];
  if (stackName){
    const stackStatus = await getStackStatus(stackName);
    if ( !stackStatus.includes('COMPLETE') || stackStatus.includes('IN_PROGRESS')) {
      throw new Error(
        `${stackName} is in ${stackStatus} state. Please wait for the stack to be in a COMPLETE state to proceed.`
      );
    }
    const stackResources = await listStackResources(stackName);
    lambdaNames = stackResources?.filter((resource) => (resource.ResourceType === 'AWS::Lambda::Function' ? 1 : 0));
  }else{
    Object.keys(manualMapping).forEach((key) => lambdaNames.push({PhysicalResourceId : key}));
  }
  const AllLambdaInfo = await Promise.all(
    lambdaNames?.map((lambdaName) => getFunctionConfiguration(lambdaName.PhysicalResourceId))
  );
  const ENVVARS = {};
  // map envVars per lambda
  AllLambdaInfo.forEach((lambdaInfo) => {
    ENVVARS[lambdaInfo.Environment.Variables.LAMBDA_MIRROR_NAME] = lambdaInfo.Environment.Variables;
  });
  return ENVVARS;
};

const loadConfigParams = (configFile = null, flags) => {
  if (configFile){
    Object.keys(configFile).forEach((key) => configFile[key] = (configFile[key] === '' ? null : configFile[key])
    );
  }
  if (!configFile?.lambdaMapping &&  !flags.stackName && !configFile?.stackName){ 
    logger.error(`missing stack name or lambda mapping! EXITING\n`);
    throw Error;
  };  
  process.env.CODE_URI = configFile?.codeUri || flags.codeUri;
  process.env.AWS_REGION = configFile?.region || flags.awsRegion || process.env.AWS_REGION;
  process.env.STACK_NAME  = ( configFile?.stackName || flags.stackName ) || Object.keys(configFile.lambdaMapping)[0];
  process.env.AWS_PROFILE = configFile?.profile || flags.awsProfile || process.env.AWS_PROFILE;
  process.env.TEMPLATE_PATH = configFile?.templatePath || flags.templatePath;
  process.env.NLD_VERBOSE = flags.verbose;
}

const loadLambdaMapping = (configFile = null) => {
  let manualMapping = {};
  //if there's manual mapping cleanup the examples and if no stack name return only the first lambda
  if (configFile?.lambdaMapping){
    Object.keys(configFile?.lambdaMapping).forEach((lambdaName) => 
      lambdaName.includes('LambdaNameExample') ? null : manualMapping[lambdaName] = configFile?.lambdaMapping[lambdaName]
    );
    if (configFile.stackName === ''){
      const firstLambdaKey = Object.keys(manualMapping)[0];
      const firstLambdaPath = manualMapping[firstLambdaKey];
      let lambdaMapping = {};
      lambdaMapping[Object.keys(manualMapping)[0]] = firstLambdaPath;
      return lambdaMapping ;
    }
  }
  return Object.keys(manualMapping).length === 0 ? null : manualMapping;
}

module.exports = {
  populateEnvVars,
  loadConfigParams,
  loadLambdaMapping
};
