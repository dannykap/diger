const handler = async ({ val1, val2 }) => {
  console.log('triggered by queue');
  const envVal = process.env.QUEUE_ENV_VALUE;
  return { envVal, value: val1 + val2 };
};

module.exports = {
  handler,
};
