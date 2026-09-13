const fs = require('node:fs');
const path = require('node:path');
const id = 'workspace-chatgpt-26.908.40834-8881';
function owned(fn, name, order) {return Object.assign(fn,{variantId:`${id}/${name}`,ownerPatchSetId:id,transformOrder:order});}
const patchSet = {
 id, codexVersion:'26.908.40834',bundleVersion:'8881',sourceFamily:'chatgpt',
 asarSha256:'bb40cd8811887363104a19291346af9595632e0e956316a1086b274fb8e3eafc',
 patches:[{id:'workspace-native-page',infoPlistStrings:{CFBundleIdentifier:'com.openai.workspace-dev',CFBundleDisplayName:'Workspace Codex',CFBundleName:'Workspace Codex'},fileTransforms:[
 ['.vite/build/main-DaMR-wdT.js',owned(t=>'require("./workspace-guard.cjs");\n'+t+'\nrequire("./workspace-host.cjs");\n','main',0)],
 ['.vite/build/preload.js',owned(t=>t+'\nrequire("electron").contextBridge.exposeInMainWorld("workspacePage",{send:m=>require("electron").ipcRenderer.invoke("workspace:page",m)});\n','preload',1)],
 ['webview/index.html',owned(t=>{if(t.split('</head>').length!==2)throw Error('HTML anchor mismatch');return t.replace('</head>','<script defer src="./assets/workspace-page.js"></script></head>');},'renderer',2)]
 ]}],
 assetFiles:[['.vite/build/workspace-service.cjs',fs.readFileSync(path.join(__dirname,'service.cjs'))],['.vite/build/workspace-guard.cjs',fs.readFileSync(path.join(__dirname,'guard.cjs'))],['.vite/build/workspace-host.cjs',fs.readFileSync(path.join(__dirname,'host.cjs'))],['webview/assets/workspace-page.js',fs.readFileSync(path.join(__dirname,'page.js'))]]
};
module.exports=patchSet;
