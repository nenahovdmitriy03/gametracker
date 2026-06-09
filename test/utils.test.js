// ═══════════════════════════════════════════════════
// Game Tracker — Unit Tests (pure logic)
// Run: npx vitest run
// ═══════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// ── Load source as text and extract functions ──
const src = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');

/**
 * Extract one or more named functions from source and compile them
 * together so they can call each other (shared scope).
 */
function extractFunctions(...names) {
  const bodies = [];
  for (const name of names) {
    const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
    const m = src.match(re);
    if (!m) return null;
    const start = m.index;
    let depth = 0, end = start;
    for (let i = start + m[0].length - 1; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    bodies.push(src.slice(start, end));
  }
  try {
    const code = bodies.join('\n') + '\nreturn { ' + names.join(', ') + ' };';
    return new Function(code)();
  } catch { return null; }
}

/** Extract a single named function */
function extractFn(name) {
  const result = extractFunctions(name);
  return result ? result[name] : null;
}

// ═══════════ VDF Parser ═══════════════════════════

describe('parseVdf', () => {
  const parseVdf = extractFn('parseVdf');

  it.skipIf(!parseVdf)('parses simple key-value pairs', () => {
    const vdf = `"libraryfolders"\n{\n  "0"\n  {\n    "path"    "C:\\\\Program Files\\\\Steam"\n    "label"   ""\n  }\n}`;
    const result = parseVdf(vdf);
    expect(result).toHaveProperty('libraryfolders');
    expect(result.libraryfolders['0'].path).toBe('C:\\Program Files\\Steam');
  });

  it.skipIf(!parseVdf)('returns empty object for empty input', () => {
    expect(parseVdf('')).toEqual({});
  });

  it.skipIf(!parseVdf)('handles nested structures', () => {
    const vdf = `"root"\n{\n  "child"\n  {\n    "key" "value"\n    "nested"\n    {\n      "deep" "yes"\n    }\n  }\n}`;
    const result = parseVdf(vdf);
    expect(result.root.child.key).toBe('value');
    expect(result.root.child.nested.deep).toBe('yes');
  });
});

// ═══════════ fmtH (format hours) ══════════════════
// fmtH returns:
//   h >= 1000 → Math.round(h).toLocaleString('ru')  (string)
//   h >= 10   → Math.round(h)                        (number)
//   else      → (+h).toFixed(1)                      (string)

describe('fmtH (format hours)', () => {
  const fmtH = extractFn('fmtH');

  it.skipIf(!fmtH)('formats small hours with one decimal', () => {
    expect(fmtH(0)).toBe('0.0');
    expect(fmtH(5.25)).toBe('5.3');
    expect(fmtH(9.99)).toBe('10.0');
  });

  it.skipIf(!fmtH)('formats medium hours as rounded integer', () => {
    expect(fmtH(10)).toBe(10);
    expect(fmtH(100)).toBe(100);
    expect(fmtH(10.567)).toBe(11);
    expect(fmtH(999.4)).toBe(999);
  });

  it.skipIf(!fmtH)('formats large hours with locale separator', () => {
    const res = fmtH(1234);
    expect(typeof res).toBe('string');
    // locale may use different space chars — just check digits are there
    expect(res.replace(/\s/g, '')).toBe('1234');
  });
});

// ═══════════ esc (HTML escape) ════════════════════

describe('esc (HTML escape)', () => {
  const esc = extractFn('esc');

  it.skipIf(!esc)('escapes HTML special characters', () => {
    expect(esc('<script>alert("xss")</script>')).not.toContain('<script>');
    expect(esc('&')).toContain('&amp;');
    expect(esc('"')).toContain('&quot;');
  });

  it.skipIf(!esc)('handles empty string', () => {
    expect(esc('')).toBe('');
  });

  it.skipIf(!esc)('handles null/undefined gracefully', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

// ═══════════ calcStreak ══════════════════════════
// calcStreak(list) reads game.sessions[].date

describe('calcStreak', () => {
  const calcStreak = extractFn('calcStreak');

  it.skipIf(!calcStreak)('returns 0 for empty list', () => {
    expect(calcStreak([])).toBe(0);
  });

  it.skipIf(!calcStreak)('returns 0 for games with no sessions', () => {
    expect(calcStreak([{ title: 'Test', sessions: [] }])).toBe(0);
    expect(calcStreak([{ title: 'Test' }])).toBe(0);
  });

  it.skipIf(!calcStreak)('counts consecutive days from today', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const list = [{
      sessions: [
        { date: today.toISOString() },
        { date: yesterday.toISOString() },
      ]
    }];
    const streak = calcStreak(list);
    expect(streak).toBeGreaterThanOrEqual(2);
  });

  it.skipIf(!calcStreak)('breaks streak on gap day', () => {
    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    // played today and 3 days ago but NOT yesterday or 2 days ago
    const list = [{
      sessions: [
        { date: today.toISOString() },
        { date: threeDaysAgo.toISOString() },
      ]
    }];
    const streak = calcStreak(list);
    expect(streak).toBe(1); // only today counts
  });
});

// ═══════════ normalizeStore ═══════════════════════
// Depends on: normalizeAchievement, screenshotFallbackId,
//             normalizeScreenshot, normalizeGame, normalizeStore

describe('normalizeStore', () => {
  const fns = extractFunctions(
    'normalizeAchievement',
    'screenshotFallbackId',
    'normalizeScreenshot',
    'normalizeGame',
    'normalizeStore',
  );

  const normalizeStore = fns?.normalizeStore;

  it.skipIf(!normalizeStore)('returns valid store from empty object', () => {
    const store = normalizeStore({});
    expect(store).toHaveProperty('games');
    expect(store).toHaveProperty('settings');
    expect(store).toHaveProperty('collections');
    expect(typeof store.games).toBe('object');
  });

  it.skipIf(!normalizeStore)('provides defaults for missing fields', () => {
    const store = normalizeStore({});
    expect(store.games).toEqual({});
    expect(store.collections).toEqual({});
    expect(store.settings).toEqual({});
    expect(store.lastBackup).toBeNull();
  });

  it.skipIf(!normalizeStore)('preserves existing game data', () => {
    const input = {
      games: { g1: { title: 'Test Game', hoursPlayed: 10 } },
      settings: { theme: 'aurora' },
    };
    const store = normalizeStore(input);
    expect(store.games.g1.title).toBe('Test Game');
    expect(store.games.g1.hoursPlayed).toBe(10);
    expect(store.settings.theme).toBe('aurora');
  });

  it.skipIf(!normalizeStore)('normalizes game fields', () => {
    const input = {
      games: { g1: { title: 'Test', tags: null, sessions: null } },
    };
    const store = normalizeStore(input);
    expect(Array.isArray(store.games.g1.tags)).toBe(true);
    expect(Array.isArray(store.games.g1.sessions)).toBe(true);
  });
});

// ═══════════ THEMES / DENSITY config ═════════════

describe('Theme configuration', () => {
  it('THEMES array includes all theme IDs from HTML', () => {
    const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
    const htmlThemeIds = [...html.matchAll(/data-theme-id="([^"]+)"/g)].map(m => m[1]);

    const themesMatch = src.match(/const THEMES\s*=\s*\[([^\]]+)\]/);
    expect(themesMatch).not.toBeNull();
    const jsThemes = themesMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));

    for (const id of htmlThemeIds) {
      expect(jsThemes, `Theme '${id}' is in HTML but missing from THEMES array`).toContain(id);
    }
  });

  it('DENSITY_MODES array includes all density IDs from HTML', () => {
    const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
    const htmlDensityIds = [...html.matchAll(/data-density-id="([^"]+)"/g)].map(m => m[1]);

    const modesMatch = src.match(/const DENSITY_MODES\s*=\s*\[([^\]]+)\]/);
    expect(modesMatch).not.toBeNull();
    const jsModes = modesMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));

    for (const id of htmlDensityIds) {
      expect(jsModes, `Density '${id}' is in HTML but missing from DENSITY_MODES`).toContain(id);
    }
  });
});

