const config = {
  // Automatically reset mock calls, instances and results before every test
  resetMocks: true,
  testMatch: ['**/__tests__/*.spec.js'],
  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: false,

  testEnvironment: 'node',

  transform: {},
};

module.exports = config;
