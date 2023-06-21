const { DynamoDB } = require('aws-sdk');

const logger = require('../logger');
const { INVOKE_STATUS } = require('../consts');

const getDynamoDBMirrorTableRef = () => process.env.DYNAMO_MIRROR_TABLE_REF;

const readLambdaInvokes = async () => {
  const dynamodb = new DynamoDB({ region: `${process.env.AWS_REGION}` });
  const mirrorTableRef = process.env.DYNAMO_MIRROR_TABLE_REF;
  const queryParams = {
    ExpressionAttributeValues: {
      ':lambdaName': {
        S: `${process.env.STACK_NAME}`,
      },
      ':invokeStatus': {
        S: INVOKE_STATUS.PENDING,
      },
    },
    KeyConditionExpression: 'lambdaName = :lambdaName',
    FilterExpression: 'invokeStatus = :invokeStatus',
    TableName: mirrorTableRef,
  };
  let queryResult = '';
  try {
    queryResult = await dynamodb.query(queryParams).promise();
  } catch (error) {
    logger.error(
      `failed to fetch item ${process.env.STACK_NAME} from dynamo table ${process.env.DYNAMO_MIRROR_TABLE_REF} with error: \n${error}`
    );
  }
  if (!queryResult?.Items?.length) {
    return [];
  }
  const RequestItems = {
    [mirrorTableRef]: queryResult.Items.map((item) => ({
      PutRequest: {
        Item: {
          ...item,
          invokeStatus: { S: INVOKE_STATUS.IN_PROGRESS },
        },
      },
    })),
  };
  try {
    await dynamodb.batchWriteItem({ RequestItems }).promise();
    // console.log('deleted consumed items', RequestItems[mirrorTableRef].length);
  } catch (error) {
    logger.error(`failed erasing consumed messages: \n ${error}`);
  }
  return queryResult.Items;
};

const readResult = async (invokeId) => {
  const dynamodb = new DynamoDB({ region: `${process.env.AWS_REGION}` });
  const mirrorTableRef = getDynamoDBMirrorTableRef();
  const queryParams = {
    ExpressionAttributeValues: {
      ':lambdaName': {
        S: `${process.env.STACK_NAME}`,
      },
      ':invokeId': {
        S: invokeId,
      },
      ':failedStatus': {
        S: INVOKE_STATUS.FAILED,
      },
      ':completedStatus': {
        S: INVOKE_STATUS.COMPLETED,
      },
    },
    KeyConditionExpression: 'lambdaName = :lambdaName and invokeId = :invokeId',
    FilterExpression: `invokeStatus in  (:failedStatus, :completedStatus)`,
    TableName: mirrorTableRef,
  };
  try {
    const queryResult = await dynamodb.query(queryParams).promise();
    return queryResult.Items?.[0];
  } catch (error) {
    logger.error(
      `failed to fetch item ${process.env.STACK_NAME} from dynamo table ${mirrorTableRef} with error invokeId:${invokeId}: \n${error}`
    );
    return null;
  }
};

const invokeLocalLambda = async (item) => {
  const dynamodb = new DynamoDB({ region: `${process.env.AWS_REGION}` });
  const mirrorTableRef = getDynamoDBMirrorTableRef();
  try {
    const invokeId = Math.round(Date.now() / 1000).toString();
    await dynamodb
      .putItem({
        Item: {
          lambdaName: { S: item.lambdaName },
          invokeId: { S: invokeId },
          ttl: { S: (Math.round(Date.now() / 1000) + 30 * 1000).toString() },
          body: { S: item.body },
          invokeStatus: { S: INVOKE_STATUS.PENDING },
        },
        TableName: mirrorTableRef,
      })
      .promise();
    return invokeId;
  } catch (error) {
    logger.error(`failed to write to dynamo table ${mirrorTableRef} with error: \n${error}`);
  }
  return null;
};

const writeLambdaResult = async ({ item, result, invokeStatus }) => {
  const dynamodb = new DynamoDB({ region: `${process.env.AWS_REGION}` });
  const mirrorTableRef = getDynamoDBMirrorTableRef();
  try {
    await dynamodb
      .putItem({
        Item: {
          ...item,
          ...(result !== undefined ? { result: { S: JSON.stringify(result) } } : {}),
          invokeStatus: { S: invokeStatus },
        },
        TableName: mirrorTableRef,
      })
      .promise();
    logger.debug('writing result: %s', result);
  } catch (error) {
    logger.error(`failed to write to dynamo table ${mirrorTableRef} with error: \n${error}`);
  }
};

async function readClientKeepAlive() {
  const dynamodb = new DynamoDB({ region: `${process.env.AWS_REGION}` });
  const itemInfo = {
    TableName: process.env.DYNAMO_MIRROR_TABLE_REF,
    Key: {
      lambdaName: { S: `${process.env.STACK_NAME}_TTL` },
      invokeId: { S: '0' },
    },
  };
  const keepAliveRes = await dynamodb.getItem(itemInfo).promise();
  return keepAliveRes.hasOwnProperty('Item') &&
    keepAliveRes?.Item?.invokeId?.S === '0' &&
    keepAliveRes?.Item?.lambdaName?.S === `${process.env.STACK_NAME}_TTL` &&
    parseInt(keepAliveRes?.Item?.ttl?.N) > Math.floor(new Date().getTime() / 1000) - 5
    ? true
    : false;
}

