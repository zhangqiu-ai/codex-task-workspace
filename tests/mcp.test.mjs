import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('MCP exits cleanly when its host closes stdin', () => {
  const home = mkdtempSync(join(tmpdir(), 'task-mcp-eof-'));
  try {
    const result = spawnSync(process.execPath, ['dist/mcp.js'], {
      env: { ...process.env, TASK_WORKSPACE_HOME: home }, input: '', encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('real MCP initialize, list and create/context roundtrip',async()=>{const home=mkdtempSync(join(tmpdir(),'task-mcp-'));const transport=new StdioClientTransport({command:process.execPath,args:['dist/mcp.js'],env:{...process.env,TASK_WORKSPACE_HOME:home},stderr:'pipe'});const client=new Client({name:'test',version:'1'});try{await client.connect(transport);const list=await client.listTools();assert.equal(list.tools.length,17);const invoke=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError);return JSON.parse(r.content[0].text);};const p=await invoke('create_project',{name:'MCP'});const t=await invoke('create_task',{project_id:p.id,title:'Roundtrip'});assert.equal((await invoke('continue_task',{task_id:t.id})).task.id,t.id);const bad=await client.callTool({name:'create_task',arguments:{project_id:p.id,title:''}});assert.equal(bad.isError,true);}finally{await client.close();rmSync(home,{recursive:true,force:true});}});
