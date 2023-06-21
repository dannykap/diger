const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const { getEnvName } = require('./utils/stacks');
const logger = require('../shared/logger');

const PROFILE = 'melio-personal';

const deploy = async (flags) => {
  //create layer resources
  const packageDir = path.resolve(__dirname, '../');
  try {
    await fs.copy(`${packageDir}/shared`, `${packageDir}/NLDLayer/payload/shared`);
  } catch (error) {
    logger.error(
      `failed copying ${packageDir}/shared to ${packageDir}/NLDLayer/payload/shared with error: \n${error}`
    );
  }

  process.env.AWS_PROFILE = flags.awsProfile || process.env.AWS_PROFILE;
  process.env.AWS_REGION = flags.awsRegion || process.env.AWS_REGION;

  const command = `sam deploy -t ${packageDir}/NLDLayer/template.yml --stack-name ${flags.NLDStackName} --region ${process.env.AWS_REGION} --profile ${process.env.AWS_PROFILE} --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM --resolve-s3`;
  logger.info(`Deploying ${flags.NLDStackName} stack with: \n\t ${command}`);
  const deployProcess = spawn(command, { shell: true });

  deployProcess.stdout.on('data', function (data) {
    logger.info(data.toString());
  });

  deployProcess.stderr.on('data', function (data) {
    // logger.error(`FAILED deploying the NLD stack, error: \n ${data.toString()}\n\n handle the error and/or erase the stack to redeploy`); 
    logger.info(data.toString());
  });

  deployProcess.on('exit', function (code) {
    console.log('child process exited with code ' + code.toString());
    process.exit(code.toString());
  });
};

module.exports = deploy;

//TODAY
//scrape the gofer stack and save resource refs
//scrape the service
//store lambda envs
//update all together
//write to dynamo epoch to maintain if up
//verbose logs IO

//FUTURE
//give list of lambdas to catch
//override codeUri
//give map of code to lambda
