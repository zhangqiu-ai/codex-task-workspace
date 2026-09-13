import { normalizeLanguage, translate, localizeError, localizeRankingReason, dictionaries } from './i18n.js';
let motionEnabled=true;try{motionEnabled=localStorage.getItem('task-workspace-motion')!=='false';}catch{}
function applyMotion(){document.documentElement.dataset.motion=motionEnabled?'on':'off';}
applyMotion();
let language;
try { language = normalizeLanguage(localStorage.getItem('task-workspace-language') || navigator.language); } catch { language = normalizeLanguage(navigator.language); }
const tr = (key, params) => translate(language, key, params);
function localizedText(n, key) { if (Object.hasOwn(dictionaries.en, key)) n.dataset.i18n = key; n.textContent = tr(key); }
function attr(n, name, key, params) { n.setAttribute(name, tr(key, params)); if (!params) n.setAttribute('data-i18n-' + name, key); }
function rankingNode(session) { const n=node('small');n.dataset.ranking=JSON.stringify({score:session.score,reason:session.ranking_reason}); updateRanking(n);return n;}
function updateRanking(n) {const {score,reason}=JSON.parse(n.dataset.ranking);n.textContent=`${score??'—'} · ${reason?localizeRankingReason(language,reason):tr('无排序说明')}`;}
function translatedNode(tag,key,params={}) {const n=document.createElement(tag);n.dataset.i18n=key;n.dataset.i18nParams=JSON.stringify(params);n.textContent=tr(key,params);return n;}
const $ = s => document.querySelector(s);
const node = (tag, text, cls, raw = false) => { const n = document.createElement(tag); if (text !== undefined) { if(raw) n.textContent=text; else localizedText(n, text); }; if (cls) n.className = cls; return n; };
const statuses = {todo:'待开始',doing:'进行中',blocked:'受阻',done:'已完成'};
let state, view = 'all', selected;
let detailSequence=0, detailSnapshot;
const button = (text, action, cls) => {const icons={'★ 已关注':'★','☆ 关注':'☆','设为当前任务':'◎','Continue Task':'▶','复制上下文':'⧉'};const n=node('button',icons[text]||text,cls); n.type='button';if(icons[text]){n.classList.add('glyph-button');attr(n,'title',text);attr(n,'aria-label',text);if(text.includes('关注'))n.setAttribute('aria-pressed',String(text.startsWith('★')));} n.addEventListener('click',async()=>{if(n.disabled||n.dataset.pending)return;n.dataset.pending='true';try{await action();}catch(e){report(e);}finally{delete n.dataset.pending;}}); return n;};
function showNotice(container,raw){
 const message=node('span',undefined,'notice-message');message.dataset.error=raw;message.textContent=localizeError(language,raw);
 const dismiss=button('×',()=>{container.hidden=true;container.replaceChildren();});attr(dismiss,'aria-label','关闭');attr(dismiss,'title','关闭');dismiss.classList.add('notice-dismiss');
 container.replaceChildren(message,dismiss);container.hidden=false;
}
function report(e) {const raw=e.message || String(e);showNotice($('#notice'),raw);const modal=$('#import-dialog').open?$('#import-dialog'):$('#form-dialog').open?$('#form-dialog'):$('#detail').open?$('#detail'):null;if(modal){let message=modal.querySelector('.modal-notice');if(!message){message=node('div',undefined,'modal-notice');message.setAttribute('role','status');modal.append(message);}showNotice(message,raw);}}
async function api(name,args) {const r=await fetch(`/api/tools/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),...(['get_task_context','list_codex_projects'].includes(name)?{signal:AbortSignal.timeout(10000)}:{})});const data=await r.json();if(!r.ok||data.error)throw new Error(typeof data.error==='string'?data.error:JSON.stringify(data.error||data));return data;}
let refreshSequence=0;
async function refresh(){
 const sequence=++refreshSequence;
 const r=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error('无法读取本地工作区');
 const next=await r.json();
 if(sequence!==refreshSequence)return;
 if(JSON.stringify(next)!==JSON.stringify(state)){state=next;render();}
 await refreshDetail();
 const notice=$('#connection-notice');notice.hidden=true;
}
let refreshTimer, autoRefreshing=false;
async function autoRefresh(){
 if(autoRefreshing)return;
 autoRefreshing=true;
 clearTimeout(refreshTimer);
 try{if(!document.hidden||!state)await refresh();}catch{const notice=$('#connection-notice');localizedText(notice,state?'连接已中断，正在重试。当前显示上次读取的数据。':'无法连接本地工作区，正在重试。');notice.hidden=false;}
 finally{autoRefreshing=false;refreshTimer=setTimeout(autoRefresh,3000);}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoRefresh();});

function navigate(id){if(!state)return;view=id;render();}
async function refreshDetail(){
 if(!$('#detail').open||!selected||$('#form-dialog').open||$('#import-dialog').open)return;
 if($('#detail-content').contains(document.activeElement))return;
 await openTask(selected,true);
}
function render(){
 const focused=document.activeElement;const focusKey=focused?.dataset.focusKey;
 renderContent();
 if(focusKey&&!focused.isConnected){document.querySelectorAll('[data-focus-key]').forEach(n=>{if(n.dataset.focusKey===focusKey)n.focus({preventScroll:true});});}
}
function renderContent(){
 const settingsOpen=view==='settings';
 $('#settings-page').hidden=!settingsOpen;$('#board').hidden=settingsOpen;$('#new-task').hidden=settingsOpen;
 $('#open-settings').classList.toggle('active',settingsOpen);
 document.querySelectorAll('[data-setting-language]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.settingLanguage===language)));$('#setting-motion').checked=motionEnabled;
 $('#settings-hook').textContent=tr(({unknown:'尚无事件',stale:'暂无近期事件',receiving:'正在接收'})[state.health?.status]||'未知');
 $('#settings-hook-note').title=tr(state.health?.message||'尚未收到事件');$('#settings-hook-note').setAttribute('aria-label',$('#settings-hook-note').title);
 $('#workspace-name').textContent=state.workspace.name;
 const nav=$('#navigation');nav.replaceChildren();[['all','▦','My Work'],['focus','☆','Focus'],['inbox','↓','Global Inbox']].forEach(([id,icon,title])=>{const count=id==='inbox'?state.sessions.filter(s=>!s.task_id).length:state.tasks.filter(t=>id==='all'||t.focus).length;const item=button(`${icon}  ${tr(title)}  · ${count}`,()=>navigate(id),view===id?'nav active':'nav');item.dataset.focusKey='nav:'+id;nav.append(item);});
 const projects=$('#projects');projects.replaceChildren();state.projects.forEach(p=>{const item=button(`●  ${p.name}`,()=>navigate(p.id),view===p.id?'nav active':'nav');item.dataset.focusKey='project:'+p.id;projects.append(item);});
 $('#view-title').textContent=view==='settings'?tr('设置'):view==='all'?tr('My Work'):view==='focus'?tr('Focus'):view==='inbox'?tr('Global Inbox'):state.projects.find(p=>p.id===view)?.name||tr('My Work');
 $('#view-title').title=tr(view==='inbox'?'为尚未归属的 AI 会话找到任务。':view==='focus'?'只看你标记为关注的工作。':'从一个清晰的下一步，继续你的工作。');

 document.querySelectorAll('.nav').forEach(n=>{if(n.classList.contains('active'))n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});
 if(settingsOpen){$('#view-title').title='';return;}
 const board=$('#board');board.replaceChildren();board.classList.toggle('inbox',view==='inbox');
 if(view==='inbox'){const sessions=state.sessions.filter(s=>!s.task_id);if(!sessions.length)board.append(node('div','收件箱已清空。未归属的会话会出现在这里。','empty'));sessions.forEach(s=>{const card=node('article',undefined,'card');card.append(node('h3',s.title||s.id,undefined,true),node('p',s.updated_at||'等待活动记录','muted'),button('关联任务',()=>form('关联到任务',[{name:'task_id',label:'任务',options:state.tasks.map(t=>[t.id,t.title])}],async values=>{await api('attach_session',{...values,session_id:s.id});await refresh();})));board.append(card);});return;}
 const tasks=state.tasks.filter(t=>view==='all'||(view==='focus'?t.focus:t.project_id===view));
 Object.entries(statuses).forEach(([status,label])=>{const col=node('section',undefined,'column');col.dataset.status=status;const list=tasks.filter(t=>t.status===status);const heading=node('h2');heading.append(node('span',label),node('span',String(list.length),'count'));col.append(heading);list.forEach(t=>{const card=button('',()=>openTask(t.id),'card task-card');card.dataset.focusKey='task:'+t.id;card.classList.toggle('is-active',t.id===state.workspace.active_task_id);const project=state.projects.find(p=>p.id===t.project_id);const top=node('div',undefined,'card-top');const projectLabel=node('span',project?.name||tr('项目'),'project-tag',true);projectLabel.title=project?.name||'项目';const meta=node('span',undefined,'card-meta');const sessionCount=state.sessions.filter(s=>s.task_id===t.id).length;const sessions=node('span',`◷ ${sessionCount}`);sessions.title=tr('sessionCount',{count:sessionCount});sessions.setAttribute('aria-label',tr('sessionCount',{count:sessionCount}));meta.append(sessions);if(t.focus){const star=node('span','★','focus-mark');attr(star,'title','已关注');attr(star,'aria-label','已关注');meta.append(star);}if(t.status==='doing'){const activity=node('span',undefined,'activity-dot');const label=t.id===state.workspace.active_task_id?'当前任务 · 状态为进行中':'任务状态为进行中';attr(activity,'title',label);attr(activity,'aria-label',label);meta.append(activity);}else if(t.id===state.workspace.active_task_id){const activeMark=node('span','●','active-label');attr(activeMark,'title','当前任务');attr(activeMark,'aria-label','当前任务');meta.append(activeMark);}top.append(projectLabel,meta);card.append(top,node('h3',t.title,undefined,true));col.append(card);});if(!list.length)col.append(node('p','暂无任务','empty'));board.append(col);});
}
function form(title,fields,submit){$('#form-dialog').querySelector('.modal-notice')?.remove();localizedText($('#form-title'),title);const container=$('#form-fields');container.replaceChildren();fields.forEach(f=>{const label=node('label');label.append(node('span',f.label));let input;if(f.options){input=node('select');f.options.forEach(([value,text])=>{const o=node('option',text,undefined,['task_id','project_id'].includes(f.name));o.value=value;input.append(o);});}else input=node(f.multiline?'textarea':'input');input.name=f.name;input.required=f.required!==false;if(f.value)input.value=f.value;label.append(input);container.append(label);});$('#entry-form').onsubmit=async e=>{e.preventDefault();const submitButton=e.submitter||e.target.querySelector('[type=submit]');if(submitButton.disabled)return;submitButton.disabled=true;try{await submit(Object.fromEntries(new FormData(e.target)));$('#form-dialog').close();}catch(e){report(e);}finally{submitButton.disabled=false;}};$('#form-dialog').showModal();}
async function openTask(id,background=false){const sequence=++detailSequence;selected=id;const ctx=await api('get_task_context',{task_id:id});if(sequence!==detailSequence||selected!==id||(background&&!$('#detail').open))return;const snapshot=JSON.stringify(ctx);if(background&&snapshot===detailSnapshot)return;if(background&&($('#form-dialog').open||$('#detail-content').contains(document.activeElement)))return;detailSnapshot=snapshot;const scrollTop=$('#detail').scrollTop;const root=$('#detail-content');const continueOutput=background?$('#continue-output'):null;root.replaceChildren();if(continueOutput)root.append(continueOutput);const projectField=node('label',undefined,'task-project-field');projectField.append(node('span','归属项目','label'));const projectSelect=node('select');attr(projectSelect,'aria-label','归属项目');attr(projectSelect,'title','切换任务归属项目');for(const p of state.projects){const option=node('option',p.name,undefined,true);option.value=p.id;projectSelect.append(option);}projectSelect.value=ctx.task.project_id;projectSelect.onchange=async()=>{projectSelect.disabled=true;try{await api('update_task',{task_id:id,project_id:projectSelect.value});await refresh();await openTask(id);}catch(e){projectSelect.value=ctx.task.project_id;report(e);}finally{projectSelect.disabled=false;}};projectField.append(projectSelect);root.append(projectField,node('h2',ctx.task.title,undefined,true));const actions=node('div',undefined,'detail-actions');const status=node('select');attr(status,'aria-label','任务状态');Object.entries(statuses).forEach(([value,text])=>{const o=node('option',text);o.value=value;status.append(o);});status.value=ctx.task.status;status.onchange=async()=>{status.disabled=true;try{await api('update_task',{task_id:id,status:status.value});ctx.task.status=status.value;await refresh();}catch(e){status.value=ctx.task.status;report(e);}finally{status.disabled=false;}};actions.append(status,button(ctx.task.focus?'★ 已关注':'☆ 关注',async()=>{await api('update_task',{task_id:id,focus:!ctx.task.focus});await refresh();await openTask(id);}),button('设为当前任务',async()=>{await api('set_active_task',{task_id:id});await refresh();}),button('Continue Task',async()=>{const result=await api('continue_task',{task_id:id});let area=$('#continue-output');if(!area){area=node('section');area.id='continue-output';root.prepend(area);}area.replaceChildren(node('h3','继续任务上下文'),translatedNode('p',result.resume_session_id?'resumeSession':'复制以下上下文，在 Codex 中发起会话。',{id:result.resume_session_id}));const textarea=node('textarea');textarea.value=result.prompt||'';textarea.readOnly=true;textarea.rows=9;attr(textarea,'aria-label','继续任务提示词');area.append(textarea,button('复制上下文',async()=>{await navigator.clipboard.writeText(textarea.value);report('已复制继续任务上下文');}));await refresh();},'primary'));root.append(actions);
 for(const [title,value] of [['任务记忆',ctx.task_memory],['项目记忆',ctx.project_memory]]){root.append(node('h3',title));const pre=node('pre',typeof value==='string'?value:value?JSON.stringify(value,null,2):'尚无记忆。记录决定、当前状态或下一步，让下次会话接得上。','memory',!!value);root.append(pre);}
 root.append(button('＋ 记录记忆',()=>form('记录记忆',[{name:'scope',label:'归属',options:[['task','当前任务'],['project','当前项目']]},{name:'kind',label:'类型',options:[['state','当前状态'],['decision','决定'],['next_action','下一步'],['issue','问题']]},{name:'content',label:'内容',multiline:true},{name:'evidence',label:'依据 / 来源'}],async v=>{await api('record_memory',{...v,scope_id:v.scope==='task'?id:ctx.project.id,authority:'user'});await openTask(id);})));root.append(node('h3','AI 会话 · 按相关性排序'));
 if(!ctx.sessions?.length)root.append(node('p','暂无关联会话。','muted'));for(const s of ctx.sessions||[]){const item=node('article',undefined,'session');item.append(node('strong',s.title||s.id,undefined,true),node('p',s.summary||tr('尚无会话摘要'),undefined,true),rankingNode(s));root.append(item);}
 root.append(button('＋ 关联会话',()=>form('关联会话',[{name:'session_id',label:'Session ID'},{name:'title',label:'会话名称',required:false}],async v=>{await api('attach_session',{task_id:id,session_id:v.session_id,...(v.title.trim()?{title:v.title.trim()}:{})});await refresh();await openTask(id);})));root.append(node('h3','Git 关联'));root.append(node('pre',ctx.git?.length?JSON.stringify(ctx.git,null,2):'尚无 branch / commit 关联','memory'));root.append(button('＋ 关联 Git',()=>form('关联 Git 分支 / 提交',[{name:'repo_path',label:'仓库绝对路径'},{name:'branch',label:'分支名称'},{name:'commit_sha',label:'Commit SHA（可选）',required:false}],async v=>{await api('link_git',{task_id:id,repo_path:v.repo_path.trim(),branch:v.branch.trim(),...(v.commit_sha.trim()?{commit_sha:v.commit_sha.trim()}:{})});await openTask(id);})));if(!$('#detail').open)$('#detail').showModal();if(background)$('#detail').scrollTop=scrollTop;}
for(const id of ['#detail','#form-dialog','#import-dialog'])$(id).addEventListener('close',()=>$(id).querySelector('.modal-notice')?.remove());
$('#detail').addEventListener('close',()=>{selected=undefined;detailSnapshot=undefined;detailSequence++;});
$('#close-detail').onclick=()=>$('#detail').close();$('#cancel-form').onclick=()=>$('#form-dialog').close();
async function showProjectImport(){
 const dialog=$('#import-dialog'),list=$('#import-projects');dialog.querySelector('.modal-notice')?.remove();list.replaceChildren(node('p','读取中…','muted'));if(!dialog.open)dialog.showModal();
 try{const result=await api('list_codex_projects',{});list.replaceChildren();if(result.warning)list.append(node('p',result.warning,'muted'));if(!result.projects.length)list.append(node('p','没有可导入的本地项目','muted'));
 for(const project of result.projects){const row=node('div',undefined,'import-project-row'),info=node('div',undefined,'import-project-info');info.append(node('strong',project.name,undefined,true),node('small',project.path,undefined,true));const action=button(project.imported?'已导入':'导入',async()=>{action.disabled=true;try{await api('import_codex_project',{path:project.path});await refresh();localizedText(action,'已导入');}catch(e){action.disabled=false;report(e);}});action.disabled=project.imported;row.append(info,action);list.append(row);}}
 catch(e){list.replaceChildren();report(e);}
}
$('#new-project').onclick=()=>showProjectImport();
$('#close-import').onclick=()=>$('#import-dialog').close();
$('#manual-project').onclick=()=>{$('#import-dialog').close();form('新建项目',[{name:'name',label:'项目名称'},{name:'repo_path',label:'项目目录（可选）',required:false}],async v=>{await api('create_project',{name:v.name,...(v.repo_path.trim()?{repo_path:v.repo_path.trim()}:{})});await refresh();});};
$('#new-task').onclick=()=>{if(!state){report('工作区尚未加载，请刷新重试。');return;}if(!state.projects.length){report('请先新建一个项目，再添加任务。');$('#new-project').click();return;}form('新建任务',[{name:'title',label:'任务名称'},{name:'project_id',label:'所属项目',options:state.projects.map(p=>[p.id,p.name]),value:state.projects.some(p=>p.id===view)?view:undefined}],async v=>{await api('create_task',v);await refresh();});};
autoRefresh();

function applyLanguage() {
 document.querySelectorAll('[data-ranking]').forEach(updateRanking);
 document.querySelectorAll('[data-error]').forEach(n=>n.textContent=localizeError(language,n.dataset.error));
 document.documentElement.lang=language==='zh'?'zh-CN':'en';
 document.querySelectorAll('[data-i18n]').forEach(n=>n.textContent=tr(n.dataset.i18n,JSON.parse(n.dataset.i18nParams||'{}')));
 for(const name of ['title','aria-label']) document.querySelectorAll('[data-i18n-'+name+']').forEach(n=>n.setAttribute(name,tr(n.getAttribute('data-i18n-'+name))));
 if(state) render();
}
applyLanguage();

$('#open-settings').onclick=()=>navigate('settings');
document.querySelectorAll('[data-setting-language]').forEach(b=>b.onclick=()=>{language=normalizeLanguage(b.dataset.settingLanguage);try{localStorage.setItem('task-workspace-language',language);}catch{}applyLanguage();});
$('#setting-motion').onchange=()=>{motionEnabled=$('#setting-motion').checked;try{localStorage.setItem('task-workspace-motion',String(motionEnabled));}catch{}applyMotion();};
