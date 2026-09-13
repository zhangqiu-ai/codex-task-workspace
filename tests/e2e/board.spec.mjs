import {test, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

let service;
let home;
let baseURL;

test.beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'task-workspace-e2e-'));
  service = spawn(process.execPath, ['dist/http.js'], {
    cwd: process.cwd(),
    env: {...process.env, TASK_WORKSPACE_HOME: home, PORT: '0'},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  baseURL = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Board startup timed out: ${output}`)), 10_000);
    service.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Task Workspace: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    service.stderr.on('data', chunk => { output += chunk; });
    service.once('exit', code => { clearTimeout(timer); reject(new Error(`Board exited with ${code}: ${output}`)); });
  });
});

test.afterAll(async () => {
  if (service?.exitCode === null) {
    service.kill('SIGTERM');
    await new Promise(resolve => service.once('exit', resolve));
  }
  if (home) await rm(home, {recursive: true, force: true});
});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('task-workspace-language')) localStorage.setItem('task-workspace-language', 'en');
  });
  await page.goto(baseURL);
  await expect(page.getByRole('heading', {name: 'My Work'})).toBeVisible();
});

test('creates persistent project and task, then manages task details', async ({page}) => {
  const board = page.getByRole('region', {name: /Task board/});
  await expect(board.getByRole('heading')).toHaveText(['To do0', 'In progress0', 'Blocked0', 'Done0']);

  await page.getByRole('button', {name: 'Add project'}).click();
  await page.getByRole('button', {name: 'Create manually'}).click();
  await page.getByLabel('Project name').fill('Local Product');
  await page.getByRole('button', {name: 'Save'}).click();
  await expect(page.getByRole('button', {name: /Local Product/})).toBeVisible();

  await page.getByRole('button', {name: 'New task'}).click();
  await page.getByLabel('Task name').fill('Verify sidecar');
  await page.getByRole('dialog').getByRole('combobox', {name: 'Project'}).selectOption({label: 'Local Product'});
  await page.getByRole('button', {name: 'Save'}).click();
  await expect(page.getByRole('button', {name: /Verify sidecar/})).toBeVisible();

  await page.getByRole('button', {name: /Verify sidecar/}).click();
  await expect(page.getByRole('dialog', {name: 'Task details'})).toBeVisible();
  await expect(page.getByRole('dialog', {name: 'Task details'}).getByRole('combobox', {name: 'Project'})).toHaveValue(/.+/);
  const status = page.getByLabel('Task status');
  const focus = page.getByRole('button', {name: 'Focus task'});
  const statusBox = await status.boundingBox();
  const focusBox = await focus.boundingBox();
  expect(Math.abs(statusBox.y - focusBox.y)).toBeLessThanOrEqual(1);
  await status.selectOption('doing');
  await focus.click();
  await page.getByRole('button', {name: 'Set active task'}).click();
  await page.getByRole('button', {name: 'Close details'}).click();
  await expect(board.locator('[data-status="doing"]')).toContainText('Verify sidecar');

  await page.reload();
  await expect(board.locator('[data-status="doing"]')).toContainText('Verify sidecar');
  await expect(page.getByRole('button', {name: /Verify sidecar/})).toHaveClass(/is-active/);
});

test('settings owns language and motion preferences across reloads', async ({page}) => {
  await page.getByRole('button', {name: /Settings/}).click();
  await expect(page.getByRole('heading', {name: 'Settings'})).toBeVisible();
  const motion = page.getByRole('switch', {name: 'Task animation'});
  await motion.uncheck();
  await page.getByRole('button', {name: '简体中文'}).click();
  await expect(page.getByRole('heading', {name: '设置'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', {name: '我的工作'})).toBeVisible();
  await page.getByRole('button', {name: /设置/}).click();
  await expect(page.getByRole('switch', {name: '任务动效'})).not.toBeChecked();
});
