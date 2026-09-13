import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/store.js';

const temporaryHome = () => mkdtempSync(join(tmpdir(), 'task-workspace-storage-'));

test('failed schema initialization rolls back additions and preserves existing data', () => {
  const home = temporaryHome();
  let db = new DatabaseSync(join(home, 'workspace.sqlite'));
  try {
    db.exec("CREATE TABLE memory_facts(id TEXT); INSERT INTO memory_facts VALUES('existing-user-data')");
    db.close();
    assert.throws(() => new Store(home), /no such column/);
    db = new DatabaseSync(join(home, 'workspace.sqlite'));
    assert.equal(db.prepare('SELECT id FROM memory_facts').get().id, 'existing-user-data');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name), ['memory_facts']);
  } finally { db.close(); rmSync(home, { recursive: true, force: true }); }
});

test('newer schema is rejected without changing its version or contents', () => {
  const home = temporaryHome();
  let db = new DatabaseSync(join(home, 'workspace.sqlite'));
  try {
    db.exec("PRAGMA user_version=2; CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES('retained')");
    db.close();
    assert.throws(() => new Store(home), /newer/);
    db = new DatabaseSync(join(home, 'workspace.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(db.prepare('SELECT value FROM future_data').get().value, 'retained');
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  } finally { db.close(); rmSync(home, { recursive: true, force: true }); }
});

test('failed multi-write transaction leaves no partial rows and connection remains usable', () => {
  const home = temporaryHome(), store = new Store(home);
  try {
    assert.throws(() => store.transaction(() => {
      store.createProject({ name: 'Rolled back' });
      store.run("INSERT INTO tasks VALUES('invalid','missing','Task','todo',0,'now','now')");
    }), /FOREIGN KEY/);
    assert.equal(store.state().projects.length, 0);
    store.createProject({ name: 'Retained' });
    const other = new Store(home);
    try { assert.equal(other.state().projects[0].name, 'Retained'); }
    finally { other.close(); }
    assert.equal(store.one('PRAGMA integrity_check').integrity_check, 'ok');
    assert.deepEqual(store.all('PRAGMA foreign_key_check'), []);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});

test('out-of-order hooks preserve latest cwd and retain earliest session timestamp', () => {
  const home = temporaryHome(), store = new Store(home);
  try {
    store.ingestHook({ event_id: 'new', event_name: 'Stop', session_id: 's', cwd: '/new', at: '2026-09-13T10:00:00Z' });
    store.ingestHook({ event_id: 'old', event_name: 'SessionStart', session_id: 's', cwd: '/old', at: '2026-09-13T09:00:00Z' });
    const session = store.state().sessions[0];
    assert.equal(session.cwd, '/new');
    assert.equal(session.created_at, '2026-09-13T09:00:00.000Z');
    assert.equal(session.updated_at, '2026-09-13T10:00:00.000Z');
    assert.equal(store.all('SELECT * FROM hook_events').length, 2);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});

test('task update holds a write lock throughout its read and update', () => {
  const home = temporaryHome(), store = new Store(home), other = new Store(home);
  try {
    const project = store.createProject({ name: 'Project' });
    const task = store.createTask({ project_id: project.id, title: 'Task' });
    other.db.exec('PRAGMA busy_timeout=1');
    const originalTask = store.task.bind(store);
    let intercepted = false;
    store.task = id => {
      const result = originalTask(id);
      if (!intercepted) {
        intercepted = true;
        assert.throws(() => other.run('UPDATE tasks SET focus=1 WHERE id=?', id), /locked/);
      }
      return result;
    };
    assert.equal(store.updateTask({ task_id: task.id, status: 'doing' }).status, 'doing');
    other.updateTask({ task_id: task.id, focus: true });
    assert.equal(store.task(task.id).status, 'doing');
    assert.equal(store.task(task.id).focus, 1);
  } finally { other.close(); store.close(); rmSync(home, { recursive: true, force: true }); }
});

test('state remains one snapshot while another connection adds a project and task', () => {
  const home = temporaryHome(), store = new Store(home), other = new Store(home);
  try {
    const originalAll = store.all.bind(store);
    let inserted = false;
    store.all = (sql, ...args) => {
      const result = originalAll(sql, ...args);
      if (!inserted && sql.includes('FROM projects')) {
        inserted = true;
        other.transaction(() => {
          const project = other.createProject({ name: 'Concurrent project' });
          other.createTask({ project_id: project.id, title: 'Concurrent task' });
        });
      }
      return result;
    };
    const state = store.state();
    assert.equal(state.projects.length, 0);
    assert.equal(state.tasks.length, 0);
    assert.equal(store.state().projects.length, 1);
    assert.equal(store.state().tasks.length, 1);
  } finally { other.close(); store.close(); rmSync(home, { recursive: true, force: true }); }
});

test('context snapshots compose with transactions and clean up failed reads', () => {
  const home = temporaryHome(), store = new Store(home);
  try {
    store.transaction(() => {
      const project = store.createProject({ name: 'Project' });
      const task = store.createTask({ project_id: project.id, title: 'Task' });
      assert.throws(() => store.context('missing'), /not found/);
      assert.equal(store.context(task.id).task.id, task.id);
      assert.equal(store.state().tasks.length, 1);
    });
    assert.throws(() => store.context('missing'), /not found/);
    store.updateTask({ task_id: store.state().tasks[0].id, focus: true });
    assert.equal(store.state().tasks[0].focus, 1);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});
