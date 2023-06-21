jest.mock('../shared/env');
jest.mock('../shared/communication');
jest.mock('../local-server/utils/stacks');
const { connect } = require('../local-server/command-connect');
const { getServiceParams } = require('../shared/env');
const { startListeningToEvents } = require('../shared/communication');
const {
  listStackResources,
  getStackName,
  getStackStatus,
  getFunctionConfiguration,
} = require('../local-server/utils/stacks');

describe('connect command', () => {
  let writeResult;
  let cleanInvoke;
  beforeEach(async () => {
    writeResult = jest.fn();
    cleanInvoke = jest.fn();
    listStackResources.mockReturnValue([
      {
        LogicalResourceId: 'GetTestFunction',
        PhysicalResourceId: 'GetTestFunctionSomeId',
        ResourceType: 'AWS::Lambda::Function',
      },
      {
        LogicalResourceId: 'mirrorsCachingTable',
        PhysicalResourceId: 'mirrorsCachingTablePID',
        ResourceType: 'AWS::DynamoDB::Table',
      },
      {
        LogicalResourceId: 'QueueTriggeredTestFunction',
        PhysicalResourceId: 'QueueTriggeredTestFunctionPID',
        ResourceType: 'AWS::Lambda::Function',
      },
    ]);
    getStackName.mockReturnValue('test-stack');
    getStackStatus.mockReturnValue('CREATE_COMPLETE');
    const dynamoTableRef = 'mirrorsCachingTable';
    getServiceParams.mockReturnValue({
      SERVICE_NAME: 'SERVICE_NAME',
      DYNAMO_TABLE_RESOURCE_NAME: dynamoTableRef,
      TEMPLATE_PATH: './src/__tests__/assets/example-teamplate.yml',
      CODE_URI: '',
    });
  });
  describe('received api call message', () => {
    it('should write result', async () => {
      getFunctionConfiguration.mockReturnValue({
        Environment: {
          Variables: {
            LAMBDA_MIRROR_NAME: 'GetTestFunction',
            MIRRORS_CACHING_TABLE_NAME: 'mirrorsCachingTablePID',
            TEST_VAR: 'test-value',
          },
        },
      });
      const lambdaEvent = {
        lambdaName: 'GetTestFunction',
        event: { path: 'test/1', httpMethod: 'GET', headers: { RequestId: '123' }, val1: 7, val2: 9.2 },
      };
      const writeResult = jest.fn();
      const cleanInvoke = jest.fn();
      startListeningToEvents.mockImplementation(async (callback) => {
        await callback({ lambdaEvent, writeResult, cleanInvoke });
      });

      await connect({});

      expect(writeResult).toHaveBeenCalledWith({ testVar: 'test-value', value: 16.2 }, 'completed');
      expect(cleanInvoke).not.toHaveBeenCalled();
    });
  });
  describe('received queue call message', () => {
    it('should should remove the call', async () => {
      getFunctionConfiguration.mockReturnValue({
        Environment: {
          Variables: {
            LAMBDA_MIRROR_NAME: 'QueueTriggeredTestFunction',
            MIRRORS_CACHING_TABLE_NAME: 'mirrorsCachingTablePID',
            QUEUE_ENV_VALUE: 'queue-test-value',
          },
        },
      });
      const lambdaEvent = {
        lambdaName: 'QueueTriggeredTestFunction',
        event: { val1: 's1', val2: 's2' },
      };
      startListeningToEvents.mockImplementation(async (callback) => {
        await callback({ lambdaEvent, writeResult, cleanInvoke });
      });

      await connect({});

      expect(writeResult).toHaveBeenCalledWith({ envVal: 'queue-test-value', value: 's1s2' }, 'completed');
      expect(cleanInvoke).toHaveBeenCalled();
    });
  });
});
