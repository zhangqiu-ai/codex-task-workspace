import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createBoardServer} from '../dist/http.js';

async function fixture(t){
  const server=createBoardServer({state:()=>({projects:[]})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return {port:server.address().port};
}
function send(port,{path='/api/state',method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.end(body);
  });
}
test('runtime rejects rebinding hosts, foreign origins and cross-site requests',async t=>{
  const {port}=await fixture(t);
  for(const headers of [{Host:`evil.test:${port}`},{Origin:'null'},{Origin:'https://evil.test'},{'Sec-Fetch-Site':'cross-site'}]){
    assert.equal((await send(port,{headers})).status,403);
  }
  assert.equal((await send(port,{headers:{Origin:`http://127.0.0.1:${port}`}})).status,200);
});
test('oversized chunked bodies return 413 and the server remains usable',async t=>{
  const {port}=await fixture(t);
  const response=await send(port,{path:'/api/tools/list_workspace',method:'POST',headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'},body:' '.repeat(65537)});
  assert.equal(response.status,413);
  assert.equal(response.headers.connection,'close');
  assert.equal((await send(port)).status,200);
});
test('malformed JSON is rejected and JSON media types are case insensitive',async t=>{
  const {port}=await fixture(t);
  const options={path:'/api/tools/list_workspace',method:'POST',headers:{'Content-Type':'Application/JSON; charset=utf-8'}};
  assert.equal((await send(port,{...options,body:'{'})).status,400);
  assert.equal((await send(port,{...options,body:'{}'})).status,200);
});
test('static allowlist rejects traversal and supplies browser hardening headers',async t=>{
  const {port}=await fixture(t);
  assert.equal((await send(port,{path:'/../src/http.ts'})).status,404);
  const response=await send(port,{path:'/app.js'});
  assert.equal(response.status,200);
  assert.equal(response.headers['x-content-type-options'],'nosniff');
  assert.match(response.headers['content-security-policy'],/frame-ancestors 'none'/);
});

import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
function launch(t,home,port='0',ipc=false,parentStdin=false){
  const child=spawn(process.execPath,['dist/http.js'],{env:{...process.env,TASK_WORKSPACE_HOME:home,PORT:String(port),NODE_NO_WARNINGS:'1',...(parentStdin?{TASK_WORKSPACE_PARENT_STDIN:'1'}:{})},stdio:ipc?['ignore','pipe','pipe','ipc']:[parentStdin?'pipe':'ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  t.after(()=>{if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');});
  return {child,exited,errors:()=>errors,ready:()=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Startup timed out')),5000);
    const check=()=>{const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}};
    child.stdout.on('data',check);child.once('exit',()=>{clearTimeout(timer);reject(Error(errors||'Exited before ready'));});check();
  })};
}
function dataHome(t){const root=mkdtempSync(join(tmpdir(),'http-lifecycle-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return join(root,'data');}
test('SIGTERM exits cleanly and restarting restores the same data',async t=>{
  const home=dataHome(t),first=launch(t,home),port=await first.ready();
  const created=await send(port,{path:'/api/tools/create_project',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Survives restart'})});
  assert.equal(created.status,200);const id=JSON.parse(created.body).id;
  first.child.kill('SIGTERM');assert.deepEqual(await first.exited,{code:0,signal:null});
  const second=launch(t,home,port);await second.ready();
  assert.equal(JSON.parse((await send(port)).body).projects.find(project=>project.id===id).name,'Survives restart');
  second.child.kill('SIGTERM');assert.deepEqual(await second.exited,{code:0,signal:null});
});
test('invalid ports do not create data and occupied ports exit with a concise diagnostic',async t=>{
  const home=dataHome(t),invalid=launch(t,home,'not-a-port');
  assert.equal((await invalid.exited).code,1);assert.equal(existsSync(home),false);assert.match(invalid.errors(),/PORT must/);
  const {port}=await fixture(t),blocked=launch(t,home,port);
  assert.equal((await blocked.exited).code,1);assert.match(blocked.errors(),/EADDRINUSE/);assert.doesNotMatch(blocked.errors(),/\n\s+at /);
  const restarted=launch(t,home);await restarted.ready();restarted.child.kill('SIGTERM');assert.equal((await restarted.exited).code,0);
});
test('request and header deadlines are bounded for a local service',()=>{
  const server=createBoardServer({});assert.equal(server.requestTimeout,15000);assert.equal(server.headersTimeout,10000);
});

test('desktop IPC disconnection shuts down the owned board service',{timeout:5000},async t=>{
 const instance=launch(t,dataHome(t),'0',true);await instance.ready();instance.child.disconnect();
 assert.deepEqual(await instance.exited,{code:0,signal:null});
});
test('sidecar stdin closure shuts down the owned board service',{timeout:5000},async t=>{
 const instance=launch(t,dataHome(t),'0',false,true);await instance.ready();instance.child.stdin.end();
 assert.deepEqual(await instance.exited,{code:0,signal:null});
});
