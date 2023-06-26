const fs = require('fs-extra');
const path = require('path');
const logger = require('../shared/logger');

const generate = async (flags) => {

  const packageDir = path.resolve(__dirname, '../../');
  try {
    await fs.copy(`${packageDir}/examples/diger.config.js`, flags.path);
    logger.info(`CREATED DIGER CONFIG FILE at  ${flags.path}`);
  } catch (error) {
    logger.error(
      `failed copying ${packageDir}/shared to ${flags.path} with error: \n${error}`
    );
  }

};

module.exports = generate;