async function writeClientKeepAlive() {
  const dynamodb = new DynamoDB({ region: `${process.env.AWS_REGION}` });
  const params = {
    TableName: process.env.DYNAMO_MIRROR_TABLE_REF,
    Key: {
      lambdaName: { S: `${process.env.STACK_NAME}_TTL` },
      invokeId: { S: '0' },
    },
    ExpressionAttributeNames: {
      '#ttl': 'ttl',
    },
    ExpressionAttributeValues: {
      ':currentTime': {
        N: Math.floor(new Date().getTime() / 1000).toString(),
      },
    },
    UpdateExpression: 'SET #ttl = :currentTime',
    ReturnValues: 'ALL_NEW',
  };
  try {
    const updateItemRes = await dynamodb.updateItem(params).promise();
  } catch (error) {
    logger.error(`failed to write to dynamo table ${process.env.DYNAMO_MIRROR_TABLE_REF} with error: \n${error}`);
  }
}

const invokeCleanup = async (invokeId) => {
  const dynamodb = new DynamoDB({ region: `${process.env.AWS_REGION}` });
  const mirrorTableRef = getDynamoDBMirrorTableRef();
  try {
    await dynamodb
      .deleteItem({
        Key: { lambdaName: { S: `${process.env.STACK_NAME}` }, invokeId: { S: invokeId } },
        TableName: mirrorTableRef,
      })
      .promise();
  } catch (error) {
    logger.error(
      `failed to delete item from dynamo table ${mirrorTableRef} lambda name ${`${process.env.STACK_NAME}`} with error: \n${error}`
    );
  }
};

const getAllItems = async (ExclusiveStartKey) => {
  const dynamodb = new DynamoDB({ region: `${process.env.AWS_REGION}` });
  const mirrorTableRef = getDynamoDBMirrorTableRef();
  const scanResult = await dynamodb
    .scan({
      TableName: mirrorTableRef,
      ExclusiveStartKey,
    })
    .promise();
  if (scanResult.LastEvaluatedKey) {
    const nextResult = await getAllItems(mirrorTableRef, scanResult.LastEvaluatedKey);
    return [...scanResult.Items, ...nextResult];
  }
  return scanResult.Items;
};

const chunk = (array, size) => {
  // CP
  const chunked_arr = [];
  let index = 0;
  while (index < array.length) {
    chunked_arr.push(array.slice(index, size + index));
    index += size;
  }
  return chunked_arr;
};

const batchWriteItems = async (items) => {
  const dynamodb = new DynamoDB({ region: `${process.env.AWS_REGION}` });
  const mirrorTableRef = getDynamoDBMirrorTableRef();
  const MAX_ITEMS_PER_REQUEST = 25;
  const itemsChunks = chunk(items, MAX_ITEMS_PER_REQUEST);
  const requestItems = itemsChunks.map((items) => ({
    [mirrorTableRef]: items,
  }));
  await Promise.allSettled(
    requestItems.map((requests) => dynamodb.batchWriteItem({ RequestItems: requests }).promise())
  );
};

const invokeCleanupAll = async (keyName) => {
  try {
    const items = await getAllItems();
    // Prepare the items for batch deletion
    const deleteItemsRequests = items.map((item) => ({
      DeleteRequest: {
        Key: {
          lambdaName: item.lambdaName,
          invokeId: item.invokeId,
        },
      },
    }));
    await batchWriteItems(deleteItemsRequests);
    // console.log(`Successfully deleted all invokes from table ${tableName}.`);
  } catch (err) {
    logger.error(`deleting items from table ${tableName}: ${err}`);
  }
};

const sleep = async (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const startListeningToEvents = async (callback) => {
  const mirrorTableRef = getDynamoDBMirrorTableRef();
  const writeResult = (item) => (result, invokeStatus) =>
    writeLambdaResult({ item, result, mirrorTableRef, invokeStatus });
  const cleanInvoke = (invokeId) => () => invokeCleanup(mirrorTableRef, invokeId);

  do {
    // fetch new events
    let fetchMessagesOutput = await readLambdaInvokes(mirrorTableRef);
    if (fetchMessagesOutput.length) {
      await Promise.allSettled(
        fetchMessagesOutput.map(async (item) => {
          const lambdaEvent = JSON.parse(item.body.S);
          logger.debug('event input: %s', lambdaEvent);
          await callback({ lambdaEvent, writeResult: writeResult(item), cleanInvoke: cleanInvoke(item.invokeId.S) });
        })
      );
    }
    await writeClientKeepAlive();
    await sleep(1000);
  } while (1);
};

const startListeningToResult = async (invokeId, callback) => {
  do {
    // fetch new events
    const item = await readResult(invokeId);
    if (item) {
      const result = JSON.parse(item.result.S);
      return await callback(result);
    }

    // add test to end gracefully on ApiGW timeout
    await sleep(500);
  } while (1);
};

module.exports = {
  invokeLocalLambda,
  invokeCleanupAll,
  startListeningToEvents,
  startListeningToResult,
  invokeCleanup,
  readClientKeepAlive,
};
