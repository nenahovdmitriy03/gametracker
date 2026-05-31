/**
 * GameTracker — Skeleton Loader Helpers
 */
(function (global) {
  'use strict';

  function div(className) {
    const el = document.createElement('div');
    el.className = className;
    el.dataset.gtSkeleton = '1';
    return el;
  }

  function gameGrid(container, count) {
    if (!container) return;
    count = count || 12;
    clear(container);
    const wrap = div('gt-skeleton-grid');
    wrap.dataset.gtSkeletonContainer = '1';
    for (let i = 0; i < count; i++) {
      wrap.appendChild(div('gt-skeleton gt-skeleton--card'));
    }
    container.appendChild(wrap);
  }

  function list(container, count) {
    if (!container) return;
    count = count || 8;
    clear(container);
    const wrap = document.createElement('div');
    wrap.dataset.gtSkeletonContainer = '1';
    for (let i = 0; i < count; i++) {
      wrap.appendChild(div('gt-skeleton gt-skeleton--row'));
    }
    container.appendChild(wrap);
  }

  function text(container, lines) {
    if (!container) return;
    lines = lines || 3;
    clear(container);
    const wrap = document.createElement('div');
    wrap.dataset.gtSkeletonContainer = '1';
    for (let i = 0; i < lines; i++) {
      const cls = i === lines - 1 ? 'gt-skeleton gt-skeleton--text medium' : 'gt-skeleton gt-skeleton--text';
      wrap.appendChild(div(cls));
    }
    container.appendChild(wrap);
  }

  function statsCards(container, count) {
    if (!container) return;
    count = count || 4;
    clear(container);
    const wrap = document.createElement('div');
    wrap.dataset.gtSkeletonContainer = '1';
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(' + count + ',1fr);gap:12px';
    for (let i = 0; i < count; i++) {
      const card = div('gt-skeleton');
      card.style.cssText = 'height:96px;border-radius:14px';
      wrap.appendChild(card);
    }
    container.appendChild(wrap);
  }

  function clear(container) {
    if (!container) return;
    const containers = container.querySelectorAll('[data-gt-skeleton-container="1"]');
    containers.forEach(function (n) { n.remove(); });
    const items = container.querySelectorAll('[data-gt-skeleton="1"]');
    items.forEach(function (n) { n.remove(); });
  }

  global.GTSkeleton = { gameGrid: gameGrid, list: list, text: text, statsCards: statsCards, clear: clear };
})(window);
