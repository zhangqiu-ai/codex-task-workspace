import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHook, readPayload } from '../dist/hooks.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/store.js';

test('hook normalization strips sensitive content and distinguishes turns', () => {
  const input = { hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/work', turn_id: 't1', transcript_path: '/private/log', last_assistant_message: 'secret', prompt: 'secret' };
  const first = normalizeHook(input);
  assert.deepEqual(Object.keys(first).sort(), ['cwd', 'event_id', 'event_name', 'session_id']);
  assert.equal(first.event_id, normalizeHook(input).event_id);
  assert.notEqual(first.event_id, normalizeHook({ ...input, turn_id: 't2' }).event_id);
  assert.equal(normalizeHook({ ...input, event_id: 'delivery-1' }).event_id, 'delivery-1');
});

test('undiscriminated host deliveries are preserved and invalid metadata rejected', () => {
  const input = { hook_event_name: 'SessionStart', session_id: 's1' };
  assert.notEqual(normalizeHook(input).event_id, normalizeHook(input).event_id);
  assert.throws(() => normalizeHook({ ...input, session_id: '' }));
  assert.throws(() => normalizeHook({ ...input, timestamp: 'invalid' }));
  assert.throws(() => normalizeHook({ ...input, hook_event_name: 'UserPromptSubmit' }));
});

test('stdin parser bounds bytes and rejects invalid JSON without echoing it', async () => {
  async function* chunks(text) { yield Buffer.from(text); }
  assert.deepEqual(await readPayload(chunks('{"a":1}')), { a: 1 });
  await assert.rejects(readPayload(chunks('secret')), /Invalid hook JSON/);
  await assert.rejects(readPayload(chunks('12345'), 4), /exceeds limit/);
});

test('actual hook process persists allowlisted lifecycle events and fails privately', () => {
  const home = mkdtempSync(join(tmpdir(), 'task-hooks-'));
  const run = input => spawnSync(process.execPath, ['dist/hooks.js'], {
    env: { ...process.env, TASK_WORKSPACE_HOME: home }, input: JSON.stringify(input), encoding: 'utf8', timeout: 5000,
  });
  let store;
  try {
    for (const hook_event_name of ['SessionStart', 'Stop', 'SessionEnd']) {
      const result = run({ hook_event_name, session_id: 'actual-process', cwd: '/tmp/example', turn_id: 'turn-1', prompt: 'private sentinel' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
    }
    const failure = run({ hook_event_name: 'Stop', session_id: '', prompt: 'private sentinel' });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.doesNotMatch(failure.stderr, /private sentinel/);
    store = new Store(home);
    assert.equal(store.state().sessions.length, 1);
    assert.equal(store.state().sessions[0].task_id, null);
    assert.equal(store.all('SELECT * FROM hook_events').length, 3);
    assert.doesNotMatch(JSON.stringify(store.state()), /private sentinel/);
  } finally { store?.close(); rmSync(home, { recursive: true, force: true }); }
});
