exports.params = {
  SERVICE_NAME: "SERVICE_NAME",
  DYNAMO_TABLE_RESOURCE_NAME: 'mirrorsCachingTable',
  TEMPLATE_PATH: './template.yml',
  // replace if path to lambda code in the service's package is not as stated in template.yml (example: './dist/')
  CODE_URI: ''  
};