// ═══════════ Nav ↔ View integrity ════════════════

describe('Navigation integrity', () => {
  it('every nav-item data-view has a matching view section in HTML', () => {
    const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
    const navViews = [...html.matchAll(/class="nav-item[^"]*"[^>]*data-view="([^"]+)"/g)].map(m => m[1]);

    for (const viewName of navViews) {
      const viewId = `view-${viewName}`;
      expect(html, `nav data-view="${viewName}" → missing #${viewId}`).toContain(`id="${viewId}"`);
    }
  });

  it('all view sections are inside .content element', () => {
    const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
    const contentStart = html.indexOf('<main class="content">');
    const contentEnd = html.indexOf('</main>');
    const viewMatches = [...html.matchAll(/id="(view-[^"]+)"/g)];

    for (const m of viewMatches) {
      expect(m.index, `${m[1]} should be inside .content`).toBeGreaterThan(contentStart);
      expect(m.index, `${m[1]} should be inside .content`).toBeLessThan(contentEnd);
    }
  });

  it('sl-layout.active uses negative margins with matching width/height calc', () => {
    const css = readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');
    
    // sl-layout.active should have negative margins and compensating width/height
    const slBlock = css.match(/\.sl-layout\.active\s*\{[^}]+\}/);
    expect(slBlock, 'sl-layout.active block exists').not.toBeNull();

    const marginMatch = slBlock[0].match(/margin:\s*-(\d+)px\s+-(\d+)px/);
    expect(marginMatch, 'sl-layout.active has negative margins').not.toBeNull();
    const [, marginTop, marginLeft] = marginMatch;

    const widthMatch = slBlock[0].match(/width:\s*calc\(100%\s*\+\s*(\d+)px\)/);
    const heightMatch = slBlock[0].match(/height:\s*calc\(100%\s*\+\s*(\d+)px\)/);
    expect(widthMatch, 'sl-layout.active has width calc').not.toBeNull();
    expect(heightMatch, 'sl-layout.active has height calc').not.toBeNull();

    // width compensation should be 2 × marginLeft, height = 2 × marginTop
    expect(Number(widthMatch[1]), 'width calc = 2 × left margin').toBe(Number(marginLeft) * 2);
    expect(Number(heightMatch[1]), 'height calc = 2 × top margin').toBe(Number(marginTop) * 2);
  });
});

// ═══════════ CSS .hidden ═════════════════════════

describe('CSS .hidden utility', () => {
  it('.hidden uses display:none !important', () => {
    const css = readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');
    const match = css.match(/\.hidden\s*\{\s*display:\s*none\s*!important/);
    expect(match, '.hidden should have display: none !important').not.toBeNull();
  });
});

// ═══════════ Modals hidden by default ════════════

describe('Modal overlays', () => {
  it('all modal-overlay elements have .hidden class by default', () => {
    const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
    const modals = [...html.matchAll(/class="modal-overlay([^"]*)"/g)];

    expect(modals.length).toBeGreaterThan(0);
    for (const m of modals) {
      expect(m[1], `modal-overlay should have .hidden: "${m[0]}"`).toContain('hidden');
    }
  });
});
