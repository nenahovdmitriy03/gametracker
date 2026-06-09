// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testMatch: 'e2e.spec.js',
  timeout: 30000,
  retries: 0,
  workers: 1, // Electron tests must run serially
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
});
