/* 
README
  the following are optional overrides to be used every time NLD connects.
  blank values will be ignored.
  erase the lambda examples before using this file
*/
module.exports = { 
  stackName: '',        // name of the cloudformation stack
  profile: '',          // name of the AWS profile to use by this machine
  region: '',           // name of the AWS region where the stack/lambdas reside 
  templatePath: '',     // relative path of the cloudformation stack to map the triggered events to local code
  codeUri: '',          // optional override of the relative prefix of the the lambda's handlers (overriding CodeUri)
  lambdaMapping: {
    // example of a logical lambda name as it appears in the local SAM template (use to override the lambda's handler path)
    LogicalLambdaNameExample: {
      pathToHandler: './examples/handler.js',   // path to local lambda handler file
      handlerName: 'handler',                   // name of the function exported by the handler File
    },
    // example of a physical lambda name as it appears after being created (use when debugging a lambda that was not created as part of a cloudformation stack)
    PhysicalLambdaNameExample: {
      pathToHandler: './examples/handler.js',
      handlerName: 'handler',
    },    
  }
};
