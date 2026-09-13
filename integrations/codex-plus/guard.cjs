// The native launcher must select the original profile before host initialization.
const path=require('node:path');
const fs=require('node:fs');
const resources=path.resolve(__dirname,'../../..');
const [home,profile]=fs.readFileSync(path.join(resources,'workspace-host-paths'),'utf8').trimEnd().split('\n');
if(process.env.WORKSPACE_SHARED_PROFILE_READY!=='1'||process.env.CODEX_HOME!==home||process.env.CODEX_ELECTRON_USER_DATA_PATH!==profile)throw Error('Open Workspace through its managed launcher to reuse the original Codex profile');
