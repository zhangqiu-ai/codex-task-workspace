const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
test('native launcher reuses original profile before host execution',{skip:process.platform!=='darwin'},async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-launch-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const macos=path.join(root,'Workspace Codex.app/Contents/MacOS');fs.mkdirSync(macos,{recursive:true});
 const launcher=path.join(macos,'workspace-launcher');cp.execFileSync('/usr/bin/clang',['-Wall','-Werror','-framework','CoreFoundation',path.join(__dirname,'launcher.c'),'-o',launcher]);
 fs.writeFileSync(path.join(macos,'ChatGPT'),'#!/bin/sh\nprintf "%s\\n" "$CODEX_HOME" "$CODEX_ELECTRON_USER_DATA_PATH" "$@"\n',{mode:0o755});
 fs.mkdirSync(path.join(macos,'../Resources'),{recursive:true});
 fs.writeFileSync(path.join(macos,'../Resources/workspace-host-paths'),[path.join(root,'original-home'),path.join(root,'original-profile'),'/no-running-original/ChatGPT'].join('\n')+'\n');
 const lines=cp.execFileSync(launcher,['--example'],{encoding:'utf8'}).trim().split('\n');
 assert.deepEqual(lines,[path.join(root,'original-home'),path.join(root,'original-profile'),'--example','--user-data-dir='+path.join(root,'original-profile')]);
 const original=path.join(root,'original-host');fs.copyFileSync('/bin/sleep',original);fs.chmodSync(original,0o755);
 const running=cp.spawn(original,['60']);t.after(()=>running.kill());await new Promise((resolve,reject)=>{running.once('spawn',resolve);running.once('error',reject);});
 fs.writeFileSync(path.join(macos,'../Resources/workspace-host-paths'),[path.join(root,'original-home'),path.join(root,'original-profile'),original].join('\n')+'\n');
 const rejected=cp.spawnSync(launcher,[],{encoding:'utf8',env:{...process.env,WORKSPACE_LAUNCHER_TEST:'1'}});assert.equal(rejected.status,1);assert.match(rejected.stderr,/Quit the running Codex/);
});
