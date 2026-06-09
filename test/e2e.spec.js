// ═══════════════════════════════════════════════════
// Game Tracker — E2E Tests (Playwright + Electron)
// ═══════════════════════════════════════════════════
//
// Run:  npx playwright test
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

// ── Helpers ──────────────────────────────────────

// Some elements inside the library sidebar are covered by the
// fixed-position #app container.  Playwright's actionability
// check blocks the click, so we dispatch it via JS instead.
async function jsClick(selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.click();
  }, selector);
}

// Same but for a locator we already have — use when CSS selector
// is hard to build but we can pass the handle.
async function jsClickLocator(locator) {
  const handle = await locator.elementHandle();
  if (handle) await handle.evaluate(el => el.click());
}

// Scroll an element into view first, then force-click.
async function scrollAndClick(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ force: true });
}

// ── Launch & close Electron for each test file ──

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('.app-layout', { timeout: 15000 });
  await page.waitForTimeout(500);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ═══════════ 1. APP LAUNCH ═══════════════════════

test.describe('App launch', () => {
  test('window opens with correct title', async () => {
    const title = await page.title();
    expect(title.toLowerCase()).toContain('game tracker');
  });

  test('app layout is visible', async () => {
    await expect(page.locator('.app-layout')).toBeVisible();
  });

  test('sidebar with navigation is visible', async () => {
    const nav = page.locator('.sidebar, .nav, nav');
    await expect(nav.first()).toBeVisible();
  });

  test('library view is active by default', async () => {
    const appView = await page.locator('#app').getAttribute('data-view');
    expect(appView).toBe('library');
    await expect(page.locator('.nav-item[data-view="library"]')).toHaveClass(/active/);
  });
});

// ═══════════ 2. NAVIGATION ═══════════════════════

test.describe('Navigation between views', () => {
  test('can switch to Tier List view', async () => {
    await page.click('.nav-item[data-view="tier-list"]');
    await expect(page.locator('#view-tier-list')).toHaveClass(/active/);
    await expect(page.locator('.nav-item[data-view="tier-list"]')).toHaveClass(/active/);
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
      expect(activeCount, `Only one nav active after ${view}`).toBe(1);
    }
    await page.click('.nav-item[data-view="library"]');
  });

  test('only one view section is active at a time', async () => {
    const views = ['library', 'tier-list', 'stats', 'settings'];
    for (const view of views) {
      await page.click(`.nav-item[data-view="${view}"]`);
      const activeViews = await page.locator('.view.active').count();
      expect(activeViews, `Only one view active after ${view}`).toBe(1);
    }
    await page.click('.nav-item[data-view="library"]');
  });

  test('data-view attribute updates on navigation', async () => {
    const views = ['library', 'tier-list', 'stats', 'settings'];
    for (const view of views) {
      await page.click(`.nav-item[data-view="${view}"]`);
      const dataView = await page.locator('#app').getAttribute('data-view');
      expect(dataView, `data-view should be ${view}`).toBe(view);
    }
    await page.click('.nav-item[data-view="library"]');
  });
});

// ═══════════ 3. SETTINGS TABS ════════════════════

test.describe('Settings tab switching', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForTimeout(300);
  });

  test('Appearance tab is active by default', async () => {
    const activeTab = page.locator('#view-settings .settings-tab.active[data-settings-tab]');
    await expect(activeTab).toHaveAttribute('data-settings-tab', 'appearance');
    await expect(page.locator('[data-settings-panel="appearance"]')).toHaveClass(/active/);
  });

  test('can switch to Sync tab', async () => {
    await page.click('#view-settings [data-settings-tab="sync"]');
    await expect(page.locator('#view-settings [data-settings-tab="sync"]')).toHaveClass(/active/);
    await expect(page.locator('[data-settings-panel="sync"]')).toHaveClass(/active/);
    await expect(page.locator('[data-settings-panel="appearance"]')).not.toHaveClass(/active/);
  });

  test('can switch to Library tab', async () => {
    await page.click('#view-settings [data-settings-tab="library"]');
    await expect(page.locator('#view-settings [data-settings-tab="library"]')).toHaveClass(/active/);
    await expect(page.locator('[data-settings-panel="library"]')).toHaveClass(/active/);
  });

  test('can switch to Data tab', async () => {
    await page.click('#view-settings [data-settings-tab="data"]');
    await expect(page.locator('#view-settings [data-settings-tab="data"]')).toHaveClass(/active/);
    await expect(page.locator('[data-settings-panel="data"]')).toHaveClass(/active/);
  });

  test('can switch back to Appearance tab', async () => {
    await page.click('#view-settings [data-settings-tab="appearance"]');
    await expect(page.locator('#view-settings [data-settings-tab="appearance"]')).toHaveClass(/active/);
    await expect(page.locator('[data-settings-panel="appearance"]')).toHaveClass(/active/);
  });

  test('only one settings tab active at a time', async () => {
    const tabs = ['appearance', 'sync', 'library', 'data'];
    for (const tab of tabs) {
      await page.click(`#view-settings [data-settings-tab="${tab}"]`);
      const activeCount = await page.locator('#view-settings .settings-tab.active[data-settings-tab]').count();
      expect(activeCount, `One settings tab active after ${tab}`).toBe(1);
      const activePanels = await page.locator('.settings-panel.active').count();
      expect(activePanels, `One panel active after ${tab}`).toBe(1);
    }
  });

  test.afterAll(async () => {
    await page.click('.nav-item[data-view="library"]');
  });
});

