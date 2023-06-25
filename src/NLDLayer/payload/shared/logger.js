const styles = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

function log(prefix, color, message, ...objects) {
  let logMessage = message;

  // Replace placeholders with objects
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i];
    const placeholder = `%s`;
    logMessage = logMessage.replace(placeholder, `\n${JSON.stringify(object, null, 2)}\n`);
  }

  console.log(`${color}${styles.bold}NLD [${prefix}]:${styles.reset} ${logMessage}`);
}

/**
 * Logs a message with JSON-formatted objects, surrounded by a top and bottom border.
 * @param {string} message - The message string, which may contain placeholders in the form of `%s`.
 * @param  {...any} objects - Any number of objects that will be used to replace the placeholders in the message string.
 * @returns {void}
 *
 * @example
 * // Example usage:
 * logger.info('User details: %s', { name: 'John', age: 30, email: 'john@example.com' });
 * logger.error('Event details: %s, Error: %s', { id: 'xxx', price: 999 }, { message: 'Rate Limit' });
 */
const logger = {
  error: (message, ...objects) => log('ERROR', styles.red, message, ...objects),
  warn: (message, ...objects) => log('WARNING', styles.yellow, message, ...objects),
  info: (message, ...objects) => log('INFO', styles.blue, message, ...objects),
  debug: (message, ...objects) =>
    JSON.parse(process.env.NLD_VERBOSE) ? log('DEBUG', styles.green, message, ...objects) : '',
};

module.exports = logger;
