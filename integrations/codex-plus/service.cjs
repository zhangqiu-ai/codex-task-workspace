const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
// Keep one private origin across restarts so browser settings remain available.
function createService({resourcesPath,home,spawnImpl=spawn,exists=fs.existsSync,timeoutMs=15000}){
 let child,ready,url,cancel;
 const runtime=path.join(resourcesPath,'workspace-runtime');
 const start=()=>{
  if(ready)return ready;
  if(!exists(path.join(runtime,'node')))return Promise.reject(Error('Packaged board runtime is missing'));
  let savedPort;
  const portFile=path.join(home,'board-port');
  try{
   fs.mkdirSync(home,{recursive:true,mode:0o700});
   if(fs.lstatSync(home).isSymbolicLink())throw Error('Private board directory must not be a symlink');
   fs.chmodSync(home,0o700);
   if(fs.existsSync(portFile)){
    if(!fs.lstatSync(portFile).isFile()||fs.lstatSync(portFile).isSymbolicLink())throw Error('Invalid saved board port file');
    const text=fs.readFileSync(portFile,'utf8').trim();
    if(!/^[0-9]+$/.test(text)||Number(text)<1024||Number(text)>65535)throw Error('Invalid saved board port');
    savedPort=Number(text);fs.chmodSync(portFile,0o600);
   }
  }catch(error){return Promise.reject(error);}
  ready=new Promise((resolve,reject)=>{
   const current=child=spawnImpl(path.join(runtime,'node'),[path.join(runtime,'dist/http.js')],{cwd:runtime,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,TASK_WORKSPACE_HOME:home,TASK_WORKSPACE_CODEX_HOME:process.env.TASK_WORKSPACE_CODEX_HOME||path.join(require('node:os').homedir(),'.codex'),PORT:String(savedPort||0)},stdio:['ignore','pipe','pipe','ipc']});
   let output='',settled=false;
   const fail=(message='Local board service exited before startup')=>{clearTimeout(timer);if(child===current){child=null;url=null;ready=null;cancel=null;}if(!settled){settled=true;reject(Error(typeof message==='string'?message:'Local board service exited before startup'));}};
   const timer=setTimeout(()=>{fail('Local board startup timed out');current.kill();},timeoutMs);
   cancel=()=>{fail('Local board service stopped');if(!current.killed)current.kill();};
   child.once('error',fail);child.once('exit',()=>fail(portConflict?'Saved board port is occupied; quit the other service and retry':undefined));
   let portConflict=false;
   child.stderr.on('data',chunk=>{if(String(chunk).includes('EADDRINUSE'))portConflict=true;}); // drain; no user data in renderer logs
   child.stdout.on('data',chunk=>{output=(output+chunk).slice(-4096);const match=output.match(/Task Workspace: (http:\/\/127\.0\.0\.1:(\d+)\/?)\s/);if(match&&!settled){const port=Number(match[2]);if(port<1024||port>65535||savedPort&&port!==savedPort){fail('Board service returned an unexpected port');current.kill();return;}
    try{if(!savedPort)fs.writeFileSync(portFile,String(port)+'\n',{mode:0o600,flag:'wx'});}catch(error){fail('Cannot save private board port: '+error.message);current.kill();return;}
    settled=true;clearTimeout(timer);url=match[1].replace(/\/?$/,'/');resolve(url);}});
  });
  return ready;
 };
 return {start,get url(){return url;},stop(){cancel?.();}};
}
module.exports={createService};
