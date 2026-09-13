const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('./service.cjs');
test('packaged service starts without an existing server and retains one endpoint and SQLite contents across restarts',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-service-')));
 const runtime=path.join(root,'workspace-runtime');fs.mkdirSync(runtime);
 const repo=path.resolve(__dirname,'../..');
 for(const name of ['dist','ui'])fs.cpSync(path.join(repo,name),path.join(runtime,name),{recursive:true});
 fs.symlinkSync(path.join(repo,'node_modules'),path.join(runtime,'node_modules')); 
 fs.symlinkSync(process.execPath,path.join(runtime,'node'));
 fs.copyFileSync(path.join(repo,'package.json'),path.join(runtime,'package.json'));
 const service=createService({resourcesPath:root,home:path.join(root,'data')});
 try{const [a,b]=await Promise.all([service.start(),service.start()]);assert.equal(a,b);assert.match(a,/^http:\/\/127.0.0.1:\d+\/$/);const res=await fetch(a+'api/state');assert.equal(res.status,200);assert.ok((await res.json()).workspace);const created=await fetch(a+'api/tools/create_project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'persisted project'})});assert.equal(created.status,200);service.stop();await new Promise(r=>setTimeout(r,200));const restarted=await service.start();assert.equal(restarted,a);const state=await (await fetch(restarted+'api/state')).json();assert.ok(state.projects.some(p=>p.name==='persisted project'));assert.equal(fs.statSync(path.join(root,'data')).mode&0o777,0o700);assert.equal(fs.statSync(path.join(root,'data/board-port')).mode&0o777,0o600);const foreign=await fetch(a+'api/state',{headers:{Origin:'https://example.com'}});assert.equal(foreign.status,403);service.stop();await new Promise(r=>setTimeout(r,150));const occupied=require('node:net').createServer();await new Promise((resolve,reject)=>{occupied.once('error',reject);occupied.listen(Number(new URL(a).port),'127.0.0.1',resolve);});try{await assert.rejects(service.start(),/port is occupied/);assert.equal(service.url,null);}finally{await new Promise(resolve=>occupied.close(resolve));}}finally{service.stop();await new Promise(r=>setTimeout(r,100));fs.rmSync(root,{recursive:true,force:true});}
});
test('missing runtime cannot silently attach to an unrelated local service',async()=>{const s=createService({resourcesPath:'/missing',home:'/missing',exists:()=>false});await assert.rejects(s.start(),/runtime is missing/);});
test('stopping startup rejects promptly; old exit cannot invalidate a new service',async(t)=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-service-mock-')));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const {EventEmitter}=require('node:events');const children=[];
 const service=createService({resourcesPath:temp,home:path.join(temp,'data'),exists:()=>true,spawnImpl:()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{c.killed=true;};children.push(c);return c;}});
 const pending=service.start();const rejected=assert.rejects(pending,/stopped/);service.stop();await rejected;
 const next=service.start();children[1].stdout.emit('data','Task Workspace: http://127.0.0.1:12345\n');assert.equal(await next,'http://127.0.0.1:12345/');
 children[0].emit('exit',0);assert.equal(service.url,'http://127.0.0.1:12345/');assert.equal(await service.start(),service.url);service.stop();assert.equal(service.url,null);
});
test('invalid saved ports fail before any child starts',async(t)=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-service-port-')));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 for(const value of ['0','1023','65536','1234.5','abc']){
  fs.writeFileSync(path.join(temp,'board-port'),value);
  const service=createService({resourcesPath:temp,home:temp,exists:()=>true,spawnImpl:()=>{throw Error('must not spawn');}});
  await assert.rejects(service.start(),/Invalid saved board port/);
 }
});
