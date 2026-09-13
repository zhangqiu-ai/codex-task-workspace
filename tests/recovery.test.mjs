import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {Store} from '../dist/store.js';
import {inspectDatabase} from '../dist/maintenance.js';
test('abrupt writer termination preserves committed WAL and rolls back uncommitted task',async()=>{
 const home=mkdtempSync(join(tmpdir(),'workspace-crash-'));
 const child=spawn(process.execPath,['--input-type=module','-e',`import{Store}from './dist/store.js';const s=new Store(${JSON.stringify(home)});const p=s.createProject({name:'Crash'});s.createTask({project_id:p.id,title:'Committed'});s.db.exec('BEGIN IMMEDIATE');s.createTask({project_id:p.id,title:'Uncommitted'});process.stdout.write('ready');setInterval(()=>{},1000);`],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('writer timed out')),5000);t.unref();})]);
  child.kill('SIGKILL');await once(child,'exit');
  const recovered=new Store(home);try{assert.equal(recovered.state().tasks.length,1);assert.equal(recovered.state().tasks[0].title,'Committed');}finally{recovered.close();}
  assert.equal(inspectDatabase(join(home,'workspace.sqlite')).integrity,'ok');
 }finally{child.kill('SIGKILL');rmSync(home,{recursive:true,force:true});}
});
test('representative local workload retains 1000 tasks and 2000 session associations',()=>{
 const home=mkdtempSync(join(tmpdir(),'workspace-load-'));const s=new Store(home);
 try{
  s.transaction(()=>{for(let p=0;p<10;p++){const project=s.createProject({name:`Project ${p}`});for(let n=0;n<100;n++){const task=s.createTask({project_id:project.id,title:`Task ${n}`});for(let k=0;k<2;k++){const id=`${p}-${n}-${k}`;s.run('INSERT INTO sessions VALUES(?,?,?,?,?)',id,id,null,'2026-09-13T00:00:00Z','2026-09-13T00:00:00Z');s.run('INSERT INTO task_sessions VALUES(?,?,?)',task.id,id,'2026-09-13T00:00:00Z');}}}});
  const data=s.state();assert.equal(data.tasks.length,1000);assert.equal(data.sessions.length,2000);assert.equal(data.projects.length,10);
  assert.equal(inspectDatabase(join(home,'workspace.sqlite')).counts.tasks,1000);
 }finally{s.close();rmSync(home,{recursive:true,force:true});}
});
