const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {manage, parse} = require('./installer.cjs');
function fixture(t) {
  // macOS /var is a symlink; production rejects symlinked installation roots.
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-installer-')));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const options = {root: path.join(temp, 'managed'), source: path.join(temp, 'original.app')};
  fs.mkdirSync(options.source); fs.writeFileSync(path.join(options.source, 'keep'), 'original');
  let version = 0;
  const deps = {running: () => false, build: async (_, target) => {fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'version'), String(++version));}};
  return {options, deps, temp, app: path.join(options.root, 'Workspace Codex.app')};
}
test('install, update, rollback and uninstall preserve original and all user state', async t => {
  const {options, deps, app} = fixture(t);
  await manage('install', options, deps);
  const data = path.join(options.root, 'data', 'user-data'); fs.writeFileSync(data, 'keep');
  await manage('update', options, deps);
  assert.equal(fs.readFileSync(path.join(app, 'version'), 'utf8'), '2');
  await manage('rollback', options, deps);
  assert.equal(fs.readFileSync(path.join(app, 'version'), 'utf8'), '1');
  assert.equal((await manage('doctor', options, deps)).rollbackAvailable, true);
  await manage('uninstall', options, deps);
  assert.equal(fs.existsSync(app), false);
  assert.equal(fs.readFileSync(data, 'utf8'), 'keep');
  assert.equal(fs.readFileSync(path.join(options.source, 'keep'), 'utf8'), 'original');
});
test('build failure leaves existing app and receipt unchanged', async t => {
  const {options, deps, app} = fixture(t);
  await manage('install', options, deps);
  const receipt = fs.readFileSync(path.join(options.root, 'workspace-install.json'), 'utf8');
  await assert.rejects(manage('update', options, {...deps, build: async () => {throw Error('bad signature');}}), /bad signature/);
  assert.equal(fs.readFileSync(path.join(app, 'version'), 'utf8'), '1');
  assert.equal(fs.readFileSync(path.join(options.root, 'workspace-install.json'), 'utf8'), receipt);
});
test('refuses unknown targets, running applications and forged receipt', async t => {
  const {options, deps} = fixture(t);
  await assert.rejects(manage('uninstall', options, deps), /No managed/);
  await manage('install', options, deps);
  await assert.rejects(manage('update', options, {...deps, running: () => true}), /Quit/);
  await assert.rejects(manage('install', options, deps), /exists/);
  fs.writeFileSync(path.join(options.root, 'workspace-install.json'), JSON.stringify({format:1, owner:'other'}));
  await assert.rejects(manage('uninstall', options, deps), /Unrecognized/);
});
test('rejects symlinked roots and managed app symlinks', async t => {
  const {options, deps, app, temp} = fixture(t);
  const alias = path.join(temp, 'alias'); fs.symlinkSync(temp, alias);
  await assert.rejects(manage('install', {...options, root:path.join(alias, 'managed')}, deps), /symlinks/);
  await manage('install', options, deps);
  fs.rmSync(app, {recursive:true}); fs.symlinkSync(options.source, app);
  await assert.rejects(manage('uninstall', options, deps), /Invalid managed/);
});
test('concurrent install lock and source overlap are refused', async t => {
  const {options, deps} = fixture(t);
  fs.mkdirSync(options.root); fs.mkdirSync(path.join(options.root, '.installer-lock'));
  await assert.rejects(manage('install', options, deps), /Another installation/);
  fs.rmdirSync(path.join(options.root, '.installer-lock'));
  await assert.rejects(manage('install', {...options, source:options.root}, deps), /outside/);
});
test('parses explicit portable paths and rejects malformed options', () => {
  assert.deepEqual(parse(['doctor','--root','/tmp/example']).options, {root:'/tmp/example'});
  assert.throws(() => parse(['install','--source']), /Options/);
});
test('recover restores parked previous app after interrupted promotion', async t => {
  const {options, deps, app} = fixture(t);
  await manage('install', options, deps);
  const stage = fs.mkdtempSync(path.join(options.root, '.install-'));
  fs.renameSync(app, path.join(options.root, 'previous.backup'));
  fs.mkdirSync(app); fs.writeFileSync(path.join(app, 'version'), 'broken-new');
  fs.writeFileSync(path.join(options.root, '.install-journal.json'), JSON.stringify({format:1, installId:'next', stage:path.basename(stage), hadApp:true, hadPrevious:false}));
  await manage('recover', options, deps);
  assert.equal(fs.readFileSync(path.join(app, 'version'), 'utf8'), '1');
  assert.equal(fs.existsSync(stage), false);
});
test('recovery cannot interfere with a live installer', async t => {
  const {options, deps} = fixture(t);
  fs.mkdirSync(options.root);
  const lock = path.join(options.root, '.installer-lock'); fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({pid:process.pid}));
  await assert.rejects(manage('recover', options, deps), /still running/);
});
test('recover completes interrupted rollback after either rename',async t=>{
 for(const phase of [1,2]){
  const {options,deps,app}=fixture(t);await manage('install',options,deps);await manage('update',options,deps);
  const previous=path.join(options.root,'previous.backup'),swap=path.join(options.root,'.rollback-app');
  fs.writeFileSync(path.join(options.root,'.rollback-journal.json'),JSON.stringify({format:1,owner:'codex-task-workspace'}));
  fs.renameSync(app,swap);if(phase===2)fs.renameSync(previous,app);
  await manage('recover',options,deps);
  assert.equal(fs.readFileSync(path.join(app,'version'),'utf8'),'1');
  assert.equal(fs.readFileSync(path.join(previous,'version'),'utf8'),'2');
 }
});
test('interrupted uninstall can be retried without deleting state',async t=>{
 const {options,deps,app}=fixture(t);await manage('install',options,deps);
 fs.writeFileSync(path.join(options.root,'data','keep'),'safe');fs.rmSync(app,{recursive:true});
 await manage('uninstall',options,deps);assert.equal(fs.readFileSync(path.join(options.root,'data','keep'),'utf8'),'safe');
});
