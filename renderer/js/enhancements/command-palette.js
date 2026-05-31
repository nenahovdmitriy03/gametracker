/**
 * GameTracker — Command Palette (Cmd/Ctrl+K)
 *
 * Auto-builds commands from sidebar nav + games library if found in DOM.
 * Register custom commands:
 *   GTCommandPalette.register({
 *     id: 'sync-steam', title: 'Sync Steam library',
 *     icon: '🎮', group: 'Actions', shortcut: '⌘S',
 *     run: () => window.syncSteam && window.syncSteam()
 *   });
 */
(function (global) {
  'use strict';

  const state = {
    open: false,
    query: '',
    activeIdx: 0,
    items: [],
    custom: [],
  };

  let backdrop, palette, input, listEl;

  function ensureDOM() {
    if (palette) return;

    backdrop = document.createElement('div');
    backdrop.className = 'gt-cmdk-backdrop';
    backdrop.addEventListener('click', close);

    palette = document.createElement('div');
    palette.className = 'gt-cmdk';
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', 'Command palette');
    palette.innerHTML =
      '<div class="gt-cmdk__search">' +
        '<svg class="gt-cmdk__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>' +
        '<input class="gt-cmdk__input" type="text" placeholder="Поиск команды или игры..." autocomplete="off" spellcheck="false">' +
        '<span class="gt-cmdk__kbd">ESC</span>' +
      '</div>' +
      '<div class="gt-cmdk__list"></div>' +
      '<div class="gt-cmdk__footer">' +
        '<span class="gt-cmdk__footer-hint">' +
          '<span class="gt-cmdk__kbd">↑↓</span> навигация ' +
          '<span class="gt-cmdk__kbd">↵</span> открыть' +
        '</span>' +
        '<span class="gt-cmdk__footer-hint">GameTracker · ⌘K</span>' +
      '</div>';

    document.body.appendChild(backdrop);
    document.body.appendChild(palette);

    input = palette.querySelector('.gt-cmdk__input');
    listEl = palette.querySelector('.gt-cmdk__list');

    input.addEventListener('input', function () {
      state.query = input.value;
      state.activeIdx = 0;
      render();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.activeIdx = Math.min(state.items.length - 1, state.activeIdx + 1);
        render();
        scrollActiveIntoView();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.activeIdx = Math.max(0, state.activeIdx - 1);
        render();
        scrollActiveIntoView();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runActive();
      }
    });
  }

  function collectCommands() {
    const cmds = [];

    // Sidebar nav items (best-effort heuristics)
    document.querySelectorAll('[data-view], [data-nav], .nav-item, .sidebar-item').forEach(function (el) {
      const view = el.dataset.view || el.dataset.nav;
      const title = (el.textContent || '').trim();
      if (!title || !view) return;
      cmds.push({
        id: 'nav-' + view,
        title: 'Перейти: ' + title,
        subtitle: 'Навигация',
        group: 'Навигация',
        icon: '🧭',
        run: function () { el.click(); }
      });
    });

    // Games from library (best-effort heuristics)
    document.querySelectorAll('[data-game-id], .game-card, .library-item').forEach(function (el) {
      const t = el.querySelector('.game-title, .title, h3, h4');
      const title = (el.dataset.title || el.dataset.name || (t ? t.textContent : '') || el.getAttribute('aria-label') || '').trim();
      if (!title || title.length > 80) return;
      cmds.push({
        id: 'game-' + (el.dataset.gameId || title),
        title: title,
        subtitle: 'Открыть игру',
        group: 'Игры',
        icon: '🎮',
        run: function () {
          el.click();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });

    // Theme switching
    const themes = ['aurora', 'obsidian', 'neon', 'forest', 'crimson', 'slate'];
    themes.forEach(function (t) {
      cmds.push({
        id: 'theme-' + t,
        title: 'Тема: ' + t.charAt(0).toUpperCase() + t.slice(1),
        subtitle: 'Сменить тему',
        group: 'Темы',
        icon: '🎨',
        run: function () {
          document.documentElement.setAttribute('data-theme', t);
          try { localStorage.setItem('gt-theme', t); } catch (e) {}
        }
      });
    });

    cmds.push.apply(cmds, state.custom);
    return cmds;
  }

  function render() {
    const all = collectCommands();
    const q = state.query.trim();
    let results;
    if (!q) {
      results = all.map(function (c) { return { item: c, matches: [], score: 0 }; });
    } else if (global.GTFuzzy) {
      results = global.GTFuzzy.filter(all, q, function (c) { return c.title + ' ' + (c.subtitle || ''); });
    } else {
      const ql = q.toLowerCase();
      results = all.filter(function (c) {
        return (c.title + ' ' + (c.subtitle || '')).toLowerCase().indexOf(ql) !== -1;
      }).map(function (c) { return { item: c, matches: [], score: 0 }; });
    }

    state.items = results.map(function (r) { return r.item; }).slice(0, 60);
    if (state.activeIdx >= state.items.length) state.activeIdx = 0;

    if (!state.items.length) {
      listEl.innerHTML = '<div class="gt-cmdk__empty">Ничего не найдено</div>';
      return;
    }

    let html = '';
    let lastGroup = null;
    state.items.forEach(function (cmd, idx) {
      if (cmd.group !== lastGroup) {
        html += '<div class="gt-cmdk__group-title">' + escapeHtml(cmd.group || 'Команды') + '</div>';
        lastGroup = cmd.group;
      }
      const match = results.find(function (r) { return r.item === cmd; });
      const titleHtml = (match && match.matches && match.matches.length && global.GTFuzzy)
        ? global.GTFuzzy.highlight(cmd.title, match.matches)
        : escapeHtml(cmd.title);
      const subtitle = cmd.subtitle ? '<div class="gt-cmdk__item-subtitle">' + escapeHtml(cmd.subtitle) + '</div>' : '';
      const shortcut = cmd.shortcut ? '<span class="gt-cmdk__item-shortcut">' + escapeHtml(cmd.shortcut) + '</span>' : '';
      html +=
        '<div class="gt-cmdk__item ' + (idx === state.activeIdx ? 'is-active' : '') + '" data-idx="' + idx + '">' +
          '<div class="gt-cmdk__item-icon">' + escapeHtml(cmd.icon || '•') + '</div>' +
          '<div class="gt-cmdk__item-body">' +
            '<div class="gt-cmdk__item-title">' + titleHtml + '</div>' +
            subtitle +
          '</div>' +
          shortcut +
        '</div>';
    });
    listEl.innerHTML = html;

    listEl.querySelectorAll('.gt-cmdk__item').forEach(function (el) {
      el.addEventListener('click', function () {
        state.activeIdx = parseInt(el.dataset.idx, 10);
        runActive();
      });
      el.addEventListener('mousemove', function () {
        const idx = parseInt(el.dataset.idx, 10);
        if (idx !== state.activeIdx) {
          state.activeIdx = idx;
          listEl.querySelectorAll('.gt-cmdk__item.is-active').forEach(function (n) { n.classList.remove('is-active'); });
          el.classList.add('is-active');
        }
      });
    });
  }

  function scrollActiveIntoView() {
    const active = listEl.querySelector('.gt-cmdk__item.is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function runActive() {
    const cmd = state.items[state.activeIdx];
    if (!cmd) return;
    close();
    try { if (cmd.run) cmd.run(); }
    catch (e) { console.error('[GTCommandPalette] command failed:', e); }
  }

  function open() {
    ensureDOM();
    state.open = true;
    state.query = '';
    state.activeIdx = 0;
    input.value = '';
    backdrop.classList.add('is-open');
    palette.classList.add('is-open');
    setTimeout(function () { input.focus(); }, 50);
    render();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    if (backdrop) backdrop.classList.remove('is-open');
    if (palette) palette.classList.remove('is-open');
  }

  function toggle() {
    if (state.open) close(); else open();
  }

  function register(cmd) {
    state.custom.push(cmd);
  }

  window.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      toggle();
    }
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.GTCommandPalette = { open: open, close: close, toggle: toggle, register: register };
})(window);
