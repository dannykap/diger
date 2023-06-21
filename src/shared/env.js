const logger = require('./logger');

const getServiceName = () => {
  const projectPath = process.cwd();
  try {
    const servicePackage = require(`${projectPath}/package.json`);
    return servicePackage.name;
  } catch (e) {
    logger.error('failed reading the stack name from package.json! use -s to override');
    throw Error;
  }
};

const getServiceParams = () => {
  const packageDir = process.cwd();
  const serviceParams = require(`${packageDir}/gofer/src/shared/params.js`).params;
  return serviceParams;
};

module.exports = {
  getServiceParams,
  getServiceName,
};
