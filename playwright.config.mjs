import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: 'chromium',
    viewport: {width: 1188, height: 760},
    trace: 'retain-on-failure'
  }
});
