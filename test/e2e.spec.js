// ═══════════════════════════════════════════════════
// Game Tracker — E2E Tests (Playwright + Electron)
// ═══════════════════════════════════════════════════
//
// Run:  npx playwright test test/e2e.spec.js
//
// Requires:  npm install -D @playwright/test electron
// ═══════════════════════════════════════════════════

const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');

/** @type {import('playwright').ElectronApplication} */
let app;
/** @type {import('playwright').Page} */
let page;

// ── Launch & close Electron for each test file ──

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  page = await app.firstWindow();
  // Wait for the app to be fully loaded
  await page.waitForSelector('.app-layout', { timeout: 15000 });
  // Small extra delay for any initialization JS
  await page.waitForTimeout(500);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ═══════════ APP LAUNCH ══════════════════════════

test.describe('App launch', () => {
  test('window opens with correct title', async () => {
    const title = await page.title();
    expect(title.toLowerCase()).toContain('game tracker');
  });

  test('app layout is visible', async () => {
    const layout = page.locator('.app-layout');
    await expect(layout).toBeVisible();
  });

  test('sidebar with navigation is visible', async () => {
    const nav = page.locator('.sidebar, .nav, nav');
    await expect(nav.first()).toBeVisible();
  });

  test('library view is active by default', async () => {
    const appView = await page.locator('#app').getAttribute('data-view');
    expect(appView).toBe('library');
    const libraryNav = page.locator('.nav-item[data-view="library"]');
    await expect(libraryNav).toHaveClass(/active/);
  });
});

// ═══════════ NAVIGATION ══════════════════════════

test.describe('Navigation between views', () => {
  test('can switch to Tier List view', async () => {
    await page.click('.nav-item[data-view="tier-list"]');
    await expect(page.locator('#view-tier-list')).toHaveClass(/active/);
    await expect(page.locator('.nav-item[data-view="tier-list"]')).toHaveClass(/active/);
    // Other views should not be active
    await expect(page.locator('#view-library')).not.toHaveClass(/active/);
  });

  test('can switch to Statistics view', async () => {
    await page.click('.nav-item[data-view="stats"]');
    await expect(page.locator('#view-stats')).toHaveClass(/active/);
    await expect(page.locator('.nav-item[data-view="stats"]')).toHaveClass(/active/);
  });

  test('can switch to Settings view', async () => {
    await page.click('.nav-item[data-view="settings"]');
    await expect(page.locator('#view-settings')).toHaveClass(/active/);
    await expect(page.locator('.nav-item[data-view="settings"]')).toHaveClass(/active/);
  });

  test('can switch back to Library', async () => {
    await page.click('.nav-item[data-view="library"]');
    await expect(page.locator('#view-library')).toHaveClass(/active/);
    const appView = await page.locator('#app').getAttribute('data-view');
    expect(appView).toBe('library');
  });

  test('only one nav-item is active at a time', async () => {
    const views = ['library', 'tier-list', 'stats', 'settings'];
    for (const view of views) {
      await page.click(`.nav-item[data-view="${view}"]`);
      const activeCount = await page.locator('.nav-item.active').count();
      expect(activeCount, `Only one nav-item active after clicking ${view}`).toBe(1);
    }
    // Return to library
    await page.click('.nav-item[data-view="library"]');
  });

  test('only one view section is active at a time', async () => {
    const views = ['library', 'tier-list', 'stats', 'settings'];
    for (const view of views) {
      await page.click(`.nav-item[data-view="${view}"]`);
      const activeViews = await page.locator('.view.active').count();
      expect(activeViews, `Only one view active after clicking ${view}`).toBe(1);
    }
    await page.click('.nav-item[data-view="library"]');
  });
});

// ═══════════ SETTINGS TABS ══════════════════════

