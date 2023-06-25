const program = require('commander');
const process = require('process');

const { deploy, connect, detach, generate } = require('./src/commands');
const { version, name } = require('./package.json');

process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1';
process.env.AWS_SDK_LOAD_CONFIG = 'y';
process.env.AWS_PROFILE = 'melio-personal';

program
  .version(version)
  .name(name)
  .description('A generic JS/Typescript dev tool that enables debugging deployed AWS lambdas by delegating their execution to a local machine');

program.command('deploy')
.description(`create NLD stack resources`)
.option('-n --NLD-stack-Name <name>', `override the default name for the NLD stack. Default: NLD`, 'NLD')
.option('-p --aws-profile <name>', `override the default profile aws uses`, null) 
.option('-r --aws-region <name>', `override the default region aws uses`, null) 
.action(deploy);

program
  .command('connect')
  .description('Connect NLD to deployed lambdas')
  .option('-p --aws-profile <name>', `override the default profile aws uses`, null) 
  .option('-r --aws-region <name>', `override the default region aws uses`, null) 
  .option(`-s --stack-name <name>`, `name of the stack that contains lambdas to debug`, null)
  .option('-t --template-path <name>', `path to the service's template. Default: ./template.yml`, './template.yml')
  .option('-u --code-uri <name>', `override all handlers base path (CodeUri)`, '') 
  .option('-m --manual-mapping <name>', `relative path to a file manually mapping lambdas to their local handlers. Example: examples/mapping.js`, null)
  .option('-v --verbose', `print execution logs`, false)
  .option('-c --clean', 'erase all queued trigger events before starting this session')
  .option('-f --config-file <name>', `path to a NLD config file. Run 'NLD connect --generate-template to generate an example file`, null)
  .option('-n --NLD-stack-Name <name>', `override the default name for the NLD stack. Default: NLD`, 'NLD')
  .action(connect);

  program
  .command('detach')
  .description(`detach NLD resources from previously debugged lambdas`)
  .option('-p --aws-profile <name>', `override the default profile aws uses`, null) 
  .option('-r --aws-region <name>', `override the default region aws uses`, null)   
  .option(`-s --stack-name <name>`, `name of the stack from which to detach the NLD resources`)
  .option('-f --config-file <name>', `path to a NLD config file containing list of lambdas`, null)
  .option('-n --NLD-stack-Name <name>', `override the default name for the NLD stack. Default: NLD`, 'NLD')
  .option('-v --verbose', `print execution logs`, false)
  .action(detach);

program
  .command('generate-config-file')
  .description(`generate an example NLD config file. Default: create nld.config.js in the current path. use -p to override`)
  .option(`-p --path <name>`, `override the default path where to create the config file. Default: create nld.config.js in the current path`, './nld.config.js')
  .action(generate);  

program.parse(process.argv);
