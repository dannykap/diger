const handler = async ({ val1, val2 }) => {
  console.log('hello world');
  const testVar = process.env.TEST_VAR;
  return { testVar, value: val1 + val2 };
};

module.exports = {
  handler,
};
