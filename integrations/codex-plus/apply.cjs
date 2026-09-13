const fs = require('node:fs');
const path = require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const root=process.env.WORKSPACE_PATCHER_ROOT;
if(!root)throw Error('Set WORKSPACE_PATCHER_ROOT to the codex-plus-patcher checkout');
const pinned='759b60d66b0399517cac3a2cbe815ccd7b8d5981';
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==pinned)throw Error('Patcher revision mismatch');
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim())throw Error('Patcher tracked files are modified');
const {getAppIdentity,selectPatch,collectFileTransforms}=require(path.join(root,'src/core/patch-engine.js'));
const {transformAsarBuffer}=require(path.join(root,'src/core/asar.js'));
const patch=require('./patch.cjs');
const source='/Applications/ChatGPT.app';
selectPatch([patch],getAppIdentity(source));
const result=transformAsarBuffer(fs.readFileSync(path.join(source,'Contents/Resources/app.asar')),collectFileTransforms(patch),{assetFiles:patch.assetFiles});
for(const [name,content] of result.contents){if((name.endsWith('.js')||name.endsWith('.cjs'))&&(patch.assetFiles.some(([file])=>file===name)||result.transformedFiles.some(x=>x.filePath===name))){const check=spawnSync(process.execPath,['--check'],{input:content,encoding:'utf8'});if(check.status!==0)throw Error(`Invalid JavaScript: ${name}: ${check.stderr}`);}}
if(process.argv.includes('--check')){console.log('Exact source identity, transforms and JavaScript syntax: PASS');process.exit(0);}
throw Error('Direct builds are retired. Use the managed installer to include the shared-profile launcher and runtime.');
