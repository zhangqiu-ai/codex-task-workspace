import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverCodexProjects} from '../dist/codex-projects.js';
import {Store} from '../dist/store.js';
import {callTool} from '../dist/tools.js';
function fixture(){const home=mkdtempSync(join(tmpdir(),'codex-import-'));const state=join(home,'.codex-global-state.json');return {home,state,dir(name){const path=join(home,name);mkdirSync(path,{recursive:true});return path;},save(value){writeFileSync(state,JSON.stringify(value));},close(){rmSync(home,{recursive:true,force:true});}};}
test('discovery unions saved local formats, preserves primary labels and excludes mirrors, missing and nonlocal paths',()=>{
  const f=fixture();try{
    const a=f.dir('a'),b=f.dir('b'),c=f.dir('c'),mirror=f.dir('.chatgpt-projects/project'),alias=join(f.home,'alias'),mirrorAlias=join(f.home,'mirror-alias');
    symlinkSync(a,alias);symlinkSync(mirror,mirrorAlias);
    f.save({'local-projects':{a:{name:'Alpha',rootPaths:[a,b]},b:{name:'Beta',rootPaths:[b]},mirror:{name:'Mirror',rootPaths:[mirrorAlias]},'g-p-cloud':{name:'Cloud',rootPaths:[c]}},'electron-saved-workspace-roots':[alias,c,mirror,'ssh://remote/repo','relative',join(f.home,'missing')]});
    assert.deepEqual(discoverCodexProjects(f.home).projects,[{name:'Alpha',path:realpathSync(a)},{name:'Beta',path:realpathSync(b)},{name:'c',path:realpathSync(c)}]);
  }finally{f.close();}
});
test('missing, invalid and unsupported state fail safely without writes',()=>{
  const f=fixture();try{
    assert.equal(discoverCodexProjects(f.home).warning,'codex_state_unavailable');
    writeFileSync(f.state,'{');assert.deepEqual(discoverCodexProjects(f.home).projects,[]);
    for(const state of [[],null,{'local-projects':[]},{'electron-saved-workspace-roots':[1]}]){f.save(state);assert.equal(discoverCodexProjects(f.home).warning,'codex_state_invalid');}
    f.save({unrelated:true});assert.equal(discoverCodexProjects(f.home).warning,'codex_state_unsupported');
    f.save({'local-projects':{}});assert.deepEqual(discoverCodexProjects(f.home),{projects:[]});
  }finally{f.close();}
});
test('explicit import deduplicates canonical manual paths, persists and never alters source or auto-imports sessions',()=>{
  const f=fixture(),old=process.env.TASK_WORKSPACE_CODEX_HOME;let store;
  try{
    process.env.TASK_WORKSPACE_CODEX_HOME=f.home;
    const a=f.dir('a'),b=f.dir('b'),alias=join(f.home,'alias');symlinkSync(a,alias);
    f.save({'local-projects':{a:{name:'Alpha',rootPaths:[a]},b:{name:'Beta',rootPaths:[b]}}});
    const original=readFileSync(f.state,'utf8');store=new Store(join(f.home,'data'));
    const manual=store.createProject({name:'Manual',repo_path:alias});
    const listed=callTool(store,'list_codex_projects',{});
    assert.equal(listed.projects.find(p=>p.name==='Alpha').imported,true);
    assert.equal(listed.projects.find(p=>p.name==='Beta').imported,false);
    assert.deepEqual(callTool(store,'import_codex_project',{path:a}),{project:manual,imported:false});
    const imported=callTool(store,'import_codex_project',{path:b});assert.equal(imported.imported,true);assert.equal(imported.project.repo_path,realpathSync(b));
    assert.equal(callTool(store,'import_codex_project',{path:b}).imported,false);
    assert.throws(()=>callTool(store,'import_codex_project',{path:f.dir('unsaved')}),/no longer available/);
    f.save({'local-projects':{a:{name:'Alpha',rootPaths:[a]}}});assert.throws(()=>callTool(store,'import_codex_project',{path:b}),/no longer available/);
    writeFileSync(f.state,original);rmSync(b,{recursive:true});assert.throws(()=>callTool(store,'import_codex_project',{path:b}),/no longer available/);
    assert.equal(readFileSync(f.state,'utf8'),original);
    store.close();store=new Store(join(f.home,'data'));assert.equal(store.state().projects.length,2);assert.equal(store.state().tasks.length,0);assert.equal(store.state().sessions.length,0);
  }finally{store?.close();if(old===undefined)delete process.env.TASK_WORKSPACE_CODEX_HOME;else process.env.TASK_WORKSPACE_CODEX_HOME=old;f.close();}
});