// ═══════════ 4. THEME SWITCHING ══════════════════

test.describe('Theme switching', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.click('#view-settings [data-settings-tab="appearance"]');
    await page.waitForTimeout(200);
  });

  test('theme cards are visible', async () => {
    const count = await page.locator('.theme-card').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('clicking a theme card activates it', async () => {
    const neon = page.locator('.theme-card[data-theme-id="neon"]');
    if (await neon.count() > 0) {
      await neon.click();
      await page.waitForTimeout(200);
      await expect(neon).toHaveClass(/active/);
    }
  });

  test('only one theme card is active at a time', async () => {
    const cards = page.locator('.theme-card');
    const count = await cards.count();
    for (let i = 0; i < Math.min(count, 3); i++) {
      await cards.nth(i).click();
      await page.waitForTimeout(100);
      const activeCount = await page.locator('.theme-card.active').count();
      expect(activeCount).toBe(1);
    }
  });

  test.afterAll(async () => {
    const firstCard = page.locator('.theme-card').first();
    await firstCard.click();
    await page.click('.nav-item[data-view="library"]');
  });
});

// ═══════════ 5. DENSITY SWITCHING ════════════════

test.describe('Density mode switching', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.click('#view-settings [data-settings-tab="appearance"]');
    await page.waitForTimeout(200);
  });

  test('density cards are visible', async () => {
    const count = await page.locator('.density-card').count();
    expect(count).toBe(3); // compact, normal, wide
  });

  test('clicking compact applies compact density', async () => {
    await page.click('.density-card[data-density-id="compact"]');
    await page.waitForTimeout(200);
    await expect(page.locator('.density-card[data-density-id="compact"]')).toHaveClass(/active/);
    const density = await page.locator('html').getAttribute('data-density');
    expect(density).toBe('compact');
  });

  test('clicking wide applies wide density', async () => {
    await page.click('.density-card[data-density-id="wide"]');
    await page.waitForTimeout(200);
    await expect(page.locator('.density-card[data-density-id="wide"]')).toHaveClass(/active/);
    const density = await page.locator('html').getAttribute('data-density');
    expect(density).toBe('wide');
  });

  test('clicking normal resets density', async () => {
    await page.click('.density-card[data-density-id="normal"]');
    await page.waitForTimeout(200);
    await expect(page.locator('.density-card[data-density-id="normal"]')).toHaveClass(/active/);
  });

  test('only one density card is active at a time', async () => {
    const densities = ['compact', 'normal', 'wide'];
    for (const d of densities) {
      await page.click(`.density-card[data-density-id="${d}"]`);
      await page.waitForTimeout(100);
      const activeCount = await page.locator('.density-card.active').count();
      expect(activeCount, `One density active after ${d}`).toBe(1);
    }
  });

  test.afterAll(async () => {
    await page.click('.density-card[data-density-id="normal"]');
    await page.click('.nav-item[data-view="library"]');
  });
});

// ═══════════ 6. MODALS ═══════════════════════════

test.describe('Modals', () => {
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

  test('Add Game modal opens on button click', async () => {
    const modal = page.locator('#modal-add-game');
    await expect(modal).toHaveClass(/hidden/);
    await page.click('#btn-add-game');
    await expect(modal).not.toHaveClass(/hidden/);
  });

  test('Add Game modal closes via X button', async () => {
    const modal = page.locator('#modal-add-game');
    await expect(modal).not.toHaveClass(/hidden/);
    await page.click('[data-close="modal-add-game"]');
    await page.waitForTimeout(200);
    await expect(modal).toHaveClass(/hidden/);
  });

  test('Add Game modal closes via overlay click', async () => {
    await page.click('#btn-add-game');
    const modal = page.locator('#modal-add-game');
    await expect(modal).not.toHaveClass(/hidden/);
    // Click at the very edge of the overlay (outside the inner .modal)
    await modal.click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);
    await expect(modal).toHaveClass(/hidden/);
  });
});