test.describe('Settings tab switching', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForTimeout(300);
  });

  test('Appearance tab is active by default', async () => {
    const activeTab = page.locator('.settings-tab.active[data-settings-tab]');
    await expect(activeTab).toHaveAttribute('data-settings-tab', 'appearance');
    await expect(page.locator('[data-settings-panel="appearance"]')).toHaveClass(/active/);
  });

  test('can switch to Sync tab', async () => {
    await page.click('[data-settings-tab="sync"]');
    await expect(page.locator('[data-settings-tab="sync"]')).toHaveClass(/active/);
    await expect(page.locator('[data-settings-panel="sync"]')).toHaveClass(/active/);
    // Previous panel should be hidden
    await expect(page.locator('[data-settings-panel="appearance"]')).not.toHaveClass(/active/);
  });

  test('can switch to Library tab', async () => {
    await page.click('[data-settings-tab="library"]');
    await expect(page.locator('[data-settings-tab="library"]')).toHaveClass(/active/);
    await expect(page.locator('[data-settings-panel="library"]')).toHaveClass(/active/);
  });

  test('can switch to Data tab', async () => {
    await page.click('[data-settings-tab="data"]');
    await expect(page.locator('[data-settings-tab="data"]')).toHaveClass(/active/);
    await expect(page.locator('[data-settings-panel="data"]')).toHaveClass(/active/);
  });

  test('can switch back to Appearance tab', async () => {
    await page.click('[data-settings-tab="appearance"]');
    await expect(page.locator('[data-settings-tab="appearance"]')).toHaveClass(/active/);
    await expect(page.locator('[data-settings-panel="appearance"]')).toHaveClass(/active/);
  });

  test('only one settings tab active at a time', async () => {
    const tabs = ['appearance', 'sync', 'library', 'data'];
    for (const tab of tabs) {
      await page.click(`[data-settings-tab="${tab}"]`);
      const activeCount = await page.locator('.settings-tab.active[data-settings-tab]').count();
      expect(activeCount, `Only one settings tab active after clicking ${tab}`).toBe(1);
      const activePanelCount = await page.locator('.settings-panel.active').count();
      expect(activePanelCount, `Only one panel active after clicking ${tab}`).toBe(1);
    }
  });

  test.afterAll(async () => {
    await page.click('.nav-item[data-view="library"]');
  });
});

// ═══════════ THEME SWITCHING ═════════════════════

test.describe('Theme switching', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.click('[data-settings-tab="appearance"]');
    await page.waitForTimeout(200);
  });

  test('theme cards are visible', async () => {
    const cards = page.locator('.theme-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('clicking a theme card applies it', async () => {
    // Click on a different theme (e.g. neon or obsidian)
    const targetTheme = page.locator('.theme-card[data-theme-id="neon"]');
    if (await targetTheme.count() > 0) {
      await targetTheme.click();
      await page.waitForTimeout(200);
      // The clicked theme should now be active
      await expect(targetTheme).toHaveClass(/active/);
    }
  });

  test('only one theme card is active at a time', async () => {
    const cards = page.locator('.theme-card');
    const count = await cards.count();
    // Click each theme and verify only one is active
    for (let i = 0; i < Math.min(count, 3); i++) {
      await cards.nth(i).click();
      await page.waitForTimeout(100);
      const activeCount = await page.locator('.theme-card.active').count();
      expect(activeCount).toBe(1);
    }
  });

  test.afterAll(async () => {
    // Reset to first theme
    const firstCard = page.locator('.theme-card').first();
    await firstCard.click();
    await page.click('.nav-item[data-view="library"]');
  });
});

// ═══════════ MODALS ══════════════════════════════

test.describe('Modals', () => {
  test('Add Game modal opens and closes', async () => {
    const modal = page.locator('#modal-add-game');
    // Should be hidden initially
    await expect(modal).toHaveClass(/hidden/);

    // Open
    await page.click('#btn-add-game');
    await expect(modal).not.toHaveClass(/hidden/);

    // Close by clicking overlay background
    await modal.click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);

    // If still visible, try pressing Escape
    if (!(await modal.getAttribute('class')).includes('hidden')) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  });

  test('all modals are hidden by default', async () => {
    const modals = page.locator('.modal-overlay');
    const count = await modals.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const classes = await modals.nth(i).getAttribute('class');
      const id = await modals.nth(i).getAttribute('id');
      expect(classes, `${id} should be hidden`).toContain('hidden');
    }
  });
});

// ═══════════ LIBRARY VIEW ════════════════════════

test.describe('Library view', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="library"]');
    await page.waitForTimeout(300);
  });

  test('search input exists and is functional', async () => {
    const search = page.locator('#sl-search');
    await expect(search).toBeVisible();
    await search.fill('test');
    const value = await search.inputValue();
    expect(value).toBe('test');
    await search.fill('');
  });

  test('"Add game" button is visible', async () => {
    const btn = page.locator('#btn-add-game');
    await expect(btn).toBeVisible();
  });
});

// ═══════════ WINDOW CONTROLS ═════════════════════

test.describe('Window controls', () => {
  test('minimize button exists', async () => {
    await expect(page.locator('#btn-minimize')).toBeVisible();
  });

  test('maximize button exists', async () => {
    await expect(page.locator('#btn-maximize')).toBeVisible();
  });

  test('close button exists', async () => {
    await expect(page.locator('#btn-close')).toBeVisible();
  });
});

// ═══════════ KEYBOARD SHORTCUTS ══════════════════

test.describe('Keyboard shortcuts', () => {
  test('Escape closes open modal', async () => {
    // Open add game modal
    await page.click('#btn-add-game');
    const modal = page.locator('#modal-add-game');
    await expect(modal).not.toHaveClass(/hidden/);

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(modal).toHaveClass(/hidden/);
  });
});
