// ═══════════════════════════════════════════════════
// Game Tracker — Unit Tests (pure logic)
// Run: npx vitest run
// ═══════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// ── Load source as text and extract functions ──
const src = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');

/** Extract a named function from source by balanced-brace matching */
function extractFnFromSource(name) {
  const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = src.match(re);
  if (!m) return null;
  const start = m.index;
  let depth = 0, end = start;
  for (let i = start + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const body = src.slice(start, end);
  try {
    return new Function(body + `\nreturn ${name};`)();
  } catch { return null; }
}

// ═══════════ VDF Parser ═══════════════════════════

describe('parseVdf', () => {
  const parseVdf = extractFnFromSource('parseVdf');

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

describe('fmtH (format hours)', () => {
  const fmtH = extractFnFromSource('fmtH');

  it.skipIf(!fmtH)('formats zero hours', () => {
    expect(fmtH(0)).toBe('0');
  });

  it.skipIf(!fmtH)('formats whole hours', () => {
    const res = fmtH(100);
    expect(res).toContain('100');
  });

  it.skipIf(!fmtH)('formats decimal hours', () => {
    const res = fmtH(10.567);
    expect(typeof res).toBe('string');
    expect(Number(res.replace(',', '.'))).toBeCloseTo(10.6, 0);
  });
});

// ═══════════ esc (HTML escape) ════════════════════

describe('esc (HTML escape)', () => {
  const esc = extractFnFromSource('esc');

  it.skipIf(!esc)('escapes HTML special characters', () => {
    expect(esc('<script>alert("xss")</script>')).not.toContain('<script>');
    expect(esc('&')).toContain('&amp;');
  });

  it.skipIf(!esc)('handles empty string', () => {
    expect(esc('')).toBe('');
  });

  it.skipIf(!esc)('handles non-string input gracefully', () => {
    expect(() => esc(null)).not.toThrow();
    expect(() => esc(undefined)).not.toThrow();
  });
});

// ═══════════ calcStreak ══════════════════════════

describe('calcStreak', () => {
  const calcStreak = extractFnFromSource('calcStreak');

  it.skipIf(!calcStreak)('returns 0 for empty list', () => {
    expect(calcStreak([])).toBe(0);
  });

  it.skipIf(!calcStreak)('returns 0 for games with no lastPlayedAt', () => {
    expect(calcStreak([{ title: 'Test' }])).toBe(0);
  });

  it.skipIf(!calcStreak)('counts consecutive days', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const list = [
      { lastPlayedAt: today.toISOString() },
      { lastPlayedAt: yesterday.toISOString() },
    ];
    const streak = calcStreak(list);
    expect(streak).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════ normalizeStore ═══════════════════════

describe('normalizeStore', () => {
  const normalizeStore = extractFnFromSource('normalizeStore');

  it.skipIf(!normalizeStore)('returns valid store from null', () => {
    const store = normalizeStore(null);
    expect(store).toHaveProperty('games');
    expect(store).toHaveProperty('settings');
    expect(store).toHaveProperty('collections');
  });

  it.skipIf(!normalizeStore)('returns valid store from empty object', () => {
    const store = normalizeStore({});
    expect(store).toHaveProperty('games');
    expect(typeof store.games).toBe('object');
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

  it('negative margins in sl-layout.active match content padding', () => {
    const css = readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');

    const contentMatch = css.match(/\.content\s*\{[^}]*padding:\s*(\d+)px\s+(\d+)px/);
    expect(contentMatch).not.toBeNull();
    const padTop = Number(contentMatch[1]);
    const padLeft = Number(contentMatch[2]);

    const slMatch = css.match(/\.sl-layout\.active\s*\{[^}]*margin:\s*-(\d+)px\s+-(\d+)px/);
    expect(slMatch).not.toBeNull();
    const marginTop = Number(slMatch[1]);
    const marginLeft = Number(slMatch[2]);

    expect(marginTop, `sl-layout top margin (-${marginTop}) should equal content padding-top (${padTop})`).toBe(padTop);
    expect(marginLeft, `sl-layout left margin (-${marginLeft}) should equal content padding-left (${padLeft})`).toBe(padLeft);
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