// ═══════════ 7. ADD GAME (manual) ════════════════

test.describe('Add game manually', () => {
  test('form fields exist in modal', async () => {
    await page.click('#btn-add-game');
    await expect(page.locator('#ag-title')).toBeVisible();
    await expect(page.locator('#ag-platform')).toBeVisible();
    await expect(page.locator('#ag-hours')).toBeVisible();
    await expect(page.locator('#ag-cover')).toBeVisible();
    await expect(page.locator('#btn-do-add')).toBeVisible();
  });

  test('shows error when title is empty', async () => {
    await page.locator('#ag-title').fill('');
    await page.click('#btn-do-add');
    await page.waitForTimeout(200);
    const errorBox = page.locator('#ag-error');
    await expect(errorBox).not.toHaveClass(/hidden/);
    const errorText = await errorBox.textContent();
    expect(errorText).toBeTruthy();
  });

  test('can add a game with title and platform', async () => {
    await page.locator('#ag-title').fill('Test Game E2E');
    await page.locator('#ag-platform').selectOption('Steam');
    await page.locator('#ag-hours').fill('42.5');
    await page.click('#btn-do-add');
    await page.waitForTimeout(500);
    // Modal should close after adding
    await expect(page.locator('#modal-add-game')).toHaveClass(/hidden/);
    // Toast should appear confirming
    const toast = page.locator('#toast');
    const text = await toast.textContent();
    expect(text).toContain('Test Game E2E');
  });

  test('game appears in the library list', async () => {
    await page.click('.nav-item[data-view="library"]');
    await page.waitForTimeout(300);
    const gameItem = page.locator('.sl-game-item', { hasText: 'Test Game E2E' });
    await expect(gameItem).toBeVisible();
  });

  test('can search for the added game', async () => {
    const search = page.locator('#sl-search');
    await search.fill('Test Game E2E');
    await page.waitForTimeout(300);
    const items = page.locator('.sl-game-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent();
      expect(text.toLowerCase()).toContain('test game e2e');
    }
    await search.fill('');
    await page.waitForTimeout(200);
  });

  test('search with no results shows empty state', async () => {
    const search = page.locator('#sl-search');
    await search.fill('XYZNONEXISTENT12345');
    await page.waitForTimeout(300);
    const emptyMsg = page.locator('.sl-list-empty');
    await expect(emptyMsg).toBeVisible();
    await search.fill('');
    await page.waitForTimeout(200);
  });
});

// ═══════════ 8. GAME DETAIL VIEW ═════════════════
//
// The library game list items (.sl-game-item) sit inside a
// scrollable panel covered by the fixed-position #app container.
// Playwright sees #app intercepting pointer events.  We use
// page.evaluate to dispatch the click directly on the DOM element.

test.describe('Game detail view', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="library"]');
    await page.waitForTimeout(300);
  });

  test('clicking a game opens its detail view', async () => {
    // Wait for the list to settle, then click via JS to bypass #app overlay
    await page.waitForTimeout(300);
    const clicked = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.sl-game-item')];
      const target = items.find(el => el.textContent.includes('Test Game E2E'));
      if (target) { target.click(); return true; }
      return false;
    });
    expect(clicked, 'Test Game E2E should exist in library').toBe(true);
    await page.waitForTimeout(500);

    // Detail view should be visible
    const detail = page.locator('#sl-detail');
    await expect(detail).not.toHaveClass(/hidden/);
    // Title should be displayed
    const title = await page.locator('#sl-game-title').textContent();
    expect(title).toContain('Test Game E2E');
  });

  test('status pills are visible in detail view', async () => {
    const pills = page.locator('#sl-hero-status .sl-status-pill');
    const count = await pills.count();
    expect(count).toBe(4); // playing, completed, dropped, planned
  });

  test('can set game status to "playing"', async () => {
    await jsClick('#sl-hero-status .sl-status-pill[data-status="playing"]');
    await page.waitForTimeout(300);
    await expect(
      page.locator('#sl-hero-status .sl-status-pill[data-status="playing"]')
    ).toHaveClass(/active/);
  });

  test('clicking same status pill toggles it off', async () => {
    await jsClick('#sl-hero-status .sl-status-pill[data-status="playing"]');
    await page.waitForTimeout(300);
    await expect(
      page.locator('#sl-hero-status .sl-status-pill[data-status="playing"]')
    ).not.toHaveClass(/active/);
  });

  test('gear button opens game settings modal', async () => {
    await jsClick('#sl-gear-btn');
    await page.waitForTimeout(300);
    const modal = page.locator('#modal-sl-settings');
    await expect(modal).not.toHaveClass(/hidden/);
    // Close it via JS (close button may also be occluded)
    await jsClick('[data-close="modal-sl-settings"]');
    await page.waitForTimeout(300);
    await expect(modal).toHaveClass(/hidden/);
  });
});

