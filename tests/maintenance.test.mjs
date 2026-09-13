import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../dist/store.js';
import {backupDatabase,restoreDatabase,inspectDatabase} from '../dist/maintenance.js';
test('online WAL backup and fresh restore preserve committed data and refuse overwrite',()=>{
 const root=mkdtempSync(join(tmpdir(),'workspace-maintenance-')),home=join(root,'data'),backup=join(root,'backup'),restored=join(root,'restored');
 const store=new Store(home);
 try{
  const project=store.createProject({name:'真实中文'}),task=store.createTask({project_id:project.id,title:'持久化任务'});
  store.recordMemory({scope:'task',scope_id:task.id,kind:'decision',content:'已确认',evidence:'测试',authority:'user'});
  assert.equal(backupDatabase(home,backup).counts.tasks,1);
  store.createTask({project_id:project.id,title:'备份后的任务'});
  assert.equal(restoreDatabase(backup,restored).counts.tasks,1);
  assert.throws(()=>restoreDatabase(backup,home),/already exists/);
  assert.throws(()=>backupDatabase(home,backup),/already exists/);
  assert.equal(inspectDatabase(join(home,'workspace.sqlite')).counts.tasks,2);
  assert.equal(statSync(join(backup,'workspace.sqlite')).mode&0o777,0o600);
  const copy=new Store(restored);try{assert.equal(copy.task(task.id).title,'持久化任务');assert.match(copy.render('task',task.id),/已确认/);}finally{copy.close();}
  assert.equal(existsSync(join(restored,'memories')),false);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
