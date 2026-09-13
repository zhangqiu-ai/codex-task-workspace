import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/store.js';
import { callTool } from '../dist/tools.js';
import { createBoardServer } from '../dist/http.js';
const fixture=()=>{const home=mkdtempSync(join(tmpdir(),'task-workspace-test-'));const s=new Store(home);return {s,home,close(){this.s.close();rmSync(home,{recursive:true,force:true});}};};const task=(s)=>{const p=s.createProject({name:'Project'});return s.createTask({project_id:p.id,title:'Task'});};
test('moving a task changes project context and preserves task-owned data across reopen',()=>{
  const f=fixture();
  try {
    const t=task(f.s),destination=f.s.createProject({name:'Destination'});
    const memory={kind:'state',evidence:'test log',authority:'test_result'};
    callTool(f.s,'record_memory',{...memory,scope:'project',scope_id:t.project_id,content:'Original project fact'});
    callTool(f.s,'record_memory',{...memory,scope:'project',scope_id:destination.id,content:'Destination project fact'});
    const taskMemory=callTool(f.s,'record_memory',{...memory,scope:'task',scope_id:t.id,content:'Task fact'});
    f.s.attach({task_id:t.id,session_id:'moving-session'});
    f.s.linkGit({task_id:t.id,session_id:'moving-session',repo_path:'/original-repo',branch:'feature/task'});
    callTool(f.s,'update_task',{task_id:t.id,status:'doing',focus:true});
    f.s.setActive({task_id:t.id});
    const before=f.s.context(t.id);
    const moved=callTool(f.s,'update_task',{task_id:t.id,project_id:destination.id});
    assert.equal(moved.project_id,destination.id);
    f.s.close();f.s=new Store(f.home);
    const context=f.s.context(t.id);
    assert.equal(context.project.id,destination.id);
    assert.equal(context.task.id,t.id);
    assert.equal(context.task.status,'doing');
    assert.equal(context.task.focus,1);
    assert.equal(f.s.state().workspace.active_task_id,t.id);
    assert.equal(context.task_memory,before.task_memory);
    assert.equal(readFileSync(taskMemory.path,'utf8'),context.task_memory);
    assert.deepEqual(context.sessions.map(s=>s.id),['moving-session']);
    assert.deepEqual(context.git,before.git);
    assert.match(context.project_memory,/Destination project fact/);
    assert.doesNotMatch(context.project_memory,/Original project fact/);
    assert.equal(f.s.facts('project',t.project_id)[0].content,'Original project fact');
    assert.equal(f.s.facts('project',destination.id).length,1);
    const continuation=f.s.continueTask(t.id);
    assert.equal(continuation.resume_session_id,'moving-session');
    assert.match(continuation.prompt,/Destination project fact/);
    assert.doesNotMatch(continuation.prompt,/Original project fact/);
  } finally {f.close();}
});
test('invalid project move rejects the entire task update',()=>{
  const f=fixture();
  try {
    const t=task(f.s),before=f.s.task(t.id);
    assert.throws(()=>callTool(f.s,'update_task',{task_id:t.id,project_id:'missing',status:'doing',focus:true}));
    assert.deepEqual(f.s.task(t.id),before);
    assert.throws(()=>callTool(f.s,'update_task',{task_id:t.id,project_id:'',status:'blocked'}));
    assert.deepEqual(f.s.task(t.id),before);
  } finally {f.close();}
});
test('persistent hierarchy, explicit Active/Focus, rejects orphan tasks',()=>{const f=fixture();try{const t=task(f.s);callTool(f.s,'update_task',{task_id:t.id,status:'doing',focus:true});f.s.setActive({task_id:t.id});assert.throws(()=>f.s.createTask({project_id:'missing',title:'No'}));assert.throws(()=>callTool(f.s,'create_project',{name:'  '}));f.s.close();f.s=new Store(f.home);const state=f.s.state();assert.equal(state.tasks[0].status,'doing');assert.equal(state.workspace.active_task_id,t.id);assert.equal(state.tasks[0].focus,1);}finally{f.close();}});
test('session reassignment clears old AI assessment and remains one-to-one',()=>{const f=fixture();try{const a=task(f.s),b=task(f.s);f.s.attach({task_id:a.id,session_id:'s'});callTool(f.s,'assess_session',{task_id:a.id,session_id:'s',summary:'Implemented',relevance:1,implementation:1,authority:1,actionability:1,superseded:false,evidence:'test log'});assert.match(f.s.rank(a.id)[0].ranking_reason,/AI assessment/);f.s.attach({task_id:b.id,session_id:'s'});assert.equal(f.s.rank(a.id).length,0);assert.match(f.s.rank(b.id)[0].ranking_reason,/fallback/);assert.equal(f.s.all('SELECT * FROM session_assessments').length,0);}finally{f.close();}});
test('memory supersession is scoped, persisted and rendered from SQLite',()=>{const f=fixture();try{const t=task(f.s),other=task(f.s);const base={scope:'task',scope_id:t.id,kind:'state',evidence:'test log',authority:'test_result'};const a=callTool(f.s,'record_memory',{...base,content:'Old'});assert.throws(()=>callTool(f.s,'record_memory',{...base,scope_id:other.id,content:'Invalid',supersedes:a.id}));const b=callTool(f.s,'record_memory',{...base,content:'New',supersedes:a.id});assert.match(readFileSync(b.path,'utf8'),/New/);assert.doesNotMatch(f.s.context(t.id).task_memory,/\nOld\n/);assert.equal(f.s.all('SELECT * FROM memory_facts').length,2);const ctx=f.s.continueTask(t.id);assert.match(ctx.prompt,/New/);assert.equal(ctx.resume_session_id,null);assert.equal(f.s.promote({fact_id:b.id,target:'ADR'}).written,false);}finally{f.close();}});
test('hooks are idempotent and inbox is not silently assigned to Active Task',()=>{const f=fixture();try{const t=task(f.s);f.s.setActive({task_id:t.id});assert.equal(f.s.health().status,'unknown');const event={event_id:'e',event_name:'Stop',session_id:'hook-session'};f.s.ingestHook(event);assert.deepEqual(f.s.ingestHook(event),{duplicate:true});assert.equal(f.s.state().sessions[0].task_id,null);assert.equal(f.s.all('SELECT * FROM hook_events').length,1);assert.equal(f.s.health().status,'receiving');}finally{f.close();}});
test('Git session references must belong to linked task',()=>{const f=fixture();try{const t=task(f.s);assert.throws(()=>f.s.linkGit({task_id:t.id,session_id:'unknown',repo_path:'/repo',branch:'main'}));f.s.linkGit({task_id:t.id,repo_path:'/repo',branch:'main',commit_sha:'abcdef1'});assert.equal(f.s.context(t.id).git.length,1);}finally{f.close();}});
test('HTTP serves real state and rejects cross-origin writes / invalid tools',async()=>{const f=fixture();const server=createBoardServer(f.s);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;try{assert.equal((await fetch(url)).status,200);const localeAsset=await fetch(`${url}/i18n.js`);assert.equal(localeAsset.status,200);assert.match(localeAsset.headers.get('content-type'),/javascript/);const r=await fetch(`${url}/api/tools/create_project`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'HTTP project'})});assert.equal(r.status,200);assert.equal((await (await fetch(`${url}/api/state`)).json()).projects.length,1);assert.equal((await fetch(`${url}/api/tools/create_project`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'})).status,403);assert.equal((await fetch(`${url}/api/tools/toString`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);}finally{await new Promise(r=>server.close(r));f.close();}});
test('hook offsets normalize before monotonic recency comparison',()=>{const f=fixture();try{f.s.ingestHook({event_id:'a',event_name:'Stop',session_id:'s',at:'2026-09-13T08:00:00Z'});f.s.ingestHook({event_id:'b',event_name:'Stop',session_id:'s',at:'2026-09-13T09:00:00+08:00'});assert.equal(f.s.state().sessions[0].updated_at,'2026-09-13T08:00:00.000Z');}finally{f.close();}});
test('HTTP preserves split UTF-8 task text',async()=>{const {request}=await import('node:http');const f=fixture(),server=createBoardServer(f.s);await new Promise(r=>server.listen(0,'127.0.0.1',r));const bytes=Buffer.from(JSON.stringify({name:'中文项目'})),split=bytes.indexOf(Buffer.from('中'))+1;try{const response=await new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:server.address().port,path:'/api/tools/create_project',method:'POST',headers:{'Content-Type':'application/json'}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(JSON.parse(Buffer.concat(chunks).toString())));});req.on('error',reject);req.write(bytes.subarray(0,split));setImmediate(()=>req.end(bytes.subarray(split)));});assert.equal(response.name,'中文项目');}finally{await new Promise(r=>server.close(r));f.close();}});
test('hook CLI persists metadata and failure does not report successful receipt',async()=>{const {spawnSync}=await import('node:child_process');const f=fixture();try{const env={...process.env,TASK_WORKSPACE_HOME:f.home};const r=spawnSync(process.execPath,['dist/hooks.js'],{env,input:JSON.stringify({hook_event_name:'Stop',session_id:'cli-session',turn_id:'turn-1',prompt:'MUST_NOT_PERSIST'}),encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout,'');assert.equal(f.s.state().sessions.length,1);const bad=spawnSync(process.execPath,['dist/hooks.js'],{env,input:'{bad',encoding:'utf8'});assert.equal(bad.status,1);assert.equal(f.s.all('SELECT * FROM hook_events').length,1);assert.ok(!JSON.stringify(f.s.state()).includes('MUST_NOT_PERSIST'));}finally{f.close();}});