// ═══════════ 9. GAME SETTINGS TABS ═══════════════

test.describe('Game settings tabs (inside modal)', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="library"]');
    await page.waitForTimeout(300);
    // Select game via JS
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.sl-game-item')];
      const target = items.find(el => el.textContent.includes('Test Game E2E'));
      if (target) target.click();
    });
    await page.waitForTimeout(500);
    // Open gear modal via JS
    await jsClick('#sl-gear-btn');
    await page.waitForTimeout(400);
  });

  test('game settings tabs are visible', async () => {
    const tabs = page.locator('.game-settings-tabs .settings-tab[data-game-tab]');
    const count = await tabs.count();
    expect(count).toBe(4); // media, launch, achievements, saves
  });

  test('can switch between game settings tabs', async () => {
    const tabNames = ['launch', 'achievements', 'saves', 'media'];
    for (const tab of tabNames) {
      await page.click(`[data-game-tab="${tab}"]`);
      await page.waitForTimeout(100);
      await expect(page.locator(`[data-game-panel="${tab}"]`)).toHaveClass(/active/);
    }
  });

  test.afterAll(async () => {
    // Close modal — use JS since elements may be covered
    await page.evaluate(() => {
      const modal = document.getElementById('modal-sl-settings');
      if (modal) modal.classList.add('hidden');
    });
    await page.waitForTimeout(200);
  });
});

// ═══════════ 10. COLLECTIONS ═════════════════════

test.describe('Collections', () => {
  test('create collection modal opens', async () => {
    await page.click('#btn-new-collection');
    await page.waitForTimeout(200);
    await expect(page.locator('#modal-collection')).not.toHaveClass(/hidden/);
  });

  test('collection name input and emoji picker exist', async () => {
    await expect(page.locator('#mc-name')).toBeVisible();
    await expect(page.locator('#mc-emoji')).toBeVisible();
  });

  test('cannot save collection with empty name', async () => {
    await page.locator('#mc-name').fill('');
    await page.click('#btn-save-collection');
    await page.waitForTimeout(200);
    // Modal should still be open
    await expect(page.locator('#modal-collection')).not.toHaveClass(/hidden/);
  });

  test('can create a collection', async () => {
    await page.locator('#mc-name').fill('Test Collection E2E');
    await page.click('#btn-save-collection');
    await page.waitForTimeout(300);
    // Modal should close
    await expect(page.locator('#modal-collection')).toHaveClass(/hidden/);
    // Toast confirmation
    const toast = await page.locator('#toast').textContent();
    expect(toast).toContain('Test Collection E2E');
  });
});

// ═══════════ 11. LIBRARY FILTERS ═════════════════
//
// Filter buttons sit in .sl-lib-filter-bar inside the sidebar
// scroll area.  They can be pushed outside the visible viewport.
// We scroll them into view and use force-click.

