# NodeJS Lambda Debugger
## WHAT IS IT 
A generic JS/Typescript dev tool that enables debugging deployed AWS lambdas by delegating their execution to a local machine. 

## HOW DOES IT WORK 
* __Deployment phase__
    <br>Should be done once per account+region to:
    - allocate a dynamoDB table used for caching and act as a trigger event ledger
    - Create a lambda layer that, once applied to a lambda during a debugging session, mirrors the trigger event to the local machine
* __Connection phase__
    <br>Executing in any IDE debugger terminal the 'connect' CLI command  will:
    - Map the relevant lambdas (either manually provided or auto-discovered from a given cloudformation template)
    - Update the remote lambdas to mirror the trigger event when the local machine is in active debugging

## PREREQUISITES 
* Programmatic access to an AWS account containing a Lambda with code that can be executed on a local machine.

## HOW TO INSTALL 
* Install : `npm i -g nld ts-node typescript`
* Deploy : `nld deploy` (once per account+region. use '-h' to override default params)
    <br>&ensp;*example: `nld deploy -p dev-account -r eu-central-1`*

## HOW TO USE 
* From a project's root path, execute in your IDE's debug terminal: `nld connect` (use '-h' for override options)
<br>
* `nld connect` defaults:
    - use the local machine's default AWS profile+region
    - Auto-discover and map the lambdas in a Cloudformation template located at the the project's root at template.yml
    - Bind to handler files located at the paths described in the template.yml
<br>
* `nld connect` overrides:
    - `-p <aws-profile>`    &ensp;override the default profile aws uses
    - `-r <aws-region>`     &ensp;override the default region aws uses
    - `-s <stack-name>`     &ensp;name of the stack that containing lambdas to debug
    - `-t <template-path>`  &ensp;path to the repo's template. Default: ./template.yml
    - `-u <code-uri>`       &ensp;to enforce a different base path to all lambda handlers. 
                                <br>&ensp;&ensp;Default: CodeUri defined in template.yml
                                  <br>&ensp;&ensp; example: '-u ./build/'.
    - `-m <manual-mapping>` &ensp;override the template's mapping relative path to a file manually mapping lambdas to their local handlers. 
                                <br>&ensp;&ensp;Example: examples/mapping.js`, null)
    - `-v `                 &ensp;enable verbose logging to print runtime execution and events IO
    - `-u <code-uri>`       &ensp;override all handlers base path (lambda CodeUri)
    - `-v <verbose>`        &ensp;print execution logs
    - `-c <clean-logs>`     &ensp;erase previously stored queued trigger events before starting a new debug session
    - `-f <config-file>`    &ensp;path to an NLD config file storing the overrides and manual lambda mapping. <br>Run 'nld generate-config-file to generate an example file
    - `-n <NLD-stack-Name>` &ensp;override the default name for the NLD resources stack. Default: NLD
## HOW TO REMOVE
* If you wish to update the lambdas or when debugging is no longer needed, execute `nld detach` for that specific stack/lambda

## GOOD TO KNOW 
* Debugging a single lambda that is not part of a cloudformation stack can be debugged by 
    generating an NLD config file and mapping the lambda name to the local handler file, keeping the stackName field empty. 
* For TS projects, if during execution node throws a "Cannot find module" error, try resolving the paths by:
  - execute `npm i -D tsconfig-paths`
  - adding to the project's tsconfig.json file: `"ts-node": {"require": ["tsconfig-paths/register"]}`
* When local handler code is executed, it's allocated with the envVars of their Cloud counterpart.
    This enables the code to interact with the stack's resources. 
* During debugging, handlers are resolved and triggered based on the path defined in the service's template file (support both js and typescript). 
    If the local path is different to what is defined in the Cloudformation stack, generate an NLD config file and override the paths.
* Local handler scripts are loaded only when triggered. Changing code takes effect immediatly. Restarting NLD is not needed.

## CLI EXAMPLES
* Initial deployment: 
    `nld deploy  -p dev-account -r eu-central-1`
* Stack debugging:    
    `nld connect -p dev-account -r eu-central-1 -s my-test-stack`
* Detach NLD from the stack:
    `nld detach  -p dev-account -r eu-central-1`
* Stack debugging with local handler path prefix override:
    `nld connect -p dev-account -r eu-central-1 -s my-test-stack -u ./build`
* Using a project config file:
    create:  `nld generate-config-file -p nld.js`
    connect: `nld deploy -f nld.js`

