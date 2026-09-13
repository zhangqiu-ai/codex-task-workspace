// Native page adapter: the board receives no Node access, preload or host IPC.
const {app,BrowserWindow,WebContentsView,ipcMain}=require('electron');
const path=require('node:path');
const {createService}=require('./workspace-service.cjs');
const service=createService({resourcesPath:path.dirname(app.getAppPath()),home:path.resolve(path.dirname(app.getAppPath()),'../../../data')});
const pages=new Map();
let boardURL='http://127.0.0.1:4317/';
ipcMain.handle('workspace:page',async(event,message)=>{
 const sender=event.sender;
 if(event.senderFrame!==sender.mainFrame||!/^app:\/\/-\/index\.html(?:[?#]|$)/.test(sender.getURL()))throw Error('Untrusted workspace sender');
 const win=BrowserWindow.fromWebContents(sender);
 if(!win||!message||!['show','hide','bounds'].includes(message.action))throw Error('Invalid page request');
 let entry=pages.get(win.id);
 if(message.action==='hide'){if(entry){entry.visible=false;entry.view.setVisible(false);}return {ok:true};}
 const b=message.bounds,area=win.getContentBounds();
 if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.x<0||b.y<0||b.width<1||b.height<1||b.x+b.width>area.width+2||b.y+b.height>area.height+2)throw Error('Invalid page bounds');
 if(!entry){
  if(message.action!=='show')return {ok:true};
  const view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'persist:workspace-board'}});
  entry={view,visible:false,loaded:false,pending:null};pages.set(win.id,entry);win.contentView.addChildView(view);
  view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  view.webContents.on('will-navigate',(e,url)=>{if(url!==boardURL)e.preventDefault();});
  view.webContents.on('will-redirect',(e,url)=>{if(url!==boardURL)e.preventDefault();});
  view.webContents.session.setPermissionRequestHandler((_wc,_p,callback)=>callback(false));
  win.once('closed',()=>{pages.delete(win.id);if(!view.webContents.isDestroyed())view.webContents.close();});
  view.setVisible(false);
 }
 entry.view.setBounds(Object.fromEntries(Object.entries(b).map(([k,v])=>[k,Math.round(v)])));
 if(message.action==='show'){
  entry.visible=true;
  if(!entry.loaded||!service.url){
   entry.pending??=service.start().then(url=>{boardURL=url;if(entry.view.webContents.isDestroyed())throw Error('Window closed');return entry.view.webContents.loadURL(url);}).then(()=>{entry.loaded=true;}).finally(()=>{entry.pending=null;});
   await entry.pending;
  }
  if(!entry.view.webContents.isDestroyed())entry.view.setVisible(entry.visible);
 }
 return {ok:true};
});
app.on('before-quit',()=>{service.stop();for(const {view} of pages.values())if(!view.webContents.isDestroyed())view.webContents.close();pages.clear();});
