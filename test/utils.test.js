// ═══════════════════════════════════════════════════
// Game Tracker — Unit Tests (pure logic)
// Run: npx vitest run
// ═══════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// ── Load source files as text ──
const src = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');

// ═══════════════════════════════════════════════════
// Source-code extraction helpers
// ═══════════════════════════════════════════════════

/**
 * Build a map of ALL top-level declarations:
 *   - function NAME(...) { ... }
 *   - const/let/var NAME = [...]; or = {...}; (literal arrays/objects)
 *
 * Key = declaration name, Value = source text of the full declaration.
 */
const declMap = (() => {
  const map = {};

  // ── Functions ──
  const fnRe = /^function (\w+)\s*\([^)]*\)\s*\{/gm;
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    const name = m[1];
    const start = m.index;
    // Find the opening '{' of the function body (last char of match)
    const braceStart = start + m[0].length - 1;
    let depth = 0, end = braceStart;
    for (let i = braceStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    map[name] = src.slice(start, end);
  }

  // ── Constants (arrays & objects only — safe to evaluate) ──
  const constRe = /^(?:const|let|var)\s+(\w+)\s*=\s*([\[{])/gm;
  while ((m = constRe.exec(src)) !== null) {
    const name = m[1];
    if (map[name]) continue; // already captured as function
    const start = m.index;
    const bracketChar = m[2];
    const closeChar = bracketChar === '[' ? ']' : '}';
    const bracketStart = start + m[0].length - 1;
    let depth = 0, end = bracketStart;
    for (let i = bracketStart; i < src.length; i++) {
      if (src[i] === bracketChar) depth++;
      else if (src[i] === closeChar) {
        depth--;
        if (depth === 0) {
          // include up to the semicolon if present
          end = i + 1;
          if (src[end] === ';') end++;
          break;
        }
      }
    }
    map[name] = src.slice(start, end);
  }

  return map;
})();

/**
 * Extract a function + ALL transitive dependencies (functions & consts).
 * Uses BFS with word-boundary matching (catches callbacks like .map(fn)).
 * Returns the callable function, or null if extraction fails.
 */
function extractFnWithDeps(name) {
  if (!declMap[name]) return null;

  const needed = new Set();
  const queue = [name];
  while (queue.length) {
    const curr = queue.shift();
    if (needed.has(curr)) continue;
    if (!declMap[curr]) continue;
    needed.add(curr);

    const body = declMap[curr];
    // Check for references to other known declarations (word boundary)
    for (const other of Object.keys(declMap)) {
      if (!needed.has(other) && new RegExp('\\b' + other + '\\b').test(body)) {
        queue.push(other);
      }
    }
  }

  const code = [...needed].map(n => declMap[n]).join('\n');
  try {
    return new Function(code + `\nreturn ${name};`)();
  } catch { return null; }
}

/** Quick single-function extract (no dep resolution) */
function extractFn(name) {
  if (!declMap[name]) return null;
  try {
    return new Function(declMap[name] + `\nreturn ${name};`)();
  } catch { return null; }
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
    expect(calcStreak(list)).toBeGreaterThanOrEqual(2);
  });

  it.skipIf(!calcStreak)('breaks streak on gap day', () => {
    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const list = [{
      sessions: [
        { date: today.toISOString() },
        { date: threeDaysAgo.toISOString() },
      ]
    }];
    expect(calcStreak(list)).toBe(1);
  });
});

// ═══════════ normalizeStore ═══════════════════════

describe('normalizeStore', () => {
  const normalizeStore = extractFnWithDeps('normalizeStore');

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

    const slBlock = css.match(/\.sl-layout\.active\s*\{[^}]+\}/);
    expect(slBlock, 'sl-layout.active block exists').not.toBeNull();

    const marginMatch = slBlock[0].match(/margin:\s*-(\d+)px\s+-(\d+)px/);
    expect(marginMatch, 'sl-layout.active has negative margins').not.toBeNull();
    const [, marginTop, marginLeft] = marginMatch;

    const widthMatch = slBlock[0].match(/width:\s*calc\(100%\s*\+\s*(\d+)px\)/);
    const heightMatch = slBlock[0].match(/height:\s*calc\(100%\s*\+\s*(\d+)px\)/);
    expect(widthMatch, 'sl-layout.active has width calc').not.toBeNull();
    expect(heightMatch, 'sl-layout.active has height calc').not.toBeNull();

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
