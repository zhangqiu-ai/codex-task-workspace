import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../ui/app.js',import.meta.url),'utf8');
test('read-only detail and project requests time out, writes are not aborted or retried',async()=>{
 const requests=[],timeouts=[];
 const context=vm.createContext({JSON,AbortSignal:{timeout:ms=>{timeouts.push(ms);return 'read-signal';}},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({})};}});
 vm.runInContext(source.slice(source.indexOf('async function api'),source.indexOf('let refreshSequence')),context);
 await vm.runInContext("api('get_task_context',{})",context);await vm.runInContext("api('list_codex_projects',{})",context);await vm.runInContext("api('update_task',{})",context);
 assert.deepEqual(timeouts,[10000,10000]);assert.equal(requests[0].options.signal,'read-signal');assert.equal(requests[2].options.signal,undefined);assert.equal(requests.length,3);
 context.fetch=async()=>{throw Error('timeout');};await assert.rejects(vm.runInContext("api('get_task_context',{})",context),/timeout/);
});
test('notice close is accessible and clears text while later notices can reopen',()=>{
 const container={hidden:true,replaceChildren(...children){this.children=children;}};
 const context=vm.createContext({language:'en',localizeError:(_,raw)=>raw,node:()=>({dataset:{}}),button:(text,action)=>({text,action,classList:{add(){}}}),attr:(n,name,key)=>n[name]=key});
 vm.runInContext(source.slice(source.indexOf('function showNotice'),source.indexOf('function report')),context);
 context.container=container;vm.runInContext("showNotice(container,'Failed to fetch')",context);
 assert.equal(container.hidden,false);assert.equal(container.children[0].dataset.error,'Failed to fetch');assert.equal(container.children[1]['aria-label'],'关闭');
 container.children[1].action();assert.equal(container.hidden,true);assert.equal(container.children.length,0);
 vm.runInContext("showNotice(container,'Another error')",context);assert.equal(container.hidden,false);assert.equal(container.children[0].textContent,'Another error');
});
