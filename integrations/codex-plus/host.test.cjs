const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function harness(url = 'app://-/index.html', load = () => Promise.resolve()) {
  const handlers = new Map(), views = [], app = new EventEmitter();
  app.getAppPath=()=>'/test/App.app/Contents/Resources/app.asar';
  const sender = { mainFrame: {}, getURL: () => url };
  const win = new EventEmitter();
  Object.assign(win, { id: 1, getContentBounds: () => ({ width: 1200, height: 800 }), contentView: { addChildView(view) { views.push(view); } } });
  class WebContentsView {
    constructor(options) {
      this.options = options;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        session: { setPermissionRequestHandler(fn) { this.permission = fn; } },
        setWindowOpenHandler(fn) { this.openWindow = fn; },
        loadURL(url) { this.url = url; this.loadCount = (this.loadCount || 0) + 1; return load(); },
        isDestroyed() { return Boolean(this.closed); },
        close() { this.closed = true; }
      });
    }
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(visible) { this.visible = visible; }
  }
  vm.runInNewContext(fs.readFileSync(`${__dirname}/host.cjs`, 'utf8'), {
    process:{env:{CODEX_HOME:'/test/workspace-home'}},
    require(name) {
      if(name==='node:path')return require(name);
      if(name==='./workspace-service.cjs')return {createService:()=>({url:'http://127.0.0.1:4317/',start:()=>Promise.resolve('http://127.0.0.1:4317/'),stop(){}})};
      assert.equal(name, 'electron');
      return { app, WebContentsView, ipcMain: { handle(name, fn) { handlers.set(name, fn); } }, BrowserWindow: { fromWebContents(s) { return s === sender ? win : null; } } };
    }
  });
  return { views, sender, win, app, request: (message, event = { sender, senderFrame: sender.mainFrame }) => handlers.get('workspace:page')(event, message) };
}
const bounds = { x: 240, y: 40, width: 960, height: 760 };

test('only trusted main frame can request a board', async () => {
  const h = harness();
  await assert.rejects(h.request({ action: 'show', bounds }, { sender: h.sender, senderFrame: {} }), /Untrusted/);
  for (const url of ['https://example.com/', 'http://127.0.0.1:4317/', 'app://evil/index.html', 'app://-/index.html-evil', 'app://-/index.html/other']) {
    const other = harness(url);
    await assert.rejects(other.request({ action: 'show', bounds }), /Untrusted/);
    assert.equal(other.views.length, 0);
  }
  await h.request({ action: 'show', bounds });
  assert.equal(h.views.length, 1);
});

test('invalid actions and out of window or nonfinite bounds create no view', async () => {
  const h = harness();
  for (const message of [null, {}, { action: 'open', bounds }]) await assert.rejects(h.request(message), /Invalid page request/);
  for (const b of [null, {}, { ...bounds, x: -1 }, { ...bounds, y: -1 }, { ...bounds, width: 0 }, { ...bounds, height: -1 }, { ...bounds, width: Infinity }, { ...bounds, height: NaN }, { ...bounds, width: 2000 }, { ...bounds, y: 900 }, { ...bounds, x: '240' }]) {
    await assert.rejects(h.request({ action: 'show', bounds: b }), /Invalid page bounds/);
  }
  assert.equal(h.views.length, 0);
});

test('board is sandboxed without Node or preload and denies permissions', async () => {
  const h = harness();
  await h.request({ action: 'show', bounds });
  const view = h.views[0], prefs = view.options.webPreferences;
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.preload, undefined);
  assert.equal(prefs.partition, 'persist:workspace-board');
  assert.equal(view.webContents.url, 'http://127.0.0.1:4317/');
  let allowed;
  view.webContents.session.permission(view.webContents, 'camera', value => { allowed = value; });
  assert.equal(allowed, false);
});

test('hide and bounds do not create views; repeated show reuses one view', async () => {
  const h = harness();
  await h.request({ action: 'hide' });
  await h.request({ action: 'bounds', bounds });
  assert.equal(h.views.length, 0);
  await h.request({ action: 'show', bounds });
  const view = h.views[0];
  assert.equal(view.visible, true);
  await h.request({ action: 'hide' });
  assert.equal(view.visible, false);
  await h.request({ action: 'bounds', bounds: { ...bounds, width: 800 } });
  assert.equal(view.visible, false);
  assert.equal(view.bounds.width, 800);
  await h.request({ action: 'show', bounds });
  assert.equal(h.views.length, 1);
  assert.equal(view.visible, true);
});

test('board blocks foreign navigation, redirects and popups', async () => {
  const h = harness();
  await h.request({ action: 'show', bounds });
  const wc = h.views[0].webContents;
  assert.equal(wc.openWindow({ url: 'https://example.com' }).action, 'deny');
  for (const event of ['will-navigate', 'will-redirect']) {
    for (const url of ['https://example.com/', 'file:///etc/passwd', 'app://-/index.html', 'http://127.0.0.1:4317/evil']) {
      let prevented = false;
      wc.emit(event, { preventDefault() { prevented = true; } }, url);
      assert.equal(prevented, true);
    }
    let prevented = false;
    wc.emit(event, { preventDefault() { prevented = true; } }, 'http://127.0.0.1:4317/');
    assert.equal(prevented, false);
  }
});

test('closing window and quitting dispose native web contents', async () => {
  const h = harness();
  await h.request({ action: 'show', bounds });
  h.win.emit('closed');
  assert.equal(h.views[0].webContents.closed, true);
  const other = harness();
  await other.request({ action: 'show', bounds });
  other.app.emit('before-quit');
  assert.equal(other.views[0].webContents.closed, true);
});


test('failed loads stay hidden and retry on the same view', async () => {
  let attempts = 0;
  const h = harness(undefined, () => ++attempts === 1 ? Promise.reject(new Error('connection refused')) : Promise.resolve());
  await assert.rejects(h.request({ action: 'show', bounds }), /connection refused/);
  assert.equal(h.views.length, 1);
  assert.equal(h.views[0].visible, false);
  await h.request({ action: 'show', bounds });
  assert.equal(attempts, 2);
  assert.equal(h.views.length, 1);
  assert.equal(h.views[0].visible, true);
  await h.request({ action: 'show', bounds });
  assert.equal(attempts, 2);
});

test('concurrent shows share one load and hide wins while load is pending', async () => {
  let finish;
  const h = harness(undefined, () => new Promise(resolve => { finish = resolve; }));
  const first = h.request({ action: 'show', bounds });
  const second = h.request({ action: 'show', bounds });
  assert.equal(h.views.length, 1);
  await Promise.resolve();
  assert.equal(h.views[0].webContents.loadCount, 1);
  assert.equal(h.views[0].visible, false);
  await h.request({ action: 'hide' });
  finish();
  await Promise.all([first, second]);
  assert.equal(h.views[0].visible, false);
  await h.request({ action: 'show', bounds });
  assert.equal(h.views[0].visible, true);
  assert.equal(h.views[0].webContents.loadCount, 1);
});

test('closing a window during load cannot reshow its destroyed view', async () => {
  let finish;
  const h = harness(undefined, () => new Promise(resolve => { finish = resolve; }));
  const pending = h.request({ action: 'show', bounds });
  await Promise.resolve();
  h.win.emit('closed');
  finish();
  await pending;
  assert.equal(h.views[0].visible, false);
  assert.equal(h.views[0].webContents.closed, true);
});
