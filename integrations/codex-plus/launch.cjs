// Compatibility entry point; the native launcher owns profile selection and locks.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.join(os.homedir(),'Applications','Task Workspace');
const launcher=path.join(root,'Workspace Codex.app/Contents/MacOS/workspace-launcher');
if(process.argv.length>2)throw Error('Launch without profile or debugging overrides');
if(!fs.existsSync(launcher))throw Error('Install the managed desktop package first');
const child=cp.spawn(launcher,[],{stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
