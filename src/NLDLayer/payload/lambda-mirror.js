/* eslint-disable radix */
/* eslint-disable no-await-in-loop */
const { invokeLocalLambda, startListeningToResult, invokeCleanup, readClientKeepAlive } = require('./shared/communication');
const { isApiRequest } = require('./shared/helpers');
const { LAMBDA_NAME_KEY } = require('./shared/consts');

process.env.AWS_SDK_LOAD_CONFIG = 'y';
const monitorEvents = true;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const parseHandlerPath = (pathToHandler) => {
  // if more the one "." in handler name (after the last "/")
  const isHandlerInNestedObject = (pathToHandler.match(/^.*\/[^\/\.]+(\.[^\/\.]+){2,}/) || []).length > 0;
  if (isHandlerInNestedObject) {
    const splitted = pathToHandler.split('/');
    const lastInSplitted = splitted[splitted.length - 1];
    splitted.pop();
    pathToHandler = `${splitted.join('/')}/${lastInSplitted.match(/^[^.]+/)[0]}`;
  }else{
    pathToHandler = pathToHandler.substring(0, pathToHandler.lastIndexOf('.'));
  }

  // get the handler function name
  const getHandlerName = (isHandlerInNestedObject) => {
    const getHandlerBy = isHandlerInNestedObject ? 'indexOf' : 'lastIndexOf';
    return process.env.ORIGINAL_HANDLER.substring(
      process.env.ORIGINAL_HANDLER[getHandlerBy]('.') + 1
    );
  };

  const handlerName = getHandlerName(isHandlerInNestedObject);  
  console.log(`original handler path: ${pathToHandler} \t handler name: ${handlerName}`);
  return {pathToHandler, handlerName};
}

exports.handler = async function (event, context, callback) {

  // verify can work
  if (!process.env.DYNAMO_MIRROR_TABLE_REF || !process.env.LAMBDA_MIRROR_NAME || !process.env.ORIGINAL_HANDLER) {
    console.log(`missing envvars!`);
    console.log(`dynamo mirror table: ${process.env.DYNAMO_MIRROR_TABLE_REF}`);
    console.log(`lambda name: ${process.env.LAMBDA_MIRROR_NAME}`);
    console.log(`ORIGINAL_HANDLER: ${process.env.ORIGINAL_HANDLER}`);
    console.log(`exiting...`);
    return 0;
  }


  //trigger original lambda handler if NLD client is down
  const goferClientAlive = await readClientKeepAlive();
  if (!goferClientAlive){
    const {pathToHandler, handlerName} = parseHandlerPath(process.env.ORIGINAL_HANDLER);
    return require(`${pathToHandler}.js`)[handlerName](event, context, callback);
  }

  // write incoming event to queue
  console.log(
    `NLD incoming event
    \n${process.env.LAMBDA_MIRROR_NAME}
    \n${process.env.DYNAMO_MIRROR_TABLE_REF}
    \n${event?.Records?.[0]?.eventSource || null }`
  );
  const invokeId = await invokeLocalLambda({
    lambdaName: `${process.env.STACK_NAME}`,
    body: JSON.stringify({
      lambdaName: process.env.LAMBDA_MIRROR_NAME,
      event,
    }),
  });
  console.log('NLD forwarding execution to local client');
  if (!invokeId) {
    console.log('failed to invoke lambda');
    return 0;
  }
  // if triggered from ApiGW wait for response to return
  // if (isApiRequest(event)) { //disabeled to support any sync lambda type
    console.log('waiting for response');
    //! verify this
    if (monitorEvents) {
      const result = startListeningToResult(invokeId, async (result) => {
        await invokeCleanup(invokeId);
        return result;
      });
      return result;
    }
  // }

  return 0;
};
