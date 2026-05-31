/**
 * GameTracker — Fuzzy Search Module
 * Lightweight fuzzy matching inspired by VS Code / Sublime
 *
 * Usage:
 *   GTFuzzy.score("dark souls", "ds")     -> { score, matches: [0, 5] }
 *   GTFuzzy.filter(items, "ds", x => x.title)
 *   GTFuzzy.highlight("Dark Souls", [0, 5])
 */
(function (global) {
  'use strict';

  function score(target, query) {
    if (!query) return { score: 0, matches: [] };
    if (!target) return null;

    const t = target.toLowerCase();
    const q = query.toLowerCase();
    const matches = [];
    let ti = 0;
    let qi = 0;
    let scoreVal = 0;
    let consecutive = 0;
    let prevMatch = -2;

    while (ti < t.length && qi < q.length) {
      if (t[ti] === q[qi]) {
        matches.push(ti);
        if (prevMatch === ti - 1) {
          consecutive++;
          scoreVal += 5 + consecutive * 2;
        } else {
          consecutive = 0;
          scoreVal += 1;
        }
        if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-' || t[ti - 1] === '_') {
          scoreVal += 10;
        }
        if (target[ti] !== target[ti].toLowerCase()) {
          scoreVal += 3;
        }
        prevMatch = ti;
        qi++;
      }
      ti++;
    }

    if (qi < q.length) return null;
    scoreVal -= Math.max(0, t.length - matches.length) * 0.1;
    return { score: scoreVal, matches };
  }

  function filter(items, query, getText) {
    if (!query) return items.map((item) => ({ item, score: 0, matches: [] }));
    const results = [];
    for (const item of items) {
      const text = getText ? getText(item) : String(item);
      const r = score(text, query);
      if (r) results.push({ item, score: r.score, matches: r.matches });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  function highlight(text, matches) {
    if (!matches || !matches.length) return escapeHtml(text);
    let html = '';
    let mi = 0;
    for (let i = 0; i < text.length; i++) {
      if (mi < matches.length && matches[mi] === i) {
        html += '<mark class="gt-fuzzy-match">' + escapeHtml(text[i]) + '</mark>';
        mi++;
      } else {
        html += escapeHtml(text[i]);
      }
    }
    return html;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.GTFuzzy = { score, filter, highlight };
})(window);
