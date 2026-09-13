// Version-owned DOM adapter. Fail closed when this build's mount points are absent.
(() => {
 if (!window.workspacePage || window.workspaceAdapter) return;
 let opened=false, frame, content, entry, scheduled=false, lastBounds='';
 const resize=new ResizeObserver(()=>place());
 const host=window.workspacePage;
 const style=document.createElement('style');
 style.textContent=`#workspace-entry{border-radius:10px;color:inherit}#workspace-entry[aria-pressed=true]{background:#09836c22;color:#07816b}#workspace-surface{position:fixed;z-index:40;background:var(--color-bg-primary,#f7f9fb);color:var(--color-text-primary,#26313d)}#workspace-toolbar{height:48px;display:flex;align-items:center;gap:10px;padding:0 18px;-webkit-app-region:drag;border-bottom:1px solid #8882;font:500 14px system-ui}#workspace-toolbar button{-webkit-app-region:no-drag;border:0;background:transparent;color:inherit;cursor:pointer;font-size:20px;width:28px;height:28px}#workspace-message{padding:32px;font:14px system-ui}`;
 document.head.append(style);
 function bounds(){const r=content.getBoundingClientRect();return {x:Math.max(0,r.x),y:Math.max(0,r.y+48),width:r.width,height:Math.max(1,r.height-48)};}
 function place(){if(!opened||!content?.isConnected)return;const r=content.getBoundingClientRect();Object.assign(frame.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});const b=bounds(),key=JSON.stringify(b);if(key!==lastBounds){lastBounds=key;host.send({action:'bounds',bounds:b}).catch(console.error);}}
 function close(){if(!opened)return;opened=false;host.send({action:'hide'}).catch(console.error);frame?.remove();resize.disconnect();if(content)content.inert=false;entry?.setAttribute('aria-pressed','false');entry?.focus();}
 async function open(){if(opened)return;content=document.querySelector('main[class*="_MainContentSurface_"]');if(!content)return;opened=true;resize.observe(content);content.inert=true;entry.setAttribute('aria-pressed','true');frame=document.createElement('section');frame.id='workspace-surface';frame.innerHTML='<header id="workspace-toolbar"><button type="button" title="返回 Codex / Back to Codex" aria-label="返回 Codex / Back to Codex">‹</button><span>工作台 · Workspace</span></header><div id="workspace-message">正在连接本地看板… / Connecting…</div>';frame.querySelector('button').onclick=close;document.body.append(frame);const surface=frame;place();try{await host.send({action:'show',bounds:bounds()});if(opened&&frame===surface)surface.querySelector('#workspace-message').textContent='';}catch(e){if(opened&&frame===surface)surface.querySelector('#workspace-message').textContent='看板暂时不可用，请确认本地服务已启动。 / Board unavailable. Check the local service.';console.error(e);}}
 function mount(){const sidebar=document.querySelector('aside.app-shell-left-panel');const first=sidebar?.querySelector('button.sidebar-item');if(!first)return;if(!entry?.isConnected){entry=document.createElement('button');entry.type='button';entry.id='workspace-entry';entry.className=first.className;entry.setAttribute('aria-pressed',String(opened));entry.innerHTML='<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M7 6v8M12 6v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>工作台</span>';entry.title='工作台 / Workspace';entry.onclick=open;first.parentElement.before(entry);}
 if(opened&&!content?.isConnected)close();place();}
 const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;mount();});}});observer.observe(document.body,{childList:true,subtree:true});
 window.addEventListener('resize',place);
 document.addEventListener('click',e=>{if(opened&&e.target.closest('aside.app-shell-left-panel')&&!e.target.closest('#workspace-entry'))close();},true);
 document.addEventListener('keydown',e=>{if(opened&&e.key==='Escape')close();},true);
 window.workspaceAdapter={open,close,get opened(){return opened;}};mount();
})();
