/**
 * GameTracker — UX Enhancements Loader
 *
 * Single entry point that boots all enhancement modules.
 * Modules must be loaded before this file.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    console.log(
      '%c[GameTracker UX] %cEnhancements loaded',
      'color:#7c7fcf;font-weight:bold',
      'color:#888'
    );
    console.log('  ⌨️  Cmd/Ctrl+K  — открыть командную палитру');
    console.log('  📦  GTFuzzy, GTVirtualList, GTSkeleton, GTCommandPalette — глобальные API');
  });

  global.GTEnhancements = {
    fuzzy: function () { return global.GTFuzzy; },
    virtual: function () { return global.GTVirtualList; },
    skeleton: function () { return global.GTSkeleton; },
    palette: function () { return global.GTCommandPalette; },
    version: '2.0.0-ux'
  };
})(window);
