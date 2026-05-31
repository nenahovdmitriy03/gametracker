/**
 * GameTracker — UX Enhancements Bootstrap (PR #2)
 *
 * Single-file entry point. Подключается одной строкой в index.html:
 *   <script src="js/enhancements/ux-bootstrap.js"></script>
 *
 * Bootstrap САМ подгружает CSS и все JS-модули в правильном порядке.
 * Не модифицирует существующий код, легко откатывается (удалить одну строку).
 */
(function () {
  'use strict';

  // Защита от двойной загрузки
  if (window.__gtUxBootstrapped) return;
  window.__gtUxBootstrapped = true;

  // Определяем базовый путь относительно этого скрипта
  function resolveBase() {
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const src = scripts[i].src || '';
        if (src.indexOf('ux-bootstrap.js') !== -1) {
          // remove filename → directory URL
          return src.substring(0, src.lastIndexOf('/') + 1);
        }
      }
    } catch (e) {}
    return 'js/enhancements/';
  }

  const base = resolveBase();
  // CSS лежит в renderer/css/enhancements/, а JS в renderer/js/enhancements/
  // base указывает на js/enhancements/, значит CSS = base + '../../css/enhancements/'
  const cssBase = base.replace(/js\/enhancements\/?$/, 'css/enhancements/');

  function loadCSS(href) {
    return new Promise(function (resolve) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = function () {
        console.warn('[GT UX] failed to load CSS:', href);
        resolve();
      };
      document.head.appendChild(link);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve) {
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // preserve load order
      s.onload = resolve;
      s.onerror = function () {
        console.warn('[GT UX] failed to load script:', src);
        resolve();
      };
      document.head.appendChild(s);
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  // Boot sequence: CSS → modules in dependency order → loader announcement
  ready(function () {
    loadCSS(cssBase + 'ux-improvements.css');

    // Sequential to preserve dependency order:
    // fuzzy-search → virtual-list → skeleton-loader → command-palette (needs fuzzy) → ux-loader
    loadScript(base + 'fuzzy-search.js')
      .then(function () { return loadScript(base + 'virtual-list.js'); })
      .then(function () { return loadScript(base + 'skeleton-loader.js'); })
      .then(function () { return loadScript(base + 'command-palette.js'); })
      .then(function () { return loadScript(base + 'ux-loader.js'); })
      .then(function () {
        // Fire a custom event so app.js can react if needed
        try {
          window.dispatchEvent(new CustomEvent('gt-ux-ready', {
            detail: {
              modules: ['GTFuzzy', 'GTVirtualList', 'GTSkeleton', 'GTCommandPalette']
            }
          }));
        } catch (e) {}
      });
  });
})();
