jest.mock('../shared/env');
jest.mock('../shared/communication');
const { handler } = require('../lambda-mirror/lambda-mirror');
const { getServiceParams } = require('../shared/env');
const { invokeLocalLambda, startListeningToResult, invokeCleanup } = require('../shared/communication');
const { LAMBDA_NAME_KEY } = require('../shared/consts');

describe('lambdaMirror invoked', () => {
  describe('api call', () => {
    it('should listen to result', async () => {
      const lambdaName = 'GetTestFunction';
      const payload = { path: 'test/1', httpMethod: 'GET', headers: { RequestId: '123' }, val1: 7, val2: 9.2 };
      getServiceParams.mockReturnValue({
        SERVICE_NAME: 'test-service-name',
        DYNAMO_TABLE_RESOURCE_NAME: 'mirrorsCachingTable',
        TEMPLATE_PATH: './src/local-server/__tests__/example-teamplate.yml',
        CODE_URI: '',
      });
      const invokeId = Math.round(Date.now() / 1000).toString();
      const result = { sometestData: 'testData' };
      invokeLocalLambda.mockReturnValue(invokeId);
      startListeningToResult.mockImplementation((invokeId, callback) => {
        expect(invokeId).toEqual(invokeId);
        return callback(result);
      });
      process.env.LAMBDA_MIRROR_NAME = lambdaName;
      process.env.DYNAMO_MIRROR_TABLE_REF = 'mirrorsCachingTable';

      const callResult = await handler(payload);
      expect(invokeLocalLambda).toBeCalledWith({
        lambdaName: `${process.env.STACK_NAME}`,
        body: JSON.stringify({ lambdaName, event: payload }),
      });
      expect(invokeCleanup).toBeCalledWith(invokeId);
      expect(callResult).toEqual(result);
    });
  });
});
