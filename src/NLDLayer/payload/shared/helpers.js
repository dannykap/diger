const logger = require('./logger');

const isApiRequest = (event) => event.path && event.httpMethod;

const requireUncached = (module) => {
  for (const path in require.cache) {
    if (path.endsWith('.js') || path.endsWith('.ts') || !path.includes('node_modules')) {
      delete require.cache[path];
    }
  }
  try {
    return require(module);
  } catch (e) {
    logger.error(`failed importing ${module} with error:\n${e.message}`);
  }
};

module.exports = {
  isApiRequest,
  requireUncached,
};