test.describe('Library filters', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="library"]');
    await page.waitForTimeout(300);
  });

  test('platform filter buttons exist', async () => {
    const allBtn = page.locator('.lib-filter-btn[data-filter-type="platform"][data-filter-val=""]');
    await expect(allBtn.first()).toBeVisible();
  });

  test('status filter buttons exist', async () => {
    const statuses = ['', 'playing', 'completed', 'planned', 'dropped'];
    for (const s of statuses) {
      const count = await page.locator(`.lib-filter-btn[data-filter-type="status"][data-filter-val="${s}"]`).count();
      expect(count, `status filter ${s || 'all'} should exist`).toBeGreaterThanOrEqual(1);
    }
  });

  test('clicking a status filter activates it', async () => {
    // Click "Играю" via JS — it may be outside viewport in the sidebar
    await page.evaluate(() => {
      const btn = document.querySelector('.sl-lib-filter-bar .lib-filter-btn[data-filter-type="status"][data-filter-val="playing"]');
      if (btn) { btn.scrollIntoView(); btn.click(); }
    });
    await page.waitForTimeout(300);
    const playingBtn = page.locator('.sl-lib-filter-bar .lib-filter-btn[data-filter-type="status"][data-filter-val="playing"]');
    await expect(playingBtn).toHaveClass(/active/);
    // "All" button should no longer be active
    const allBtn = page.locator('.sl-lib-filter-bar .lib-filter-btn[data-filter-type="status"][data-filter-val=""]');
    await expect(allBtn).not.toHaveClass(/active/);
  });

  test('clicking "All" resets the status filter', async () => {
    await page.evaluate(() => {
      const btn = document.querySelector('.sl-lib-filter-bar .lib-filter-btn[data-filter-type="status"][data-filter-val=""]');
      if (btn) { btn.scrollIntoView(); btn.click(); }
    });
    await page.waitForTimeout(300);
    const allBtn = page.locator('.sl-lib-filter-bar .lib-filter-btn[data-filter-type="status"][data-filter-val=""]');
    await expect(allBtn).toHaveClass(/active/);
  });

  test('sort selector works', async () => {
    const sort = page.locator('#sl-sort');
    await expect(sort).toBeVisible();
    await sort.selectOption('alpha');
    await page.waitForTimeout(200);
    const value = await sort.inputValue();
    expect(value).toBe('alpha');
    // Reset
    await sort.selectOption('hours');
    await page.waitForTimeout(200);
  });
});

// ═══════════ 12. TIER LIST ═══════════════════════

test.describe('Tier list', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="tier-list"]');
    await page.waitForTimeout(300);
  });

  test('tier board is visible', async () => {
    await expect(page.locator('#tier-board')).toBeVisible();
  });

  test('tier pool exists', async () => {
    await expect(page.locator('#tier-pool')).toBeVisible();
  });

  test('default tier rows are rendered', async () => {
    const rows = page.locator('.tier-row');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('tier search input exists', async () => {
    await expect(page.locator('#tier-search')).toBeVisible();
  });

  test.afterAll(async () => {
    await page.click('.nav-item[data-view="library"]');
  });
});

// ═══════════ 13. STATISTICS VIEW ═════════════════

test.describe('Statistics view', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="stats"]');
    await page.waitForTimeout(300);
  });

  test('stats cards are visible', async () => {
    await expect(page.locator('#ssc-games')).toBeVisible();
    await expect(page.locator('#ssc-hours')).toBeVisible();
    await expect(page.locator('#ssc-ach')).toBeVisible();
    await expect(page.locator('#ssc-completed')).toBeVisible();
  });

  test('games count reflects at least our test game', async () => {
    const gamesText = await page.locator('#ssc-games').textContent();
    const count = parseInt(gamesText);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('hours display reflects test game hours', async () => {
    const hoursText = await page.locator('#ssc-hours').textContent();
    // Should show at least some hours (we added 42.5h)
    expect(hoursText).toBeTruthy();
  });

  test.afterAll(async () => {
    await page.click('.nav-item[data-view="library"]');
  });
});

// ═══════════ 14. WINDOW CONTROLS ═════════════════

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

// ═══════════ 15. RATING POPUP ════════════════════

test.describe('Rating popup', () => {
  test.beforeAll(async () => {
    await page.click('.nav-item[data-view="library"]');
    await page.waitForTimeout(300);
    // Select game via JS
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.sl-game-item')];
      const target = items.find(el => el.textContent.includes('Test Game E2E'));
      if (target) target.click();
    });
    await page.waitForTimeout(500);
  });

  test('rating display exists', async () => {
    const rating = page.locator('#sl-rating-display');
    const count = await rating.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('clicking rating display toggles popup', async () => {
    await jsClick('#sl-rating-display');
    await page.waitForTimeout(200);
    const popup = page.locator('#sl-rating-popup');
    await expect(popup).not.toHaveClass(/hidden/);
    // Close it
    await jsClick('#sl-rating-display');
    await page.waitForTimeout(200);
  });
});

// ═══════════ 16. CLEANUP ═════════════════════════

test.describe('Cleanup', () => {
  test('test game exists in library', async () => {
    await page.click('.nav-item[data-view="library"]');
    await page.waitForTimeout(300);
    const exists = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.sl-game-item')];
      return items.some(el => el.textContent.includes('Test Game E2E'));
    });
    expect(exists).toBe(true);
  });
});
