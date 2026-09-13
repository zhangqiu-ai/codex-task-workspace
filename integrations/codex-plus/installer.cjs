// Managed app delivery. No original app or user data is removed by this module.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const PIN = '759b60d66b0399517cac3a2cbe815ccd7b8d5981';
const NAME = 'Workspace Codex.app';
const RECEIPT = 'workspace-install.json';

function safeRoot(input) {
  const root = path.resolve(input);
  if (root === path.parse(root).root || root === os.homedir()) throw Error('Choose a dedicated installation directory');
  let cursor = root;
  while (true) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('Installation paths must not contain symlinks');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return root;
}
function receiptAt(root) {
  const file = path.join(root, RECEIPT);
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) throw Error('Invalid receipt path');
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (receipt.format !== 1 || receipt.owner !== 'codex-task-workspace' || receipt.root !== root || receipt.app !== NAME) throw Error('Unrecognized installation receipt');
  for (const name of [NAME, 'previous.backup']) {
    const file = path.join(root, name);
    if (fs.existsSync(file) && (!fs.lstatSync(file).isDirectory() || fs.lstatSync(file).isSymbolicLink())) throw Error('Invalid managed app path');
  }
  return receipt;
}
function running(app) {
  const lines = cp.execFileSync('/bin/ps', ['-axo', 'command='], {encoding: 'utf8'}).split('\n');
  return lines.some(line => line.trimStart().startsWith(app + '/Contents/'));
}
async function build(source, target, patcherRoot, runtime) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('App installation currently supports macOS only');
  if (!patcherRoot) throw Error('A pinned patcher checkout is required (--patcher-root)');
  if (fs.existsSync(path.join(patcherRoot, '.git'))) {
    if (cp.execFileSync('git', ['rev-parse', 'HEAD'], {cwd: patcherRoot, encoding: 'utf8'}).trim() !== PIN) throw Error('Patcher revision mismatch');
    if (cp.execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: patcherRoot, encoding: 'utf8'}).trim()) throw Error('Patcher tracked files are modified');
  } else {
    if (fs.readFileSync(path.join(patcherRoot, 'PINNED_REVISION'), 'utf8').trim() !== PIN) throw Error('Patcher revision mismatch');
    const hashes = JSON.parse(fs.readFileSync(path.join(patcherRoot, 'SHA256SUMS.json'), 'utf8'));
    for (const file of ['src/core/patch-engine.js', 'src/core/asar.js', 'src/core/app-identity.js', 'src/core/plist.js', 'src/core/source-capabilities.js', 'src/runtime/assets.js']) {
      const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(patcherRoot, file))).digest('hex');
      if (hashes[file] !== hash) throw Error('Packaged patcher checksum mismatch: ' + file);
    }
  }
  runtime = path.resolve(runtime || path.join(__dirname, '../../runtime'));
  for (const file of ['node', 'workspace-launcher', 'dist/http.js', 'ui/index.html', 'package.json', 'node_modules']) {
    if (!fs.existsSync(path.join(runtime, file))) throw Error('Release runtime missing: ' + file);
  }
  const engine = require(path.join(path.resolve(patcherRoot), 'src/core/patch-engine.js'));
  const patch = require('./patch.cjs');
  engine.selectPatch([patch], engine.getAppIdentity(source));
  await engine.applyPatchSet({sourceApp: source, targetApp: target, patchSet: patch, progress: () => {}});
  fs.cpSync(runtime, path.join(target, 'Contents/Resources/workspace-runtime'), {recursive: true, verbatimSymlinks: true});
  fs.copyFileSync(path.join(runtime,'workspace-launcher'),path.join(target,'Contents/MacOS/workspace-launcher'));
  fs.chmodSync(path.join(target,'Contents/MacOS/workspace-launcher'),0o755);
  cp.execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleExecutable workspace-launcher',path.join(target,'Contents/Info.plist')]);
  const originalName=cp.execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',path.join(source,'Contents/Info.plist')],{encoding:'utf8'}).trim();
  const sharedPaths=[path.join(os.homedir(),'.codex'),path.join(os.homedir(),'Library/Application Support/Codex'),path.join(source,'Contents/MacOS',originalName)];
  if(sharedPaths.some(p=>p.includes('\n')||p.includes('\r')))throw Error('Unsupported host path');
  fs.writeFileSync(path.join(target,'Contents/Resources/workspace-host-paths'),sharedPaths.join('\n')+'\n',{mode:0o600});
  const entitlements = path.join(path.dirname(target), 'entitlements.plist');
  fs.writeFileSync(entitlements, cp.execFileSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', target]));
  const signArgs=['--force','--deep','--sign','-'];
  if(fs.readFileSync(entitlements,'utf8').trim())signArgs.push('--entitlements',entitlements);
  cp.execFileSync('/usr/bin/codesign',[...signArgs,target]);
  cp.execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
  engine.selectPatch([patch], engine.getAppIdentity(source));
}
async function manage(command, options = {}, dependencies = {}) {
  const root = safeRoot(options.root || path.join(os.homedir(), 'Applications', 'Task Workspace'));
  const app = path.join(root, NAME), previous = path.join(root, 'previous.backup');
  const isRunning = dependencies.running || running;
  if (command === 'doctor') {
    const receipt = receiptAt(root);
    return {root, installed: !!receipt && fs.existsSync(app), rollbackAvailable: !!receipt && fs.existsSync(previous), app, receipt};
  }
  if (command === 'recover') return recover(root, isRunning);
  if (!['install', 'update', 'rollback', 'uninstall'].includes(command)) throw Error('Expected install, update, rollback, uninstall or doctor');
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  const lock = path.join(root, '.installer-lock');
  try { fs.mkdirSync(lock, {mode: 0o700}); } catch { throw Error('Another installation may be active; inspect .installer-lock before retrying'); }
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({pid: process.pid}));
  let stage;
  try {
    const receipt = receiptAt(root);
    if (fs.existsSync(path.join(root, '.install-journal.json')) || fs.existsSync(path.join(root,'.rollback-journal.json'))) throw Error('Interrupted update found; run recover');
    if (command === 'install' && (receipt || fs.existsSync(app) || fs.existsSync(previous))) throw Error('Installation exists; use update');
    if (command !== 'install' && (!receipt || (command !== 'uninstall' && !fs.existsSync(app)))) throw Error('No managed installation found');
    if (isRunning(app) || isRunning(previous)) throw Error('Quit Workspace Codex before changing its installation');
    if (command === 'uninstall') {
      // Receipt authorizes only these two bundle paths. State and databases survive.
      if(fs.existsSync(app))fs.rmSync(app, {recursive: true});
      if (fs.existsSync(previous)) fs.rmSync(previous, {recursive: true});
      fs.unlinkSync(path.join(root, RECEIPT));
      return {uninstalled: true, preservedData: root};
    }
    if (command === 'rollback') {
      if (!fs.existsSync(previous)) throw Error('No previous app available');
      if(receipt.profileMode==='shared'&&receipt.previousProfileMode!=='shared')throw Error('Previous build used isolated state; rollback would hide current projects. Install a shared-profile build instead');
      const swap = path.join(root, '.rollback-app');
      if (fs.existsSync(swap)) throw Error('Interrupted rollback requires inspection');
      const journal=path.join(root,'.rollback-journal.json');
      fs.writeFileSync(journal,JSON.stringify({format:1,owner:'codex-task-workspace'}),{mode:0o600});
      fs.renameSync(app, swap);
      fs.renameSync(previous, app);
      fs.renameSync(swap, previous);
      fs.unlinkSync(journal);
      return {app, rolledBack: true};
    }
    const source = fs.realpathSync(options.source || '/Applications/ChatGPT.app');
    if (source === root || source.startsWith(root + path.sep) || root.startsWith(source + path.sep)) throw Error('Source must be outside installation directory');
    if(command==='update'&&fs.existsSync(path.join(root,'data','workspace.sqlite'))){
      const backups=path.join(root,'backups');fs.mkdirSync(backups,{recursive:true,mode:0o700});
      const rt=path.join(app,'Contents/Resources/workspace-runtime');
      cp.execFileSync(path.join(rt,'node'),[path.join(rt,'dist/maintenance.js'),'backup',path.join(backups,new Date().toISOString().replace(/[:.]/g,'-'))],{env:{...process.env,TASK_WORKSPACE_HOME:path.join(root,'data')}});
    }
    stage = fs.mkdtempSync(path.join(root, '.install-'));
    const stagedApp = path.join(stage, NAME);
    await (dependencies.build || build)(source, stagedApp, options.patcherRoot || process.env.WORKSPACE_PATCHER_ROOT, options.runtime);
    if (!fs.existsSync(stagedApp) || fs.lstatSync(stagedApp).isSymbolicLink() || !fs.lstatSync(stagedApp).isDirectory()) throw Error('Builder did not produce an app');
    // Recheck immediately before replacement; building may take several minutes.
    if (isRunning(app) || isRunning(previous)) throw Error('Workspace Codex started during installation; quit and retry');
    const installId = require('node:crypto').randomUUID();
    const newReceipt = {profileMode:'shared',previousProfileMode:receipt?.profileMode||null,installId, format: 1, owner: 'codex-task-workspace', root, app: NAME, source, patcherRevision: PIN, installedAt: new Date().toISOString()};
    fs.writeFileSync(path.join(stage, RECEIPT), JSON.stringify(newReceipt, null, 2) + '\n', {mode: 0o600});
    const oldPrevious = path.join(stage, 'older.backup');
    fs.writeFileSync(path.join(root, '.install-journal.json'), JSON.stringify({format:1, installId, stage:path.basename(stage), hadApp:!!receipt, hadPrevious:fs.existsSync(previous)}), {mode:0o600});
    if (fs.existsSync(previous)) fs.renameSync(previous, oldPrevious);
    let movedOld = false, promoted = false;
    try {
      if (fs.existsSync(app)) { fs.renameSync(app, previous); movedOld = true; }
      fs.renameSync(stagedApp, app); promoted = true;
      fs.renameSync(path.join(stage, RECEIPT), path.join(root, RECEIPT));
    } catch (error) {
      if (promoted) fs.renameSync(app, stagedApp);
      if (movedOld) fs.renameSync(previous, app);
      if (fs.existsSync(oldPrevious)) fs.renameSync(oldPrevious, previous);
      fs.unlinkSync(path.join(root, '.install-journal.json'));
      throw error;
    }
    fs.unlinkSync(path.join(root, '.install-journal.json'));
    fs.mkdirSync(path.join(root, 'data'), {recursive: true, mode: 0o700});
    return {app, updated: command === 'update', usesOriginalProfile: true};
  } finally {
    if (stage && !fs.existsSync(path.join(root, '.install-journal.json'))) fs.rmSync(stage, {recursive: true, force: true});
    fs.unlinkSync(path.join(lock, 'owner.json'));
    fs.rmdirSync(lock);
  }
}
function recover(root, isRunning) {
  const app = path.join(root, NAME), previous = path.join(root, 'previous.backup');
  if (isRunning(app) || isRunning(previous)) throw Error('Quit Workspace Codex before recovery');
  const lock = path.join(root, '.installer-lock');
  if (fs.existsSync(lock)) {
    const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error('Unknown installer lock owner');
    try { process.kill(owner.pid, 0); throw Error('Installer is still running'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const rollback=path.join(root,'.rollback-journal.json');
  if(fs.existsSync(rollback)){
    const marker=JSON.parse(fs.readFileSync(rollback,'utf8'));
    if(marker.format!==1||marker.owner!=='codex-task-workspace'||!receiptAt(root))throw Error('Invalid rollback journal');
    const swap=path.join(root,'.rollback-app');
    if(fs.existsSync(swap)){
      if(fs.lstatSync(swap).isSymbolicLink()||!fs.lstatSync(swap).isDirectory())throw Error('Invalid rollback stage');
      if(!fs.existsSync(app)&&fs.existsSync(previous))fs.renameSync(previous,app);
      if(fs.existsSync(app)&&!fs.existsSync(previous))fs.renameSync(swap,previous);
      else throw Error('Ambiguous rollback state');
    }else if(!fs.existsSync(app)||!fs.existsSync(previous))throw Error('Incomplete rollback state');
    fs.unlinkSync(rollback);
    if(fs.existsSync(lock)){fs.unlinkSync(path.join(lock,'owner.json'));fs.rmdirSync(lock);}
    return {recovered:true,app};
  }
  const file = path.join(root, '.install-journal.json');
  if (!fs.existsSync(file)) throw Error('No recovery journal; inspect interrupted installation manually');
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (journal.format !== 1 || !/^\.install-[a-zA-Z0-9]+$/.test(journal.stage) || typeof journal.installId !== 'string') throw Error('Invalid recovery journal');
  const stage = path.join(root, journal.stage), older = path.join(stage, 'older.backup');
  if (!fs.existsSync(stage) || fs.lstatSync(stage).isSymbolicLink()) throw Error('Missing or invalid recovery stage');
  const receipt = receiptAt(root);
  if (receipt?.installId !== journal.installId) {
    if (fs.existsSync(previous) && (fs.existsSync(older) || !journal.hadPrevious)) {
      if (fs.existsSync(app)) fs.renameSync(app, path.join(stage, 'discard.backup'));
      fs.renameSync(previous, app);
    } else if (!journal.hadApp && fs.existsSync(app)) {
      fs.renameSync(app, path.join(stage, 'discard.backup'));
    }
    if (fs.existsSync(older)) fs.renameSync(older, previous);
  }
  fs.rmSync(stage, {recursive:true});
  fs.unlinkSync(file);
  if (fs.existsSync(lock)) { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); }
  return {recovered:true, app};
}
function parse(args) {
  const [command, ...rest] = args, options = {};
  const keys = {'--source': 'source', '--root': 'root', '--patcher-root': 'patcherRoot', '--runtime': 'runtime'};
  for (let i = 0; i < rest.length; i += 2) {
    if (!keys[rest[i]] || !rest[i + 1] || rest[i + 1].startsWith('--')) throw Error('Options: --source PATH --root PATH --patcher-root PATH --runtime PATH');
    options[keys[rest[i]]] = rest[i + 1];
  }
  return {command, options};
}
module.exports = {manage, parse, safeRoot};
if (require.main === module) {
  Promise.resolve().then(() => { const {command, options} = parse(process.argv.slice(2)); return manage(command, options); }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
