import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../ui/app.js',import.meta.url),'utf8');
function setup(){
 let calls=0,renders=0,details=0,timer,listener,value={tasks:[]};
 const notice={hidden:true};
 const context=vm.createContext({state:undefined,AbortSignal,JSON,$:()=>notice,localizedText:(n,text)=>n.textContent=text,refreshDetail:async()=>details++,document:{hidden:false,addEventListener:(_,fn)=>listener=fn},fetch:async()=>{calls++;return {ok:true,json:async()=>value};},render:()=>renders++,clearTimeout:()=>{},setTimeout:fn=>{timer=fn;}});
 vm.runInContext(source.slice(source.indexOf('let refreshSequence'),source.indexOf('function navigate')),context);
 return {context,notice,details:()=>details,run:()=>vm.runInContext('autoRefresh()',context),tick:()=>timer(),visible:()=>listener(),set:valueIn=>value=valueIn,counts:()=>({calls,renders})};
}
test('polling renders changes only, skips hidden pages and resumes on visibility',async()=>{
 const h=setup();await h.run();await h.tick();assert.deepEqual(h.counts(),{calls:2,renders:1});
 h.set({tasks:[{id:'new'}]});await h.tick();assert.deepEqual(h.counts(),{calls:3,renders:2});
 h.context.document.hidden=true;await h.tick();assert.equal(h.counts().calls,3);
 h.context.document.hidden=false;await h.visible();assert.equal(h.counts().calls,4);
});
test('hidden embedded views still perform their initial state load',async()=>{
 const h=setup();h.context.document.hidden=true;await h.run();assert.deepEqual(h.counts(),{calls:1,renders:1});
 await h.tick();assert.equal(h.counts().calls,1);
});
test('failed polling keeps data and schedules recovery without overlapping requests',async()=>{
 const h=setup();await h.run();h.context.fetch=async()=>{throw Error('offline');};await h.tick();assert.equal(h.counts().renders,1);
 let resolve;h.context.fetch=()=>new Promise(r=>resolve=r);const pending=h.tick();await h.run();resolve({ok:true,json:async()=>({tasks:[1]})});await pending;assert.equal(h.counts().renders,2);
});

test('connection failures are visible and recovery clears only the connection notice',async()=>{
 const h=setup();h.context.fetch=async()=>{throw Error('offline');};await h.run();assert.equal(h.notice.hidden,false);assert.match(h.notice.textContent,/无法连接/);
 h.context.fetch=async()=>({ok:true,json:async()=>({tasks:[]})});await h.tick();assert.equal(h.notice.hidden,true);assert.equal(h.details(),1);
 h.context.fetch=async()=>{throw Error('offline');};await h.tick();assert.match(h.notice.textContent,/上次读取/);
});
test('unchanged board state still refreshes open detail context',async()=>{const h=setup();await h.run();await h.tick();assert.equal(h.counts().renders,1);assert.equal(h.details(),2);});
