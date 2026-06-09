/* ════════════════════════════════════════════════
   Game Tracker — app.js
   ════════════════════════════════════════════════ */
'use strict';

// ── Состояние ─────────────────────────────────────────────
let store = { games: {}, collections: {}, settings: {}, lastBackup: null };

// Удаление найденных шуток/незначительных названий из локального хранилища
function removeJokeGamesFromStore(st) {
  if (!st?.games) return st;
  const nextGames = {};
  for (const [id, g] of Object.entries(st.games || {})) {
    const title = String(g?.title ?? g?.name ?? '').toLowerCase();
    // Удаляем если название содержит слово "шут" (русский) или "joke" (английский)
    if (title.includes('шут') || title.includes('joke')) continue;
    nextGames[id] = g;
  }
  st.games = nextGames;
  return st;
}
let activeSession    = null;   // { gameId, startTime, timerInterval }
let activeAchievementPoller = null;
let activeAchievementPollTimeout = null;
let activeAchievementPollBusy = false;
let activeAchievementPollToken = 0;
let notificationPermissionRequested = false;
const ACHIEVEMENT_POLL_DELAY_MS = 2000;
const ACHIEVEMENT_POLL_INTERVAL_MS = 3000;
const ACHIEVEMENT_NOTICE_TTL_MS = 6500;
const ACTIVE_SESSION_STORAGE_KEY = 'gt.activeSession';
const LIBRARY_SIDEBAR_AUTO_COLLAPSE_WIDTH = 1280;
const LIBRARY_SIDEBAR_STORAGE_KEY = 'gt.librarySidebarCollapsed';
const LIBRARY_SEARCH_DEBOUNCE_MS = 120;
const SL_GAME_LIST_ITEM_HEIGHT = 44;
const SL_GAME_LIST_OVERSCAN = 10;
let openedGameId     = null;   // id игры в открытой модалке
let activeCollection = null;   // id выбранной коллекции (фильтр библиотеки) или null = все
let editingCollId    = null;   // id редактируемой коллекции или null = создание новой
let activeTagFilter    = null;   // активный тег-фильтр в библиотеке
let activePlatformFilter = '';   // '' = все, 'steam'|'ea'
let activeStatusFilter = '';     // '' = все, 'playing'|'completed'|'dropped'|'planned'|'none'
let activeRatingFilter = null;   // null = все, число = минимальная оценка диапазона (0 = без оценки)
let prevView           = 'library';
let selectedLibGameId  = null;   // выбранная игра в Steam-библиотеке
let librarySidebarCollapsed = false;
let librarySidebarResizeTimer = null;
let librarySearchTimer = 0;
let appHeaderScrollRaf = 0;
let libraryDetailScrollRaf = 0;
let slGameListScrollRaf = 0;
let tierSearchQuery = '';
let tierPendingDrag = null;
let tierPointerDrag = null;
let tierAutoScrollFrame = 0;
let tierSelectedGameId = '';
let tierInsertMarker = null;
let statusContextGameId = null;
const scrollIdleTimers = new WeakMap();
const SCROLL_IDLE_DELAY_MS = 180;
const LIBRARY_SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);
let expandedLibraryOverviewSections = new Set();
const steamArtworkCache = new Map();
let saveInFlight = null;
let saveQueued = false;
let slGameListVirtual = { list: [], start: 0, end: 0 };

const STATUS_LABELS = {
  playing: '▶ Играю',
  completed: '◆ Пройдена',
  dropped: '✕ Брошена',
  planned: '◎ В планах',
};

const STATUS_CONTEXT_OPTIONS = [
  { value: 'playing', label: 'Играю' },
  { value: 'completed', label: 'Пройдена' },
  { value: 'dropped', label: 'Брошена' },
  { value: 'planned', label: 'В планах' },
  { value: '', label: 'Без статуса' },
];

const DEFAULT_LIBRARY_OVERVIEW_SECTION_IDS = [
  'playing',
  'completed',
  'dropped',
  'planned',
  'all',
];

const LIBRARY_OVERVIEW_SECTION_DEFS = [
  { id: 'playing', label: 'Играю', title: 'Сейчас играю', note: 'Игры со статусом «Играю»' },
  { id: 'completed', label: 'Пройдена', title: 'Пройдена', note: 'Игры со статусом «Пройдена»' },
  { id: 'dropped', label: 'Брошена', title: 'Брошена', note: 'Игры со статусом «Брошена»' },
  { id: 'planned', label: 'В планах', title: 'В планах', note: 'Игры, которые ждут своей очереди' },
  { id: 'all', label: 'Все игры', title: 'Вся библиотека', note: 'Все игры по текущим фильтрам' },
];

const DEFAULT_TIER_ROWS = [
  { id: 's', label: 'S', color: '#ff5c7a' },
  { id: 'a', label: 'A', color: '#ffb86b' },
  { id: 'b', label: 'B', color: '#f6e05e' },
  { id: 'c', label: 'C', color: '#4ade80' },
  { id: 'd', label: 'D', color: '#60a5fa' },
];

const TIER_ROW_COLORS = ['#ff5c7a', '#ffb86b', '#f6e05e', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6'];

function steamLegacyHeaderUrl(appid = '') {
  const cleanAppId = String(appid || '').trim();
  return cleanAppId ? `https://cdn.akamai.steamstatic.com/steam/apps/${cleanAppId}/header.jpg` : '';
}

function isSteamLegacyArtworkUrl(url = '') {
  return /^https:\/\/cdn\.akamai\.steamstatic\.com\/steam\/apps\/\d+\/(?:header|library_600x900_2x)\.jpg$/i
    .test(String(url || '').trim());
}

function getAchievementAppId(game = {}) {
  return String(game.steamAppId || game.appid || '').trim();
}

function normalizeAchievementMatchText(value = '') {
  return String(value || '')
    .replace(/[\u2122\u00ae\u00a9]/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\u0400-\u04FF]+/g, ' ')
    .trim()
    .toLowerCase();
}

function achievementMatchKeys(achievement = {}, idx = 0) {
  const keys = [];
  const push = (prefix, value) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    keys.push(`${prefix}:${clean}`);
  };

  push('api', achievement.apiname);
  push('match', achievement.matchKey);

  const variants = [
    [achievement.displayName, achievement.description],
    [achievement.englishName, achievement.englishDescription],
    [achievement.displayName, achievement.englishDescription],
    [achievement.englishName, achievement.description],
  ];

  variants.forEach(([name, description]) => {
    const nameKey = normalizeAchievementMatchText(name);
    const descKey = normalizeAchievementMatchText(description);
    if (nameKey && descKey) push('both', `${nameKey}__${descKey}`);
    if (nameKey) push('name', nameKey);
    if (descKey) push('desc', descKey);
  });

  if (!keys.length) push('idx', idx);
  return [...new Set(keys)];
}

function getLaunchPath(game = {}) {
  return String(game.launchPath || '').trim();
}

function dateTime(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

function latestIsoDate(...values) {
  const time = Math.max(...values.map(dateTime), 0);
  return time > 0 ? new Date(time).toISOString() : null;
}

function canLaunchLocally(game = {}) {
  return !!getLaunchPath(game);
}

function canImportSteamAchievements(game = {}) {
  return !!getAchievementAppId(game);
}

function canPollSteamAchievements(game = {}) {
  if (!getAchievementAppId(game)) return false;
  const source = String(game.source || '').trim().toLowerCase();
  const platform = String(game.platform || '').trim().toLowerCase();
  return source === 'steam' || platform === 'steam' || source === 'manual';
}

function syncSourceName(game = {}) {
  if (game.source === 'steam') return 'Steam';
  if (game.source === 'ea') return 'EA App';
  return game.platform || 'библиотекой';
}

function gamePlatformFilterKey(game = {}) {
  const source = String(game.source || '').trim().toLowerCase();
  const platform = String(game.platform || '').trim().toLowerCase();
  if (source === 'ea' || platform === 'ea app' || platform === 'ea') return 'ea';
  if (source === 'steam' || platform === 'steam' || game.steamAppId || game.appid) return 'steam';
  return '';
}

function libraryPlatformLabel(value = '') {
  if (value === 'steam') return 'Steam';
  if (value === 'ea') return 'EA';
  return '';
}

function achievementKey(ach = {}, idx = 0) {
  return String(ach.apiname || ach.displayName || `achievement_${idx}`);
}

function normalizeAchievement(raw = {}) {
  const achievement = { ...raw };
  if (achievement.iconGray == null && achievement.icon_gray != null) {
    achievement.iconGray = achievement.icon_gray;
  }
  const percentRaw = achievement.globalPercent ?? achievement.percent ?? achievement.global_percentage ?? null;
  const percentNum = Number.parseFloat(String(percentRaw ?? '').replace(',', '.'));
  achievement.globalPercent = Number.isFinite(percentNum) ? percentNum : null;
  achievement.achieved = !!achievement.achieved;
  return achievement;
}

function screenshotFallbackId(shot = {}, idx = 0) {
  const raw = shot.fileName || shot.localPath || shot.url || shot.driveFileId || `image_${idx}`;
  return `shot_${idx}_${String(raw).replace(/[^a-z0-9]+/gi, '_').slice(0, 46)}`;
}

function normalizeScreenshot(raw = {}, idx = 0) {
  const shot = { ...raw };
  shot.id = String(shot.id || screenshotFallbackId(shot, idx));
  shot.type = 'image';
  shot.title = String(shot.title || shot.fileName || `Скриншот ${idx + 1}`).trim();
  shot.fileName = String(shot.fileName || shot.driveFileName || '').trim();
  shot.localPath = String(shot.localPath || '').trim();
  shot.url = String(shot.url || '').trim();
  shot.driveFileId = String(shot.driveFileId || '').trim();
  shot.driveFileName = String(shot.driveFileName || shot.fileName || '').trim();
  shot.mimeType = String(shot.mimeType || '').trim();
  shot.addedAt = shot.addedAt || new Date().toISOString();
  return shot;
}

function mergeScreenshotLists(base = [], extra = []) {
  const map = new Map();
  [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])].forEach((shot, idx) => {
    const normalized = normalizeScreenshot(shot, idx);
    const key = normalized.id || normalized.driveFileId || normalized.fileName || normalized.localPath || normalized.url;
    map.set(key, { ...(map.get(key) || {}), ...normalized });
  });
  return [...map.values()];
}

function defaultTierList() {
  return {
    rows: DEFAULT_TIER_ROWS.map(row => ({ ...row, gameIds: [] })),
    poolGameIds: [],
  };
}

function cleanTierColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function compareTierPoolGameIds(a, b, games = {}) {
  const ah = Number(games[a]?.hoursPlayed || 0);
  const bh = Number(games[b]?.hoursPlayed || 0);
  const aPlayed = ah > 0;
  const bPlayed = bh > 0;
  if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;
  if (aPlayed && bh !== ah) return bh - ah;
  return String(games[a]?.title || '').localeCompare(String(games[b]?.title || ''), 'ru');
}

function normalizeTierList(raw = {}, games = {}) {
  const gameIds = Object.keys(games || {}).filter(gameId => !isGameHidden(games[gameId]));
  const validGameIds = new Set(gameIds);
  const sourceRows = Array.isArray(raw?.rows) && raw.rows.length
    ? raw.rows
    : defaultTierList().rows;
  const usedGameIds = new Set();

  const rows = sourceRows.map((row, idx) => {
    const fallback = DEFAULT_TIER_ROWS[idx] || {};
    const id = String(row?.id || fallback.id || `tier_${idx + 1}`).trim() || `tier_${idx + 1}`;
    const label = String(row?.label || fallback.label || `T${idx + 1}`).trim().slice(0, 18);
    const color = cleanTierColor(row?.color, fallback.color || TIER_ROW_COLORS[idx % TIER_ROW_COLORS.length]);
    const rowGameIds = [];

    (Array.isArray(row?.gameIds) ? row.gameIds : []).forEach(gameId => {
      const cleanId = String(gameId || '').trim();
      if (!validGameIds.has(cleanId) || usedGameIds.has(cleanId)) return;
      usedGameIds.add(cleanId);
      rowGameIds.push(cleanId);
    });

    return { id, label: label || `T${idx + 1}`, color, gameIds: rowGameIds };
  });

  const poolGameIds = [];
  const poolSource = Array.isArray(raw?.poolGameIds) ? raw.poolGameIds : [];
  poolSource.forEach(gameId => {
    const cleanId = String(gameId || '').trim();
    if (!validGameIds.has(cleanId) || usedGameIds.has(cleanId)) return;
    usedGameIds.add(cleanId);
    poolGameIds.push(cleanId);
  });

  gameIds
    .filter(gameId => !usedGameIds.has(gameId))
    .forEach(gameId => poolGameIds.push(gameId));

  poolGameIds.sort((a, b) => compareTierPoolGameIds(a, b, games));

  return { rows, poolGameIds };
}

function normalizeGame(raw = {}) {
  const game = { ...raw };
  const title = String(game.title || game.name || '').trim();
  if (title) {
    game.title = title;
    game.name = title;
  }
  const coverUrl = String(game.coverUrl || game.img || '').trim();
  if (coverUrl) {
    game.coverUrl = coverUrl;
    game.img = coverUrl;
  }
  if (game.appid != null) game.appid = String(game.appid);
  if (game.steamAppId != null) game.steamAppId = String(game.steamAppId);
  game.achievements = (game.achievements || []).map(normalizeAchievement);
  game.tags ??= [];
  game.sessions ??= [];
  game.screenshots = (game.screenshots || []).map(normalizeScreenshot);
  if (game.hidden) game.hidden = true;
  else delete game.hidden;
  return game;
}

function normalizeStore(raw = {}) {
  const normalized = {
    games: {},
    collections: {},
    settings: {},
    lastBackup: null,
    ...raw,
  };
  normalized.games = Object.fromEntries(
    Object.entries(normalized.games || {}).map(([id, game]) => [id, normalizeGame({ id, ...game })])
  );
  normalized.collections ??= {};
  normalized.settings ??= {};
  normalized.tierList = normalizeTierList(normalized.tierList, normalized.games);
  return normalized;
}

function achievementPercent(ach = {}) {
  const value = Number.parseFloat(String(ach?.globalPercent ?? '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function formatAchievementPercent(value) {
  if (!Number.isFinite(value)) return '';
  if (value >= 10) return String(Math.round(value * 10) / 10).replace(/\.0$/, '');
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function isRareAchievement(ach, threshold = 10) {
  const value = achievementPercent(ach);
  return value !== null && value <= threshold;
}

function achievementRarityText(ach) {
  const value = achievementPercent(ach);
  return value === null ? '' : `${formatAchievementPercent(value)}% игроков`;
}

function sortAchievementsByRarity(a, b) {
  const unlockedDiff = (b.achieved || 0) - (a.achieved || 0);
  if (unlockedDiff) return unlockedDiff;
  const aPct = achievementPercent(a);
  const bPct = achievementPercent(b);
  if (aPct === null && bPct === null) return 0;
  if (aPct === null) return 1;
  if (bPct === null) return -1;
  return aPct - bPct;
}

const HERO_THEME_DEFAULTS = {
  accent: [102, 192, 244],
  accentSoft: [47, 78, 106],
  highlight: [175, 211, 236],
  shadow: [9, 15, 23],
  shadowDeep: [4, 8, 14],
};

let libraryHeroToken = 0;
let slOverviewArtworkObserver = null;
const slOverviewArtworkQueue = [];
let slOverviewArtworkQueueScheduled = false;

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mixRgb(a, b, amount = 0.5) {
  const weight = Math.max(0, Math.min(1, amount));
  return [
    clampChannel(a[0] + (b[0] - a[0]) * weight),
    clampChannel(a[1] + (b[1] - a[1]) * weight),
    clampChannel(a[2] + (b[2] - a[2]) * weight),
  ];
}

function rgbBrightness([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbSaturation([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function brightenRgb(rgb, minBrightness = 90) {
  if (rgbBrightness(rgb) >= minBrightness) return rgb.map(clampChannel);
  const amount = Math.min(0.6, (minBrightness - rgbBrightness(rgb)) / 255);
  return mixRgb(rgb, [255, 255, 255], amount);
}

function darkenRgb(rgb, maxBrightness = 56) {
  if (rgbBrightness(rgb) <= maxBrightness) return rgb.map(clampChannel);
  const amount = Math.min(0.75, (rgbBrightness(rgb) - maxBrightness) / 255);
  return mixRgb(rgb, [6, 10, 18], amount);
}

function colorToCss(rgb) {
  return rgb.map(clampChannel).join(', ');
}

function tameHeroAccent(rgb, average, darkBase) {
  const saturation = rgbSaturation(rgb);
  let next = brightenRgb(rgb, 88);
  if (saturation > 0.68) {
    const soften = Math.min(0.42, 0.16 + ((saturation - 0.68) / 0.32) * 0.26);
    next = mixRgb(next, average, soften);
  }
  if (rgbBrightness(next) > 174) {
    next = mixRgb(next, darkBase, 0.14);
  }
  return next.map(clampChannel);
}

function gameLogoCandidates(game = {}) {
  const appId = String(game.appid || game.steamAppId || '').trim();
  const candidates = [];
  const seen = new Set();
  const push = url => {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl || seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    candidates.push(cleanUrl);
  };

  push(game.logoUrl);
  if (appId) {
    const base = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}`;
    push(`${base}/library_logo.png`);
    push(`${base}/logo.png`);
  }
  return candidates;
}

async function resolveHeroLogo(game) {
  for (const url of gameLogoCandidates(game)) {
    const loaded = await loadRemoteImage({ url, fit: 'contain', position: 'center center', framed: true });
    if (loaded?.width && loaded?.height) return loaded.url;
  }
  return '';
}

function applyHeroTheme(detailEl, palette = HERO_THEME_DEFAULTS) {
  if (!detailEl) return;
  const theme = { ...HERO_THEME_DEFAULTS, ...(palette || {}) };
  detailEl.style.setProperty('--sl-hero-accent', colorToCss(theme.accent));
  detailEl.style.setProperty('--sl-hero-accent-soft', colorToCss(theme.accentSoft));
  detailEl.style.setProperty('--sl-hero-highlight', colorToCss(theme.highlight));
  detailEl.style.setProperty('--sl-hero-shadow', colorToCss(theme.shadow));
  detailEl.style.setProperty('--sl-hero-shadow-deep', colorToCss(theme.shadowDeep));
}

function formatTimelineDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Неизвестная дата';
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSessionDuration(minutes = 0) {
  const totalMinutes = Math.max(0, Number(minutes) || 0);
  return totalMinutes >= 60 ? `${fmtH(totalMinutes / 60)} ч.` : `${Math.round(totalMinutes)} мин.`;
}

function updateLibraryDetailScrollState() {
  const detailEl = document.getElementById('sl-detail');
  if (!detailEl || detailEl.classList.contains('hidden')) return;

  const scrollTop = Math.max(0, detailEl.scrollTop || 0);
  const shift = Math.min(scrollTop, 220);
  const progress = Math.min(1, shift / 220);

  detailEl.style.setProperty('--sl-hero-shift', `${shift}px`);
  detailEl.style.setProperty('--sl-hero-progress', progress.toFixed(3));
  detailEl.classList.toggle('is-scrolled', scrollTop > 18);
  updateAppHeaderCondensedState(scrollTop);
}

function getAppHeaderScrollTop() {
  if (isViewActive('library')) {
    const detailEl = document.getElementById('sl-detail');
    if (detailEl && !detailEl.classList.contains('hidden')) {
      return Math.max(0, detailEl.scrollTop || 0);
    }

    const overviewEl = document.getElementById('sl-overview');
    if (overviewEl && !overviewEl.classList.contains('hidden')) {
      return Math.max(0, overviewEl.scrollTop || 0);
    }
  }

  const contentEl = document.querySelector('.content');
  return Math.max(0, contentEl?.scrollTop || 0);
}

function updateAppHeaderCondensedState(scrollTop = getAppHeaderScrollTop()) {
  const appEl = document.getElementById('app');
  if (!appEl) return;
  const shouldCondense = scrollTop > 40;
  if (appEl.classList.contains('is-header-condensed') !== shouldCondense) {
    appEl.classList.toggle('is-header-condensed', shouldCondense);
  }
}

function syncAppHeaderCondensedState() {
  updateAppHeaderCondensedState();
}

function scheduleAppHeaderCondensedState() {
  if (appHeaderScrollRaf) return;
  appHeaderScrollRaf = requestAnimationFrame(() => {
    appHeaderScrollRaf = 0;
    syncAppHeaderCondensedState();
  });
}

function markElementScrolling(el) {
  if (!el) return;
  el.classList.add('is-scrolling');
  const prevTimer = scrollIdleTimers.get(el);
  if (prevTimer) clearTimeout(prevTimer);
  const timer = setTimeout(() => {
    el.classList.remove('is-scrolling');
    scrollIdleTimers.delete(el);
  }, SCROLL_IDLE_DELAY_MS);
  scrollIdleTimers.set(el, timer);
}

function bindScrollPerformanceHints(el) {
  if (!el) return;
  el.addEventListener('wheel', () => markElementScrolling(el), { passive: true });
  el.addEventListener('touchstart', () => markElementScrolling(el), { passive: true });
  el.addEventListener('keydown', event => {
    if (LIBRARY_SCROLL_KEYS.has(event.key)) markElementScrolling(el);
  });
}

function handleLibraryOverviewScroll(event) {
  markElementScrolling(event.currentTarget);
  scheduleAppHeaderCondensedState();
}

function handleLibraryDetailScroll(event) {
  markElementScrolling(event.currentTarget);
  if (libraryDetailScrollRaf) return;
  libraryDetailScrollRaf = requestAnimationFrame(() => {
    libraryDetailScrollRaf = 0;
    updateLibraryDetailScrollState();
  });
}

function handleSLGameListScroll(event) {
  markElementScrolling(event.currentTarget);
  if (slGameListScrollRaf) return;
  slGameListScrollRaf = requestAnimationFrame(() => {
    slGameListScrollRaf = 0;
    renderSLGameListWindow();
  });
}

function librarySidebarCanCollapse() {
  return window.innerWidth > 640;
}

function getStoredLibrarySidebarCollapsed() {
  try {
    const value = window.localStorage?.getItem(LIBRARY_SIDEBAR_STORAGE_KEY);
    if (value === 'true') return true;
    if (value === 'false') return false;
  } catch {}

  return typeof store?.settings?.librarySidebarCollapsed === 'boolean'
    ? store.settings.librarySidebarCollapsed
    : null;
}

function getPreferredLibrarySidebarCollapsed() {
  const stored = getStoredLibrarySidebarCollapsed();
  if (stored !== null) return stored;
  return window.innerWidth <= LIBRARY_SIDEBAR_AUTO_COLLAPSE_WIDTH;
}

function applyLibrarySidebarState() {
  const layoutEl = document.getElementById('view-library');
  const leftEl = document.getElementById('sl-left');
  const toggleBtn = document.getElementById('sl-left-toggle');
  const toggleLabel = toggleBtn?.querySelector('.sl-left-toggle-label');
  if (!layoutEl || !leftEl || !toggleBtn) return;

  const canCollapse = librarySidebarCanCollapse();
  const isCollapsed = canCollapse ? librarySidebarCollapsed : false;

  layoutEl.classList.toggle('is-panel-collapsed', isCollapsed);
  toggleBtn.classList.toggle('hidden', !canCollapse);
  toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
  toggleBtn.setAttribute('aria-label', isCollapsed ? 'Выдвинуть библиотеку' : 'Свернуть библиотеку');
  toggleBtn.title = isCollapsed ? 'Выдвинуть библиотеку' : 'Свернуть библиотеку';
  leftEl.setAttribute('aria-hidden', String(canCollapse && isCollapsed));
  if (toggleLabel) {
    toggleLabel.textContent = isCollapsed ? 'Библиотека' : 'Скрыть';
  }
}

function applyPerformanceMode() {
  const settings = store?.settings || {};
  const enabled = settings.performanceMode !== 'full';
  document.body.classList.toggle('perf-lite', enabled);
}

function initializeLibrarySidebarState() {
  librarySidebarCollapsed = getPreferredLibrarySidebarCollapsed();
  applyLibrarySidebarState();
}

function persistLibrarySidebarCollapsed() {
  store.settings ??= {};
  store.settings.librarySidebarCollapsed = librarySidebarCollapsed;
  try {
    window.localStorage?.setItem(LIBRARY_SIDEBAR_STORAGE_KEY, String(librarySidebarCollapsed));
  } catch {}
}

function setLibrarySidebarCollapsed(collapsed, { persist = true } = {}) {
  librarySidebarCollapsed = librarySidebarCanCollapse() ? Boolean(collapsed) : false;
  applyLibrarySidebarState();
  requestAnimationFrame(syncAppHeaderCondensedState);

  if (!persist || !librarySidebarCanCollapse()) return;
  persistLibrarySidebarCollapsed();
}

function syncLibrarySidebarToViewport() {
  if (!librarySidebarCanCollapse()) {
    applyLibrarySidebarState();
    requestAnimationFrame(syncAppHeaderCondensedState);
    return;
  }

  librarySidebarCollapsed = getPreferredLibrarySidebarCollapsed();
  applyLibrarySidebarState();
  requestAnimationFrame(syncAppHeaderCondensedState);
}

function heroArtworkCandidates(game = {}) {
  const appId = String(game.appid || game.steamAppId || '').trim();
  const candidates = [];
  const seen = new Set();
  const push = (url, kind, options = {}) => {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl || seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    candidates.push({
      url: cleanUrl,
      kind,
      fit: options.fit || 'cover',
      position: options.position || 'center center',
      framed: Boolean(options.framed),
    });
  };

  if (game.heroUrl) {
    push(game.heroUrl, 'custom-hero', { fit: 'cover', position: 'center center' });
  }

  if (appId) {
    const base = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}`;
    push(`${base}/library_hero.jpg`, 'hero', { fit: 'cover', position: 'center top' });
    push(`${base}/capsule_616x353.jpg`, 'capsule', { fit: 'contain', position: 'center center', framed: true });
    push(`${base}/header.jpg`, 'header', { fit: 'contain', position: 'center center', framed: true });
    push(`${base}/page_bg_generated_v6b.jpg`, 'page', { fit: 'cover', position: 'center top' });
  }

  if (game.coverUrl) {
    const framed = /(?:\/|^)header\.jpg(?:$|\?)/i.test(game.coverUrl);
    push(game.coverUrl, 'cover', {
      fit: framed ? 'contain' : 'cover',
      position: 'center center',
      framed,
    });
  }

  return candidates;
}

function loadRemoteImage(candidate) {
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({
      ...candidate,
      img,
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0,
    });
    img.onerror = () => resolve(null);
    img.src = candidate.url;
  });
}

function loadPaletteImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function resolveHeroArtwork(game) {
  for (const candidate of heroArtworkCandidates(game)) {
    const loaded = await loadRemoteImage(candidate);
    if (!loaded?.width || !loaded?.height) continue;
    if ((loaded.kind === 'cover' || loaded.kind === 'capsule') && loaded.width / loaded.height < 2.25) {
      loaded.fit = 'contain';
      loaded.position = 'center center';
      loaded.framed = true;
    }
    return loaded;
  }
  return null;
}

function extractHeroPalette(image) {
  try {
    const canvas = document.createElement('canvas');
    const size = 36;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(image, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const totals = [0, 0, 0];
    const vibrant = [0, 0, 0];
    const dark = [0, 0, 0];
    const light = [0, 0, 0];
    let totalWeight = 0;
    let vibrantWeight = 0;
    let darkWeight = 0;
    let lightWeight = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha < 0.35) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const brightness = rgbBrightness([r, g, b]);
      const weight = alpha * (0.65 + saturation * 1.8);

      totals[0] += r * weight;
      totals[1] += g * weight;
      totals[2] += b * weight;
      totalWeight += weight;

      if (saturation > 0.18 && brightness > 34 && brightness < 220) {
        const vividWeight = weight * (1 + saturation * 1.8);
        vibrant[0] += r * vividWeight;
        vibrant[1] += g * vividWeight;
        vibrant[2] += b * vividWeight;
        vibrantWeight += vividWeight;
      }

      if (brightness < 128) {
        const darkSampleWeight = weight * (1.1 + (128 - brightness) / 128);
        dark[0] += r * darkSampleWeight;
        dark[1] += g * darkSampleWeight;
        dark[2] += b * darkSampleWeight;
        darkWeight += darkSampleWeight;
      }

      if (brightness > 110) {
        const lightSampleWeight = weight * (brightness / 255);
        light[0] += r * lightSampleWeight;
        light[1] += g * lightSampleWeight;
        light[2] += b * lightSampleWeight;
        lightWeight += lightSampleWeight;
      }
    }

    if (!totalWeight) return null;

    const avg = totals.map(value => clampChannel(value / totalWeight));
    const accentBase = vibrantWeight
      ? vibrant.map(value => clampChannel(value / vibrantWeight))
      : avg;
    const darkBase = darkWeight
      ? dark.map(value => clampChannel(value / darkWeight))
      : mixRgb(avg, [8, 12, 20], 0.55);
    const lightBase = lightWeight
      ? light.map(value => clampChannel(value / lightWeight))
      : mixRgb(avg, [255, 255, 255], 0.22);

    const accent = tameHeroAccent(mixRgb(accentBase, lightBase, 0.08), avg, darkBase);
    return {
      accent,
      accentSoft: brightenRgb(mixRgb(accent, darkBase, 0.44), 62),
      highlight: brightenRgb(mixRgb(lightBase, accent, 0.24), 126),
      shadow: darkenRgb(mixRgb(darkBase, [8, 12, 20], 0.58), 46),
      shadowDeep: darkenRgb(mixRgb(darkBase, [3, 6, 12], 0.76), 30),
    };
  } catch {
    return null;
  }
}

async function updateLibraryHero(game) {
  const detailEl = document.getElementById('sl-detail');
  const heroBg = document.getElementById('sl-hero-bg');
  const heroBackdrop = document.getElementById('sl-hero-backdrop');
  const heroImg = document.getElementById('sl-hero-img');
  const heroLogo = document.getElementById('sl-game-logo');
  const heroTitle = document.getElementById('sl-game-title');
  if (!detailEl || !heroBg || !heroImg || !heroBackdrop || !heroLogo || !heroTitle) return;

  const token = ++libraryHeroToken;
  applyHeroTheme(detailEl);
  heroBg.classList.remove('is-ready', 'is-framed', 'is-empty');
  heroBg.classList.add('is-loading');
  heroBackdrop.removeAttribute('src');
  heroBackdrop.alt = '';
  heroImg.removeAttribute('src');
  heroImg.alt = '';
  heroImg.style.objectFit = 'cover';
  heroImg.style.objectPosition = 'center top';
  heroLogo.removeAttribute('src');
  heroLogo.classList.add('hidden');
  heroTitle.classList.remove('is-logo-hidden');

  resolveHeroLogo(game).then(logoSrc => {
    if (token !== libraryHeroToken || selectedLibGameId !== game.id || !logoSrc) return;
    heroLogo.src = logoSrc;
    heroLogo.alt = game.title || '';
    heroLogo.classList.remove('hidden');
    heroTitle.classList.add('is-logo-hidden');
  });

  const artwork = await resolveHeroArtwork(game);
  if (token !== libraryHeroToken || selectedLibGameId !== game.id) return;

  if (!artwork) {
    heroBg.classList.remove('is-loading');
    heroBg.classList.add('is-empty');
    return;
  }

  heroBg.classList.toggle('is-framed', !!artwork.framed);
  heroBackdrop.src = artwork.url;
  heroImg.style.objectFit = artwork.fit || 'cover';
  heroImg.style.objectPosition = artwork.position || 'center center';
  heroImg.alt = game.title || '';

  heroImg.onload = () => {
    if (token !== libraryHeroToken || selectedLibGameId !== game.id) return;
    heroBg.classList.remove('is-loading');
    heroBg.classList.add('is-ready');
  };
  heroImg.onerror = () => {
    if (token !== libraryHeroToken || selectedLibGameId !== game.id) return;
    heroBg.classList.remove('is-loading');
    heroBg.classList.remove('is-ready');
    heroBg.classList.add('is-empty');
  };
  heroImg.src = artwork.url;
  if (heroImg.complete) {
    heroBg.classList.remove('is-loading');
    heroBg.classList.add('is-ready');
  }

  loadPaletteImage(artwork.url).then(paletteImg => {
    if (token !== libraryHeroToken || selectedLibGameId !== game.id || !paletteImg) return;
    const palette = extractHeroPalette(paletteImg);
    if (palette) applyHeroTheme(detailEl, palette);
  });
}

function getLatestUnlockedAchievements(game, limit = 4) {
  return [...(game.achievements || [])]
    .filter(achievement => achievement.achieved && Number(achievement.unlocktime) > 0)
    .sort((a, b) => (Number(b.unlocktime) || 0) - (Number(a.unlocktime) || 0))
    .slice(0, limit);
}

function renderSLHeroRecentAchievements(game) {
  const wrap = document.getElementById('sl-hero-recent-wrap');
  const list = document.getElementById('sl-hero-recent-list');
  if (!wrap || !list) return;

  wrap.classList.add('hidden');
  list.innerHTML = '';
  return;

  const latest = getLatestUnlockedAchievements(game, 4);
  if (!latest.length) {
    wrap.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  wrap.classList.remove('hidden');
  list.innerHTML = latest.map(achievement => {
    const name = esc(safeAchName(achievement.displayName, achievement.apiname));
    const icon = esc(achievement.icon || achievement.iconGray || '');
    const percentText = achievementRarityText(achievement);
    return `<button class="sl-hero-ach" type="button" title="${name}">
      ${icon ? `<img class="sl-hero-ach-icon" src="${icon}" alt=""/>` : '<span class="sl-hero-ach-icon ph">🏆</span>'}
      <span class="sl-hero-ach-copy">
        <span class="sl-hero-ach-name">${name}</span>
        <span class="sl-hero-ach-meta">${esc(percentText || 'Открыто недавно')}</span>
      </span>
    </button>`;
  }).join('');
}

function renderSLMiniHeader(game) {
  const cover = gamePoster(game) || gameCover(game);
  const coverEl = document.getElementById('sl-mini-cover');
  const coverPh = document.getElementById('sl-mini-cover-ph');
  const titleEl = document.getElementById('sl-mini-title');
  const subEl = document.getElementById('sl-mini-sub');
  if (!coverEl || !coverPh || !titleEl || !subEl) return;

  titleEl.textContent = game.title || 'Игра';
  const total = game.achievementsTotal || 0;
  const unlocked = game.achievementsUnlocked || 0;
  const statusText = STATUS_LABELS[game.status] ? STATUS_LABELS[game.status].replace(/^[^\s]+\s*/, '') : '';
  const bits = [];
  if (total) bits.push(`${unlocked}/${total} достижений`);
  if (statusText) bits.push(statusText);
  if (!bits.length) bits.push(`${fmtH(game.hoursPlayed || 0)} ч. в библиотеке`);
  subEl.textContent = bits.join(' • ');

  coverEl.onload = () => {
    coverEl.classList.remove('hidden');
    coverPh.classList.add('hidden');
  };
  coverEl.onerror = () => {
    coverEl.classList.add('hidden');
    coverPh.classList.remove('hidden');
  };
  if (cover) {
    coverEl.src = cover;
    if (coverEl.complete) {
      coverEl.classList.remove('hidden');
      coverPh.classList.add('hidden');
    }
  } else {
    coverEl.removeAttribute('src');
    coverEl.classList.add('hidden');
    coverPh.classList.remove('hidden');
  }
}

function formatTimelineDayHeading(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Неизвестный день';
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function renderSLNotesMeta(game) {
  const metaEl = document.getElementById('sl-notes-meta');
  if (!metaEl) return;
  const noteText = String(game.notes || '').trim();
  if (!noteText) {
    metaEl.textContent = 'Заметок пока нет';
    return;
  }

  const pieces = [`${noteText.length} символов`];
  if (game.notesUpdatedAt) {
    pieces.push(`обновлено ${new Date(game.notesUpdatedAt).toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })}`);
  }
  metaEl.textContent = pieces.join(' • ');
}

function buildGameTimelineEvents(game) {
  const sessions = (game.sessions || [])
    .map(session => ({
      type: 'session',
      time: new Date(session.date).getTime(),
      minutes: Number(session.minutes) || 0,
    }))
    .filter(event => Number.isFinite(event.time) && event.time > 0);

  const achievements = (game.achievements || [])
    .filter(achievement => achievement.achieved && Number(achievement.unlocktime) > 0)
    .map(achievement => ({
      type: 'achievement',
      time: Number(achievement.unlocktime) * 1000,
      achievement,
    }));

  const syncEvents = [];
  const syncSource = syncSourceName(game);
  if (game.syncedAt) {
    const syncedTime = new Date(game.syncedAt).getTime();
    if (Number.isFinite(syncedTime) && syncedTime > 0) {
      syncEvents.push({ type: 'sync', time: syncedTime, label: `Синхронизировано с ${syncSource}`, badge: syncSource });
    }
  } else if (game.importedAt) {
    const importedTime = new Date(game.importedAt).getTime();
    if (Number.isFinite(importedTime) && importedTime > 0) {
      syncEvents.push({ type: 'sync', time: importedTime, label: 'Игра добавлена в библиотеку', badge: 'Библиотека' });
    }
  }

  const launchEvents = [];
  if (game.lastPlayedAt) {
    const launchTime = new Date(game.lastPlayedAt).getTime();
    const hasCloseSession = sessions.some(session => Math.abs(session.time - launchTime) < 10 * 60 * 1000);
    if (Number.isFinite(launchTime) && launchTime > 0 && !hasCloseSession) {
      launchEvents.push({ type: 'launch', time: launchTime });
    }
  }

  return [...achievements, ...sessions, ...launchEvents, ...syncEvents]
    .filter(event => Number.isFinite(event.time) && event.time > 0)
    .sort((a, b) => b.time - a.time)
    .slice(0, 18);
}

function renderTimelineEvent(event) {
  if (event.type === 'achievement') {
    const achievement = event.achievement;
    const name = esc(safeAchName(achievement.displayName, achievement.apiname));
    const icon = achievement.icon || achievement.iconGray || '';
    const metaParts = [formatTimelineDate(event.time)];
    if (isRareAchievement(achievement)) metaParts.push('Редкое');
    const rarityText = achievementRarityText(achievement);
    if (rarityText) metaParts.push(rarityText);
    return `<div class="sl-session-item achievement">
      <div class="sl-session-icon">
        ${icon ? `<img src="${esc(icon)}" alt=""/>` : '🏆'}
      </div>
      <div class="sl-session-main">
        <div class="sl-session-title">${name}</div>
        <div class="sl-session-meta">${metaParts.map(part => `<span>${esc(part)}</span>`).join('')}</div>
      </div>
      <div class="sl-session-side">
        <span class="sl-session-badge achievement">Получено</span>
      </div>
    </div>`;
  }

  if (event.type === 'sync') {
    return `<div class="sl-session-item sync">
      <div class="sl-session-icon">↻</div>
      <div class="sl-session-main">
        <div class="sl-session-title">${esc(event.label || 'Синхронизация')}</div>
        <div class="sl-session-meta">
          <span>${esc(formatTimelineDate(event.time))}</span>
          <span>Данные библиотеки обновлены</span>
        </div>
      </div>
      <div class="sl-session-side">
        <span class="sl-session-badge sync">${esc(event.badge || 'Sync')}</span>
      </div>
    </div>`;
  }

  if (event.type === 'launch') {
    return `<div class="sl-session-item launch">
      <div class="sl-session-icon">▶</div>
      <div class="sl-session-main">
        <div class="sl-session-title">Запуск игры</div>
        <div class="sl-session-meta">
          <span>${esc(formatTimelineDate(event.time))}</span>
          <span>Старт новой игровой сессии</span>
        </div>
      </div>
      <div class="sl-session-side">
        <span class="sl-session-badge launch">Запуск</span>
      </div>
    </div>`;
  }

  const duration = formatSessionDuration(event.minutes);
  return `<div class="sl-session-item session">
    <div class="sl-session-icon">⏱</div>
    <div class="sl-session-main">
      <div class="sl-session-title">Игровая сессия</div>
      <div class="sl-session-meta">
        <span class="sl-session-date">${esc(formatTimelineDate(event.time))}</span>
        <span class="sl-session-dur">${esc(duration)}</span>
      </div>
    </div>
    <div class="sl-session-side">
      <span class="sl-session-badge">${esc(duration)}</span>
    </div>
  </div>`;
}

function renderGameActivityTimeline(game) {
  const events = buildGameTimelineEvents(game);
  if (!events.length) {
    return '<div class="sl-no-sessions">Пока нет ни сессий, ни полученных достижений</div>';
  }

  const groups = new Map();
  events.forEach(event => {
    const key = new Date(event.time).toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });

  return [...groups.entries()].map(([key, dayEvents]) => `
    <section class="sl-timeline-group">
      <div class="sl-timeline-day">${esc(formatTimelineDayHeading(key))}</div>
      <div class="sl-timeline-events">
        ${dayEvents.map(renderTimelineEvent).join('')}
      </div>
    </section>
  `).join('');
}

// ── Запуск ────────────────────────────────────────────────
(async () => {
  store = normalizeStore(await api.loadData());
  // Если пользователь включил скрытие шуток/незначительных названий — удаляем их на этапе загрузки
  if (store?.settings?.hideJokes) {
    store = removeJokeGamesFromStore(store);
  }
  applyTheme(store.settings.theme || 'steam');
  applyDensity(store.settings.density || 'normal');
  applyPerformanceMode();
  initializeLibrarySidebarState();
  renderAll();
  driveInit();
  syncSteamOnLaunch();
  syncEaOnLaunch();
})();

async function save() {
  if (saveInFlight) {
    saveQueued = true;
    return saveInFlight;
  }

  store = normalizeStore(store);
  let result;
  try {
    saveInFlight = api.saveData(store);
    result = await saveInFlight;
  } catch (err) {
    result = { ok: false, error: err?.message || String(err) };
  } finally {
    saveInFlight = null;
  }
  if (!result?.ok) toast('Ошибка сохранения данных: ' + (result?.error || 'неизвестно'), 'err');
  // Авто-синхронизация с Drive
  if (result?.ok && driveConnected && store.settings.drive?.autoSync) {
    api.driveUploadData(store).then(r => {
      if (r?.ok) { store.settings.drive.lastSync = r.time; renderDriveSettings(); }
    });
  }

  if (saveQueued) {
    saveQueued = false;
    return save();
  }

  return result;
}

function renderAll() {
  updateSidebarStats();
  renderSidebarCollections();
  renderDashboard();
  renderLibrary();
  if (isViewActive('achievements')) renderAchievements();
  if (isViewActive('stats'))        renderStats();
  if (isViewActive('tier-list'))    renderTierList();
  if (isViewActive('game-detail') && openedGameId) openGamePage(openedGameId);
  syncAppHeaderCondensedState();
}

function isViewActive(name) {
  return document.getElementById(`view-${name}`)?.classList.contains('active');
}

function statusDisplayText(value) {
  if (!value) return 'Без статуса';
  return (STATUS_LABELS[value] || String(value)).replace(/^[^\s]+\s*/, '');
}

function statusAccentColor(value) {
  if (value === 'playing') return '#60a5fa';
  if (value === 'completed') return '#4ade80';
  if (value === 'dropped') return '#fb7185';
  if (value === 'planned') return '#fbbf24';
  return '#94a3b8';
}

function ensureGameStatusMenu() {
  let menu = document.getElementById('game-status-menu');
  if (menu) return menu;

  menu = document.createElement('div');
  menu.id = 'game-status-menu';
  menu.className = 'game-status-menu hidden';
  menu.innerHTML = `
    <div class="game-status-menu-title">Статус игры</div>
    ${STATUS_CONTEXT_OPTIONS.map(option => `
      <button class="game-status-menu-btn" type="button" data-status-value="${esc(option.value)}" style="--status-color:${statusAccentColor(option.value)}">
        <span class="game-status-dot"></span>
        <span>${esc(option.label)}</span>
      </button>`).join('')}
  `;
  menu.addEventListener('click', e => {
    const btn = e.target.closest('[data-status-value]');
    if (!btn) return;
    setGameStatusFromContext(btn.dataset.statusValue);
  });
  document.body.appendChild(menu);
  return menu;
}

function openGameStatusMenu(event, gameId) {
  const game = store.games?.[gameId];
  if (!game) return;
  event.preventDefault();
  event.stopPropagation();

  const menu = ensureGameStatusMenu();
  statusContextGameId = gameId;
  menu.querySelectorAll('[data-status-value]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.statusValue === (game.status || ''));
  });

  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const pad = 10;
  const left = Math.min(Math.max(pad, event.clientX), window.innerWidth - rect.width - pad);
  const top = Math.min(Math.max(pad, event.clientY), window.innerHeight - rect.height - pad);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeGameStatusMenu() {
  const menu = document.getElementById('game-status-menu');
  if (menu) menu.classList.add('hidden');
  statusContextGameId = null;
}

async function setGameStatusFromContext(value) {
  const gameId = statusContextGameId;
  const game = store.games?.[gameId];
  if (!game) return closeGameStatusMenu();

  const nextStatus = value || null;
  game.status = nextStatus;
  await save();
  closeGameStatusMenu();
  renderAll();
  toast(`Статус: ${statusDisplayText(nextStatus)}`, 'ok');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.game-status-menu')) closeGameStatusMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeGameStatusMenu();
});
window.addEventListener('resize', closeGameStatusMenu);

// ══════════ УПРАВЛЕНИЕ ОКНОМ ══════════════════════════════
document.getElementById('btn-minimize').addEventListener('click', () => api.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => api.maximize());
document.getElementById('btn-close').addEventListener('click',    () => api.close());

// ══════════ НАВИГАЦИЯ ═════════════════════════════════════
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    closeModal('modal-sl-settings');
    item.classList.add('active');
    document.getElementById(`view-${item.dataset.view}`)?.classList.add('active');
    document.getElementById('app').dataset.view = item.dataset.view;
    if (item.dataset.view === 'library') {
      selectedLibGameId = null;
      renderLibrary();
    }
    if (item.dataset.view === 'tier-list') renderTierList();
    if (item.dataset.view === 'achievements') renderAchievements();
    if (item.dataset.view === 'stats')        renderStats();
    if (item.dataset.view === 'settings')     renderSettingsView();
    requestAnimationFrame(syncAppHeaderCondensedState);
  });
});

// ══════════ TIER LIST ═══════════════════════════════════════
function ensureTierListState() {
  store.tierList = normalizeTierList(store.tierList, store.games);
  return store.tierList;
}

function getGameTierInfo(gameId) {
  const rows = Array.isArray(store.tierList?.rows) ? store.tierList.rows : [];
  for (const row of rows) {
    if (!Array.isArray(row.gameIds) || !row.gameIds.includes(gameId)) continue;
    const label = String(row.label || row.id || 'Tier').trim() || 'Tier';
    return {
      label,
      shortLabel: label.length > 3 ? label.slice(0, 3).toUpperCase() : label,
      color: cleanTierColor(row.color, '#60a5fa'),
    };
  }
  return null;
}

function renderTierGameTile(gameId) {
  const game = store.games[gameId];
  if (!game) return '';
  const cover = gamePoster(game) || gameCover(game);
  const title = game.title || 'Игра';
  const initial = String(title).trim().slice(0, 1).toUpperCase() || 'G';

  const selectedClass = tierSelectedGameId === gameId ? ' selected' : '';

  return `<div class="tier-game${selectedClass}" role="button" tabindex="0" draggable="false" data-game-id="${esc(gameId)}" title="${esc(title)}" aria-label="${esc(title)}">
    <div class="tier-game-art${cover ? '' : ' no-cover'}">
      ${cover
        ? `<img src="${esc(cover)}" alt="" draggable="false" loading="lazy" decoding="async" onerror="this.remove();this.parentElement.classList.add('no-cover')" />`
        : `<span>${esc(initial)}</span>`}
    </div>
    <div class="tier-game-controls">
      <button class="tier-game-move" type="button" data-tier-game-action="left" data-game-id="${esc(gameId)}" title="Левее">‹</button>
      <button class="tier-game-move" type="button" data-tier-game-action="right" data-game-id="${esc(gameId)}" title="Правее">›</button>
    </div>
  </div>`;
}

function renderTierRow(row, idx, totalRows) {
  const gamesHtml = row.gameIds.map(renderTierGameTile).join('');
  const emptyHtml = `<div class="tier-empty">Пусто</div>`;
  return `<div class="tier-row" data-tier-row-id="${esc(row.id)}" style="--tier-color:${esc(row.color)}">
    <div class="tier-row-label">
      <input class="tier-color-input" type="color" value="${esc(row.color)}" data-tier-color-id="${esc(row.id)}" title="Цвет" />
      <input class="tier-label-input" type="text" value="${esc(row.label)}" maxlength="18" data-tier-label-id="${esc(row.id)}" aria-label="Название тира" />
      <div class="tier-row-actions">
        <button class="tier-row-action" type="button" data-tier-action="up" data-tier-row-id="${esc(row.id)}" ${idx === 0 ? 'disabled' : ''} title="Выше">↑</button>
        <button class="tier-row-action" type="button" data-tier-action="down" data-tier-row-id="${esc(row.id)}" ${idx === totalRows - 1 ? 'disabled' : ''} title="Ниже">↓</button>
        <button class="tier-row-action danger" type="button" data-tier-action="delete" data-tier-row-id="${esc(row.id)}" title="Удалить">×</button>
      </div>
    </div>
    <div class="tier-row-drop tier-dropzone" data-tier-id="${esc(row.id)}">
      ${gamesHtml || emptyHtml}
    </div>
  </div>`;
}

function renderTierList() {
  const boardEl = document.getElementById('tier-board');
  const poolEl = document.getElementById('tier-pool');
  if (!boardEl || !poolEl) return;

  const tierList = ensureTierListState();
  const games = gamesList();
  if (tierSelectedGameId && (!store.games[tierSelectedGameId] || isGameHidden(store.games[tierSelectedGameId]))) {
    tierSelectedGameId = '';
  }
  const rankedCount = tierList.rows.reduce((sum, row) => sum + row.gameIds.length, 0);
  const query = tierSearchQuery.trim().toLowerCase();
  const poolIds = tierList.poolGameIds
    .filter(gameId => !query || String(store.games[gameId]?.title || '').toLowerCase().includes(query));

  boardEl.innerHTML = tierList.rows.map((row, idx) => renderTierRow(row, idx, tierList.rows.length)).join('');
  poolEl.innerHTML = poolIds.length
    ? poolIds.map(renderTierGameTile).join('')
    : `<div class="tier-empty tier-empty-pool">${query ? 'Ничего не найдено' : 'Все игры в тирах'}</div>`;

  document.getElementById('tier-ranked-count').textContent = String(rankedCount);
  document.getElementById('tier-pool-count').textContent = String(tierList.poolGameIds.length);
  document.getElementById('tier-library-count').textContent = `${games.length} игр`;

  const searchEl = document.getElementById('tier-search');
  if (searchEl && searchEl.value !== tierSearchQuery) searchEl.value = tierSearchQuery;
}

function removeTierGameFromEverywhere(tierList, gameId) {
  tierList.rows.forEach(row => {
    row.gameIds = row.gameIds.filter(id => id !== gameId);
  });
  tierList.poolGameIds = tierList.poolGameIds.filter(id => id !== gameId);
}

function findTierGameLocation(gameId) {
  const tierList = ensureTierListState();
  const poolIndex = tierList.poolGameIds.indexOf(gameId);
  if (poolIndex >= 0) return { list: tierList.poolGameIds, tierId: 'pool', index: poolIndex, row: null };

  for (const row of tierList.rows) {
    const index = row.gameIds.indexOf(gameId);
    if (index >= 0) return { list: row.gameIds, tierId: row.id, index, row };
  }
  return null;
}

async function moveTierGame(gameId, targetTierId, beforeGameId = '') {
  if (!store.games[gameId] || isGameHidden(store.games[gameId])) return false;
  const tierList = ensureTierListState();
  if (targetTierId !== 'pool' && !tierList.rows.some(row => row.id === targetTierId)) return false;

  removeTierGameFromEverywhere(tierList, gameId);
  const targetList = targetTierId === 'pool'
    ? tierList.poolGameIds
    : tierList.rows.find(row => row.id === targetTierId)?.gameIds;
  if (!targetList) return false;

  const insertIdx = beforeGameId && beforeGameId !== gameId ? targetList.indexOf(beforeGameId) : -1;
  if (insertIdx >= 0) targetList.splice(insertIdx, 0, gameId);
  else targetList.push(gameId);

  await save();
  renderTierList();
  return true;
}

async function nudgeTierGame(gameId, direction) {
  const location = findTierGameLocation(gameId);
  if (!location || location.tierId === 'pool') return false;

  const nextIndex = location.index + direction;
  if (nextIndex < 0 || nextIndex >= location.list.length) return false;
  [location.list[location.index], location.list[nextIndex]] = [location.list[nextIndex], location.list[location.index]];
  tierSelectedGameId = gameId;
  await save();
  renderTierList();
  return true;
}

function selectTierGame(gameId) {
  tierSelectedGameId = tierSelectedGameId === gameId ? '' : gameId;
  document.querySelectorAll('.tier-game.selected').forEach(tile => tile.classList.remove('selected'));
  if (tierSelectedGameId) {
    document.querySelectorAll(`.tier-game[data-game-id="${CSS.escape(tierSelectedGameId)}"]`).forEach(tile => {
      tile.classList.add('selected');
    });
  }
}

async function placeSelectedTierGame(targetTierId, beforeGameId = '') {
  if (!tierSelectedGameId || !targetTierId) return false;
  const gameId = tierSelectedGameId;
  const moved = await moveTierGame(gameId, targetTierId, beforeGameId);
  if (moved) {
    tierSelectedGameId = '';
    renderTierList();
  }
  return moved;
}

function clearTierDragState() {
  document.querySelectorAll('.tier-dropzone.drag-over').forEach(zone => zone.classList.remove('drag-over'));
  document.querySelectorAll('.tier-game.dragging').forEach(tile => tile.classList.remove('dragging'));
  clearTierInsertMarker();
}

function ensureTierInsertMarker() {
  if (!tierInsertMarker) {
    tierInsertMarker = document.createElement('div');
    tierInsertMarker.className = 'tier-insert-marker';
  }
  return tierInsertMarker;
}

function clearTierInsertMarker() {
  tierInsertMarker?.remove();
}

function getTierScrollParent() {
  return document.querySelector('.content');
}

function stopTierAutoScroll() {
  if (tierAutoScrollFrame) cancelAnimationFrame(tierAutoScrollFrame);
  tierAutoScrollFrame = 0;
}

function updateTierDragGhost(clientX, clientY) {
  if (!tierPointerDrag?.ghost) return;
  tierPointerDrag.ghost.style.left = `${clientX - tierPointerDrag.offsetX}px`;
  tierPointerDrag.ghost.style.top = `${clientY - tierPointerDrag.offsetY}px`;
}

function getTierDropZoneAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  return el?.closest?.('.tier-dropzone') || null;
}

function getTierInsertBeforeIdAt(clientX, clientY, zone, draggedGameId) {
  const tiles = [...zone.querySelectorAll('.tier-game:not(.dragging)')];
  for (const tile of tiles) {
    if (tile.dataset.gameId === draggedGameId) continue;
    const rect = tile.getBoundingClientRect();
    if (clientY <= rect.bottom && clientX < rect.left + rect.width / 2) return tile.dataset.gameId || '';
  }
  return '';
}

function updateTierInsertMarker(zone, beforeGameId = '') {
  clearTierInsertMarker();
  if (!zone) return;
  const marker = ensureTierInsertMarker();
  if (beforeGameId) {
    const beforeTile = zone.querySelector(`.tier-game[data-game-id="${CSS.escape(beforeGameId)}"]`);
    if (beforeTile) {
      beforeTile.before(marker);
      return;
    }
  }

  const empty = zone.querySelector('.tier-empty');
  if (empty) empty.before(marker);
  else zone.appendChild(marker);
}

function updateTierDropTarget(clientX, clientY) {
  const zone = getTierDropZoneAt(clientX, clientY);
  document.querySelectorAll('.tier-dropzone.drag-over').forEach(item => {
    if (item !== zone) item.classList.remove('drag-over');
  });

  if (!tierPointerDrag) return;
  if (!zone) {
    tierPointerDrag.targetTierId = '';
    tierPointerDrag.beforeGameId = '';
    clearTierInsertMarker();
    return;
  }

  zone.classList.add('drag-over');
  tierPointerDrag.targetTierId = zone.dataset.tierId || '';
  tierPointerDrag.beforeGameId = getTierInsertBeforeIdAt(clientX, clientY, zone, tierPointerDrag.gameId);
  updateTierInsertMarker(zone, tierPointerDrag.beforeGameId);
}

function runTierAutoScroll() {
  if (!tierPointerDrag) {
    stopTierAutoScroll();
    return;
  }

  const parent = getTierScrollParent();
  const speed = tierPointerDrag.scrollSpeed || 0;
  if (parent && speed) {
    parent.scrollBy({ top: speed, behavior: 'auto' });
    updateTierDropTarget(tierPointerDrag.clientX, tierPointerDrag.clientY);
  }
  tierAutoScrollFrame = requestAnimationFrame(runTierAutoScroll);
}

function updateTierAutoScroll(clientY) {
  const parent = getTierScrollParent();
  if (!parent || !tierPointerDrag) return;

  const rect = parent.getBoundingClientRect();
  const edge = 96;
  let speed = 0;
  if (clientY < rect.top + edge) {
    speed = -Math.ceil((1 - Math.max(0, clientY - rect.top) / edge) * 24);
  } else if (clientY > rect.bottom - edge) {
    speed = Math.ceil((1 - Math.max(0, rect.bottom - clientY) / edge) * 24);
  }

  tierPointerDrag.scrollSpeed = speed;
  if (speed && !tierAutoScrollFrame) tierAutoScrollFrame = requestAnimationFrame(runTierAutoScroll);
  if (!speed) stopTierAutoScroll();
}

function beginTierTileDrag(tile, clientX, clientY) {
  if (tierPointerDrag) return false;
  const gameId = tile?.dataset?.gameId || '';
  if (!gameId) return;

  const rect = tile.getBoundingClientRect();
  const ghost = tile.cloneNode(true);
  ghost.classList.add('tier-drag-ghost');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.appendChild(ghost);

  tierPointerDrag = {
    gameId,
    sourceTile: tile,
    ghost,
    offsetX: clientX - rect.left,
    offsetY: clientY - rect.top,
    clientX,
    clientY,
    targetTierId: '',
    beforeGameId: '',
    scrollSpeed: 0,
  };

  tile.classList.add('dragging');
  document.body.classList.add('tier-is-dragging');
  updateTierDragGhost(clientX, clientY);
  updateTierDropTarget(clientX, clientY);
  updateTierAutoScroll(clientY);
  return true;
}

function handleTierPointerDown(event) {
  const tile = event.target.closest('.tier-game');
  if (!tile || event.button !== 0) return;

  tierPendingDrag = { tile, startX: event.clientX, startY: event.clientY };
  document.addEventListener('pointermove', handleTierPointerMove);
  document.addEventListener('pointerup', handleTierPointerUp, { once: true });
  document.addEventListener('pointercancel', handleTierPointerCancel, { once: true });
}

function handleTierMouseDown(event) {
  const tile = event.target.closest('.tier-game');
  if (!tile || event.button !== 0 || tierPointerDrag) return;
  if (tierPendingDrag) {
    document.addEventListener('mousemove', handleTierMouseMove);
    document.addEventListener('mouseup', handleTierMouseUp, { once: true });
    return;
  }

  tierPendingDrag = { tile, startX: event.clientX, startY: event.clientY };
  document.addEventListener('mousemove', handleTierMouseMove);
  document.addEventListener('mouseup', handleTierMouseUp, { once: true });
}

function handleTierPointerMove(event) {
  if (!tierPointerDrag && tierPendingDrag) {
    const distance = Math.hypot(event.clientX - tierPendingDrag.startX, event.clientY - tierPendingDrag.startY);
    if (distance < 6) return;
    beginTierTileDrag(tierPendingDrag.tile, tierPendingDrag.startX, tierPendingDrag.startY);
  }
  if (!tierPointerDrag) return;
  event.preventDefault();
  tierPointerDrag.clientX = event.clientX;
  tierPointerDrag.clientY = event.clientY;
  updateTierDragGhost(event.clientX, event.clientY);
  updateTierDropTarget(event.clientX, event.clientY);
  updateTierAutoScroll(event.clientY);
}

function handleTierMouseMove(event) {
  if (!tierPointerDrag && tierPendingDrag) {
    const distance = Math.hypot(event.clientX - tierPendingDrag.startX, event.clientY - tierPendingDrag.startY);
    if (distance < 6) return;
    beginTierTileDrag(tierPendingDrag.tile, tierPendingDrag.startX, tierPendingDrag.startY);
  }
  if (!tierPointerDrag) return;
  event.preventDefault();
  tierPointerDrag.clientX = event.clientX;
  tierPointerDrag.clientY = event.clientY;
  updateTierDragGhost(event.clientX, event.clientY);
  updateTierDropTarget(event.clientX, event.clientY);
  updateTierAutoScroll(event.clientY);
}

async function finishTierPointerDrag(shouldDrop) {
  const drag = tierPointerDrag;
  tierPendingDrag = null;
  if (!drag) {
    document.removeEventListener('pointermove', handleTierPointerMove);
    document.removeEventListener('pointerup', handleTierPointerUp);
    document.removeEventListener('pointercancel', handleTierPointerCancel);
    document.removeEventListener('mousemove', handleTierMouseMove);
    document.removeEventListener('mouseup', handleTierMouseUp);
    return;
  }

  tierPointerDrag = null;
  stopTierAutoScroll();
  document.removeEventListener('pointermove', handleTierPointerMove);
  document.removeEventListener('pointerup', handleTierPointerUp);
  document.removeEventListener('pointercancel', handleTierPointerCancel);
  document.removeEventListener('mousemove', handleTierMouseMove);
  document.removeEventListener('mouseup', handleTierMouseUp);
  document.body.classList.remove('tier-is-dragging');
  drag.ghost?.remove();
  clearTierDragState();

  if (shouldDrop && drag.targetTierId) {
    await moveTierGame(drag.gameId, drag.targetTierId, drag.beforeGameId);
  }
}

function handleTierPointerUp() {
  finishTierPointerDrag(true);
}

function handleTierPointerCancel() {
  finishTierPointerDrag(false);
}

function handleTierMouseUp() {
  finishTierPointerDrag(true);
}

async function addTierRow() {
  const tierList = ensureTierListState();
  const label = window.prompt('Название тира', `Tier ${tierList.rows.length + 1}`);
  if (label === null) return;

  const cleanLabel = String(label || '').trim() || `Tier ${tierList.rows.length + 1}`;
  tierList.rows.push({
    id: `tier_${Date.now().toString(36)}`,
    label: cleanLabel.slice(0, 18),
    color: TIER_ROW_COLORS[tierList.rows.length % TIER_ROW_COLORS.length],
    gameIds: [],
  });
  await save();
  renderTierList();
}

async function resetTierList() {
  if (!window.confirm('Сбросить раскладку tier-list?')) return;
  store.tierList = defaultTierList();
  store.tierList = normalizeTierList(store.tierList, store.games);
  await save();
  renderTierList();
}

function tierShareGameData(gameId) {
  const game = store.games?.[gameId];
  if (!game || isGameHidden(game)) return null;
  return {
    title: String(game.title || 'Игра'),
    image: String(gamePoster(game) || gameCover(game) || ''),
    hours: Number(game.hoursPlayed || 0),
    platform: String(game.platform || game.source || ''),
  };
}

function buildTierSharePayload() {
  const tierList = ensureTierListState();
  const rows = tierList.rows.map(row => ({
    label: String(row.label || 'Tier'),
    color: cleanTierColor(row.color, '#60a5fa'),
    games: row.gameIds.map(tierShareGameData).filter(Boolean),
  }));
  return {
    title: 'Game Tracker Tier List',
    generatedAt: new Date().toISOString(),
    rows,
  };
}

function buildTierShareViewerHtml(payload) {
  const rankedCount = payload.rows.reduce((sum, row) => sum + row.games.length, 0);
  const rowsHtml = payload.rows.map(row => {
    const gamesHtml = row.games.length
      ? row.games.map(game => {
          const hours = game.hours > 0 ? `${fmtH(game.hours)} ч` : '';
          const hasImage = !!game.image;
          const imageHtml = game.image
            ? `<img src="${esc(game.image)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />`
            : '';
          return `<article class="game">
            <div class="art">
              ${imageHtml}
              <div class="fallback"${hasImage ? '' : ' style="display:flex"'}>${esc(String(game.title || '?').slice(0, 1).toUpperCase() || '?')}</div>
            </div>
            <div class="name">${esc(game.title)}</div>
            ${hours ? `<div class="meta">${esc(hours)}</div>` : ''}
          </article>`;
        }).join('')
      : '<div class="empty">Пусто</div>';

    return `<section class="row" style="--tier:${esc(row.color)}">
      <div class="label">${esc(row.label)}</div>
      <div class="games">${gamesHtml}</div>
    </section>`;
  }).join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(payload.title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;background:#0b1018;color:#edf3ff;padding:28px}main{max-width:1180px;margin:0 auto}.top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px}.brand{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#8fa1b8;font-weight:800}.title{margin:4px 0 0;font-size:28px;line-height:1.1}.count{color:#9fb0c6;font-size:13px}.board{border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:hidden;background:#101722}.row{display:grid;grid-template-columns:118px minmax(0,1fr);min-height:132px;border-top:1px solid rgba(255,255,255,.08)}.row:first-child{border-top:0}.label{display:flex;align-items:center;justify-content:center;background:var(--tier);color:#07101f;font-size:34px;font-weight:900;padding:12px;text-align:center}.games{display:flex;flex-wrap:wrap;align-content:flex-start;gap:10px;padding:12px;background:rgba(255,255,255,.025)}.game{width:92px;min-width:0}.art{position:relative;width:92px;height:128px;border-radius:6px;overflow:hidden;background:linear-gradient(135deg,#27344c,#111827);border:1px solid rgba(255,255,255,.11)}.art img{width:100%;height:100%;object-fit:cover;display:block}.fallback{display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#dce8ff}.name{margin-top:6px;font-size:11px;font-weight:800;line-height:1.16;color:#e8eef8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.meta{margin-top:3px;font-size:10px;color:#8fa1b8}.empty{width:100%;min-height:96px;border:1px dashed rgba(255,255,255,.12);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#7e8da3;font-size:13px}@media(max-width:640px){body{padding:14px}.top{align-items:flex-start;flex-direction:column}.row{grid-template-columns:1fr}.label{min-height:64px;font-size:28px}.game{width:80px}.art{width:80px;height:112px}}
</style>
</head>
<body>
<main>
  <div class="top">
    <div><div class="brand">Game Tracker</div><h1 class="title">Tier List</h1></div>
    <div class="count">${rankedCount} игр · ${esc(new Date(payload.generatedAt).toLocaleDateString('ru-RU'))}</div>
  </div>
  <div class="board">${rowsHtml}</div>
</main>
</body>
</html>`;
}

function buildTierShareUrl() {
  const payload = buildTierSharePayload();
  return {
    rankedCount: payload.rows.reduce((sum, row) => sum + row.games.length, 0),
    url: `data:text/html;charset=utf-8,${encodeURIComponent(buildTierShareViewerHtml(payload))}`,
  };
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('copy failed');
  return true;
}

function showTierShareLink(url) {
  const panel = document.getElementById('tier-share-panel');
  const input = document.getElementById('tier-share-link');
  if (!panel || !input) return;
  input.value = url;
  panel.classList.remove('hidden');
  input.focus();
  input.select();
}

async function shareTierList() {
  const { rankedCount, url } = buildTierShareUrl();
  if (!rankedCount) {
    toast('Сначала перетащи игры в тиры', 'err');
    return;
  }

  showTierShareLink(url);
  try {
    await copyTextToClipboard(url);
    toast('Ссылка на тирлист скопирована', 'ok');
  } catch {
    toast('Ссылка готова — скопируй из поля', 'ok');
  }
}

async function copyVisibleTierShareLink() {
  const input = document.getElementById('tier-share-link');
  const url = input?.value || '';
  if (!url) return;
  input.focus();
  input.select();
  try {
    await copyTextToClipboard(url);
    toast('Ссылка скопирована', 'ok');
  } catch {
    toast('Не смог скопировать автоматически', 'err');
  }
}

async function moveTierRow(rowId, direction) {
  const tierList = ensureTierListState();
  const idx = tierList.rows.findIndex(row => row.id === rowId);
  const nextIdx = idx + direction;
  if (idx < 0 || nextIdx < 0 || nextIdx >= tierList.rows.length) return;
  [tierList.rows[idx], tierList.rows[nextIdx]] = [tierList.rows[nextIdx], tierList.rows[idx]];
  await save();
  renderTierList();
}

async function deleteTierRow(rowId) {
  const tierList = ensureTierListState();
  if (tierList.rows.length <= 1) {
    toast('Нужен хотя бы один тир', 'err');
    return;
  }
  const row = tierList.rows.find(item => item.id === rowId);
  if (!row) return;
  if (!window.confirm(`Удалить тир "${row.label}"?`)) return;

  tierList.poolGameIds = [...row.gameIds, ...tierList.poolGameIds];
  tierList.rows = tierList.rows.filter(item => item.id !== rowId);
  await save();
  renderTierList();
}

document.getElementById('tier-board').addEventListener('pointerdown', handleTierPointerDown);
document.getElementById('tier-pool').addEventListener('pointerdown', handleTierPointerDown);
document.getElementById('tier-board').addEventListener('mousedown', handleTierMouseDown);
document.getElementById('tier-pool').addEventListener('mousedown', handleTierMouseDown);

document.getElementById('tier-board').addEventListener('click', e => {
  const gameActionBtn = e.target.closest('[data-tier-game-action]');
  if (gameActionBtn) {
    e.stopPropagation();
    const direction = gameActionBtn.dataset.tierGameAction === 'left' ? -1 : 1;
    nudgeTierGame(gameActionBtn.dataset.gameId, direction);
    return;
  }

  const actionBtn = e.target.closest('[data-tier-action]');
  if (actionBtn) {
    const rowId = actionBtn.dataset.tierRowId;
    if (actionBtn.dataset.tierAction === 'up') moveTierRow(rowId, -1);
    if (actionBtn.dataset.tierAction === 'down') moveTierRow(rowId, 1);
    if (actionBtn.dataset.tierAction === 'delete') deleteTierRow(rowId);
    return;
  }

  const tile = e.target.closest('.tier-game');
  if (tile) {
    if (e.detail >= 2) openGamePage(tile.dataset.gameId);
    else selectTierGame(tile.dataset.gameId);
    return;
  }

  const zone = e.target.closest('.tier-dropzone');
  if (zone) {
    placeSelectedTierGame(zone.dataset.tierId);
    return;
  }

  const row = e.target.closest('.tier-row');
  if (row) placeSelectedTierGame(row.dataset.tierRowId);
});

document.getElementById('tier-pool').addEventListener('click', e => {
  const tile = e.target.closest('.tier-game');
  if (tile) {
    if (e.detail >= 2) openGamePage(tile.dataset.gameId);
    else selectTierGame(tile.dataset.gameId);
    return;
  }

  const zone = e.target.closest('.tier-dropzone');
  if (zone) placeSelectedTierGame(zone.dataset.tierId);
});

document.getElementById('tier-board').addEventListener('keydown', e => {
  const tile = e.target.closest('.tier-game');
  if (!tile) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectTierGame(tile.dataset.gameId);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    nudgeTierGame(tile.dataset.gameId, -1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    nudgeTierGame(tile.dataset.gameId, 1);
  }
});

document.getElementById('tier-pool').addEventListener('keydown', e => {
  const tile = e.target.closest('.tier-game');
  if (!tile) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectTierGame(tile.dataset.gameId);
  }
});

document.getElementById('tier-board').addEventListener('change', async e => {
  const tierList = ensureTierListState();
  const labelInput = e.target.closest('.tier-label-input');
  const colorInput = e.target.closest('.tier-color-input');
  const rowId = labelInput?.dataset.tierLabelId || colorInput?.dataset.tierColorId;
  const row = tierList.rows.find(item => item.id === rowId);
  if (!row) return;

  if (labelInput) row.label = String(labelInput.value || '').trim().slice(0, 18) || row.label;
  if (colorInput) row.color = cleanTierColor(colorInput.value, row.color);
  await save();
  renderTierList();
});

document.getElementById('tier-board').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList.contains('tier-label-input')) {
    e.target.blur();
  }
});

document.getElementById('tier-search').addEventListener('input', e => {
  tierSearchQuery = e.target.value;
  renderTierList();
});

document.getElementById('btn-tier-add-row').addEventListener('click', addTierRow);
document.getElementById('btn-tier-share')?.addEventListener('click', shareTierList);
document.getElementById('btn-tier-share-copy')?.addEventListener('click', copyVisibleTierShareLink);
document.getElementById('btn-tier-reset').addEventListener('click', resetTierList);

// ══════════════════════════════════════════════════════════
// КОЛЛЕКЦИИ
// ══════════════════════════════════════════════════════════

const COLL_EMOJI_CATEGORIES = {
  'Все': [
    '📁','📂','🗂️','📋','📌','🔖','📍','🏷️',
    '🎮','🕹️','👾','🎯','🎲','🃏','🎰','🎪','🎭','🎬','🎨',
    '🏆','🥇','🥈','🥉','🏅','🎖️','👑','💎','💍','⭐','🌟','✨','💫','⚡',
    '❤️','💙','💚','💛','🧡','💜','🖤','🤍','💗','💖','💕','💓','💝',
    '😀','😃','😄','😁','😊','🙂','😍','🥰','😎','🤩','🥳','😇',
    '✅','✔️','☑️','✓','✕','❌','⭕','🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪',
    '🔥','💥','💢','💯','🎉','🎊','🎈','🎁','🎀',
    '🌈','🌙','☀️','🌠','🌌','☁️','⛅','🌤️','⛈️','🌩️',
    '🌸','🌺','🌻','🌷','🌹','🥀','🌼','💐','🌿','🍀','🌱','🌲','🌳','🌴',
    '🐉','🐲','🦄','🦋','🐝','🐞','🦅','🦉','🦇','🐺','🦊','🐯','🦁','🐮','🐷','🐸','🐙','🦑',
    '⚔️','🗡️','🔪','🏹','🛡️','🪓','⚒️','🔨','🛠️','⚙️','🔧','🔩',
    '🔮','🎴','🀄','🧙','🧚','🧛','🧜','🧝','🧞','🧟','🎃','👻','💀','☠️',
    '🚀','🛸','✈️','🚁','🚂','🚗','🏎️','🏍️','🚲','⛵','🚤','⛴️','🛥️',
    '⚽','🏀','🏈','⚾','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🥊','🥋','⛳','🏹','🎣',
    '🍕','🍔','🍟','🌭','🍿','🧁','🍰','🎂','🍪','🍩','🍦','🍨','☕','🍺','🍻','🥂','🍷','🍹',
    '🎵','🎶','🎼','🎹','🎸','🎺','🎷','🥁','🎤','🎧','📻','🔊',
    '💻','🖥️','⌨️','🖱️','🖨️','📱','📞','☎️','📟','📠','📡','🔋','🔌','💡','🔦',
    '🔑','🗝️','🔓','🔒','🔐',
    '💰','💵','💴','💶','💷','💸','💳','🏦','📈','📉','💹',
    '🎓','📚','📖','📝','✏️','✒️','🖊️','🖍️','📐','📏',
    '🌍','🌎','🌏','🗺️','🧭','🏔️','⛰️','🏕️','🏖️','🏝️','🏜️',
    '🖼️',
  ],
  'Игры': ['🎮','🕹️','👾','🎯','🎲','🃏','🎰','🎪','🎭','🎬','🎨','🏹','🎣','🎱','🏓','🏸'],
  'Награды': ['🏆','🥇','🥈','🥉','🏅','🎖️','👑','💎','💍','⭐','🌟','✨','💫','⚡','🔥','💯'],
  'Сердца': ['❤️','💙','💚','💛','🧡','💜','🖤','🤍','💗','💖','💕','💓','💝'],
  'Смайлы': ['😀','😃','😄','😁','😊','🙂','😍','🥰','😎','🤩','🥳','😇'],
  'Символы': ['✅','✔️','☑️','✓','✕','❌','⭕','🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪','🔥','💥','💢','💯','🎉','🎊','🎈','🎁','🎀'],
  'Природа': ['🌈','🌙','☀️','⭐','🌟','🌠','🌌','☁️','⛅','🌤️','⛈️','🌩️','⚡','🌸','🌺','🌻','🌷','🌹','🥀','🌼','💐','🌿','🍀','🌱','🌲','🌳','🌴'],
  'Животные': ['🐉','🐲','🦄','🦋','🐝','🐞','🦅','🦉','🦇','🐺','🦊','🐯','🦁','🐮','🐷','🐸','🐙','🦑'],
  'Оружие': ['⚔️','🗡️','🔪','🏹','🛡️','🪓','⚒️','🔨','🛠️','⚙️','🔧','🔩'],
  'Магия': ['🔮','🎴','🀄','🧙','🧚','🧛','🧜','🧝','🧞','🧟','🎃','👻','💀','☠️'],
  'Транспорт': ['🚀','🛸','✈️','🚁','🚂','🚗','🏎️','🏍️','🚲','⛵','🚤','⛴️','🛥️'],
  'Спорт': ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🥊','🥋','⛳','🏹','🎣'],
  'Еда': ['🍕','🍔','🍟','🌭','🍿','🧁','🍰','🎂','🍪','🍩','🍦','🍨','☕','🍺','🍻','🥂','🍷','🍹'],
  'Музыка': ['🎵','🎶','🎼','🎹','🎸','🎺','🎷','🥁','🎤','🎧','📻','🔊'],
  'Техника': ['💻','🖥️','⌨️','🖱️','🖨️','📱','📞','☎️','📟','📠','📡','🔋','🔌','💡','🔦'],
  'Папки': ['📁','📂','🗂️','📋','📌','🔖','📍','🏷️'],
};

let activeEmojiCategory = 'Все';
let emojiSearchQuery = '';

// ── Рендер списка коллекций в сайдбаре ──────────────────
function renderSidebarCollections() {
  const list = document.getElementById('sc-list');
  list.innerHTML = '';

  const cols = Object.values(store.collections);
  if (!cols.length) {
    list.innerHTML = '<div class="sc-empty">Нет коллекций</div>';
    return;
  }

  cols.forEach(col => {
    const count = col.gameIds.filter(id => store.games[id] && !isGameHidden(store.games[id])).length;
    const isActive = activeCollection === col.id;
    const item = document.createElement('div');
    item.className = 'sc-item' + (isActive ? ' active' : '');
    
    // Иконка: либо изображение с Icons8, либо эмодзи
    const iconHtml = col.iconUrl 
      ? `<img src="${col.iconUrl}" alt="" style="width:20px;height:20px;object-fit:contain;" />`
      : col.emoji;
    
    item.innerHTML = `
      <span class="sc-item-emoji">${iconHtml}</span>
      <span class="sc-item-name">${esc(col.name)}</span>
      <span class="sc-item-count">${count}</span>
      <button class="sc-item-edit" data-id="${col.id}" title="Редактировать">⋯</button>
    `;
    // Клик на строку — выбрать коллекцию как фильтр
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('sc-item-edit')) return;
      activeCollection = isActive ? null : col.id;
      // Переходим в библиотеку
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      const libNav = document.querySelector('.nav-item[data-view="library"]');
      if (libNav) libNav.classList.add('active');
      document.getElementById('view-library')?.classList.add('active');
      document.getElementById('app').dataset.view = 'library';
      renderSidebarCollections();
      renderLibrary();
    });
    // Клик на "⋯" — открыть редактор
    item.querySelector('.sc-item-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openCollectionModal(col.id);
    });
    list.appendChild(item);
  });
}

// ── Открыть модалку создания / редактирования ───────────
function openCollectionModal(collId) {
  editingCollId = collId || null;
  const col = collId ? store.collections[collId] : null;

  document.getElementById('mc-title').textContent = col ? 'Редактировать коллекцию' : 'Новая коллекция';
  document.getElementById('mc-name').value = col ? col.name : '';
  
  const emojiBtn = document.getElementById('mc-emoji');
  if (col && col.iconUrl) {
    // Если есть иконка с Icons8
    emojiBtn.innerHTML = `<img src="${col.iconUrl}" alt="${esc(col.name)}" />`;
    emojiBtn.dataset.iconUrl = col.iconUrl;
  } else {
    // Обычный эмодзи
    emojiBtn.textContent = col ? col.emoji : '📁';
    delete emojiBtn.dataset.iconUrl;
  }
  
  document.getElementById('mc-emoji-grid').classList.add('hidden');
  document.getElementById('btn-delete-collection').classList.toggle('hidden', !col);

  activeEmojiCategory = 'Все';
  emojiSearchQuery = '';
  renderEmojiPicker();

  openModal('modal-collection');
  setTimeout(() => document.getElementById('mc-name').focus(), 80);
}

function renderEmojiPicker() {
  // Рендер категорий
  const categoriesEl = document.getElementById('mc-emoji-categories');
  categoriesEl.innerHTML = '';
  Object.keys(COLL_EMOJI_CATEGORIES).forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'mc-emoji-cat-btn' + (cat === activeEmojiCategory ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      activeEmojiCategory = cat;
      renderEmojiPicker();
    });
    categoriesEl.appendChild(btn);
  });

  // Фильтрация эмодзи
  let emojis = COLL_EMOJI_CATEGORIES[activeEmojiCategory] || [];
  if (emojiSearchQuery) {
    const query = emojiSearchQuery.toLowerCase();
    emojis = COLL_EMOJI_CATEGORIES['Все'].filter(em => {
      // Простой поиск по категориям
      for (const [catName, catEmojis] of Object.entries(COLL_EMOJI_CATEGORIES)) {
        if (catName.toLowerCase().includes(query) && catEmojis.includes(em)) {
          return true;
        }
      }
      return false;
    });
  }

  // Рендер списка эмодзи
  const listEl = document.getElementById('mc-emoji-list');
  listEl.innerHTML = '';
  emojis.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'mc-emoji-option';
    btn.textContent = em;
    btn.addEventListener('click', () => {
      const emojiBtn = document.getElementById('mc-emoji');
      emojiBtn.textContent = em;
      delete emojiBtn.dataset.iconUrl;
      document.getElementById('mc-emoji-grid').classList.add('hidden');
    });
    listEl.appendChild(btn);
  });

  // Обновить поле поиска
  const searchEl = document.getElementById('mc-emoji-search');
  if (searchEl) searchEl.value = emojiSearchQuery;
}

// Переключение сетки эмодзи
document.getElementById('mc-emoji').addEventListener('click', () => {
  document.getElementById('mc-emoji-grid').classList.toggle('hidden');
});

// Поиск иконок
document.getElementById('mc-emoji-search').addEventListener('input', (e) => {
  emojiSearchQuery = e.target.value.trim();
  if (emojiSearchQuery) {
    activeEmojiCategory = 'Все';
  }
  renderEmojiPicker();
});

// Поиск иконок на Icons8 для коллекций
document.getElementById('btn-search-collection-icon').addEventListener('click', () => {
  const collectionName = document.getElementById('mc-name').value.trim();
  document.getElementById('icon-search-input').value = collectionName || '';
  document.getElementById('icon-search-results').innerHTML = '';
  document.getElementById('icon-search-status').classList.add('hidden');
  openModal('modal-icon-search');
  setTimeout(() => document.getElementById('icon-search-input').focus(), 150);
});

// Кнопка создать / сохранить
document.getElementById('btn-new-collection').addEventListener('click', () => openCollectionModal(null));

document.getElementById('btn-save-collection').addEventListener('click', async () => {
  const name  = document.getElementById('mc-name').value.trim();
  const emojiBtn = document.getElementById('mc-emoji');
  const emoji = emojiBtn.dataset.iconUrl || emojiBtn.textContent.trim();
  const iconUrl = emojiBtn.dataset.iconUrl || null;
  
  if (!name) { document.getElementById('mc-name').focus(); return; }

  if (editingCollId) {
    store.collections[editingCollId].name  = name;
    store.collections[editingCollId].emoji = emoji;
    if (iconUrl) store.collections[editingCollId].iconUrl = iconUrl;
  } else {
    const id = `coll_${Date.now()}`;
    store.collections[id] = { id, name, emoji, gameIds: [] };
    if (iconUrl) store.collections[id].iconUrl = iconUrl;
  }
  await save();
  renderSidebarCollections();
  closeModal('modal-collection');
  toast(editingCollId ? `Коллекция «${name}» обновлена` : `Коллекция «${name}» создана`, 'ok');
});

// Удалить коллекцию
document.getElementById('btn-delete-collection').addEventListener('click', async () => {
  const col = store.collections[editingCollId];
  if (!col) return;
  if (!confirm(`Удалить коллекцию «${col.name}»? Игры из неё не удалятся.`)) return;
  if (activeCollection === editingCollId) activeCollection = null;
  delete store.collections[editingCollId];
  await save();
  renderSidebarCollections();
  renderLibrary();
  closeModal('modal-collection');
  toast(`Коллекция «${col.name}» удалена`, 'ok');
});

// ── Рендер коллекций в деталях игры ─────────────────────
function renderGameCollections(gameId) {
  const container = document.getElementById('gd-collections');
  container.innerHTML = '';
  const cols = Object.values(store.collections);

  if (!cols.length) {
    container.innerHTML = '<span class="gd-no-collections">Нет коллекций — создай в боковой панели</span>';
    return;
  }

  cols.forEach(col => {
    const inCol = col.gameIds.includes(gameId);
    const badge = document.createElement('button');
    badge.className = 'gd-coll-badge' + (inCol ? ' in-collection' : '');
    
    // Иконка: либо изображение с Icons8, либо эмодзи
    const iconHtml = col.iconUrl 
      ? `<img src="${col.iconUrl}" alt="" style="width:16px;height:16px;object-fit:contain;" />`
      : `<span>${col.emoji}</span>`;
    
    badge.innerHTML = `${iconHtml}<span>${esc(col.name)}</span>`;
    badge.addEventListener('click', async () => {
      const g = store.collections[col.id];
      if (inCol) {
        g.gameIds = g.gameIds.filter(id => id !== gameId);
      } else {
        if (!g.gameIds.includes(gameId)) g.gameIds.push(gameId);
      }
      await save();
      renderGameCollections(gameId);
      renderSidebarCollections();
      if (activeCollection === col.id) renderLibrary();
    });
    container.appendChild(badge);
  });
}

// ══════════ ДАШБОРД ═══════════════════════════════════════
function renderDashboard() {
  const list = gamesList();
  document.getElementById('dashboard-date').textContent =
    new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  document.getElementById('stat-hours').textContent  = fmtH(list.reduce((s, g) => s + (g.hoursPlayed || 0), 0));
  document.getElementById('stat-games').textContent  = list.length;
  document.getElementById('stat-ach').textContent    = list.reduce((s, g) => s + (g.achievementsUnlocked || 0), 0);
  document.getElementById('stat-streak').textContent = calcStreak(list);

  const recent = [...list]
    .filter(g => g.lastPlayedAt)
    .sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt))
    .slice(0, 8);

  const grid = document.getElementById('recent-games');
  grid.innerHTML = '';
  if (!recent.length) {
    grid.innerHTML = '<div class="empty-hint">Добавь первую игру или импортируй Steam-библиотеку</div>';
    return;
  }
  recent.forEach(g => grid.appendChild(makeGameCard(g)));
}

// ══════════════════════════════════════════════════════════
// НАСТРОЙКИ — ТЕМЫ
// ══════════════════════════════════════════════════════════
const THEMES = ['steam', 'aurora', 'obsidian', 'neon', 'forest', 'crimson', 'slate'];
const DENSITY_MODES = ['compact', 'normal', 'wide'];

function applyTheme(themeId) {
  const t = THEMES.includes(themeId) ? themeId : 'steam';
  if (t === 'steam') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', t);
  }
  store.settings.theme = t;
}

function applyDensity(mode) {
  const nextMode = DENSITY_MODES.includes(mode) ? mode : 'normal';
  if (nextMode === 'normal') {
    document.documentElement.removeAttribute('data-density');
  } else {
    document.documentElement.setAttribute('data-density', nextMode);
  }
  store.settings.density = nextMode;
}

function renderSettingsView() {
  setSettingsTab(document.querySelector('.settings-tab.active')?.dataset.settingsTab || 'appearance');
  const current = store.settings.theme || 'steam';
  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.themeId === current);
  });
  const currentDensity = store.settings.density || 'normal';
  document.querySelectorAll('.density-card').forEach(card => {
    card.classList.toggle('active', card.dataset.densityId === currentDensity);
  });
  renderDriveSettings();
// Инициализация переключателя скрытия шуток
  const hideEl = document.getElementById('hide-jokes-toggle');
  if (hideEl) hideEl.checked = !!store.settings.hideJokes;
  renderHiddenGamesSettings();
}

function setSettingsTab(tabId = 'appearance') {
  const target = document.querySelector(`[data-settings-panel="${CSS.escape(tabId)}"]`)
    ? tabId
    : 'appearance';

  document.querySelectorAll('[data-settings-tab]').forEach(btn => {
    const active = btn.dataset.settingsTab === target;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  document.querySelectorAll('[data-settings-panel]').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.settingsPanel === target);
  });
}

document.querySelector('#view-settings .settings-tabs')?.addEventListener('click', event => {
  const tab = event.target.closest('[data-settings-tab]');
  if (!tab) return;
  setSettingsTab(tab.dataset.settingsTab);
});

function renderHiddenGamesSettings() {
  const listEl = document.getElementById('hidden-games-list');
  const countEl = document.getElementById('hidden-games-count');
  if (!listEl) return;

  const list = hiddenGamesList();
  if (countEl) countEl.textContent = String(list.length);
  if (!list.length) {
    listEl.innerHTML = '<div class="hidden-games-empty">Скрытых игр нет</div>';
    return;
  }

  listEl.innerHTML = list.map(game => {
    const cover = gamePoster(game) || gameCover(game);
    const meta = game.platform || game.source || 'Игра';
    const coverHtml = cover
      ? `<img class="hidden-game-cover" src="${esc(cover)}" alt="" loading="lazy" decoding="async" />`
      : '<div class="hidden-game-cover hidden-game-cover-empty">?</div>';
    return `<div class="hidden-game-row">
      ${coverHtml}
      <div class="hidden-game-info">
        <div class="hidden-game-title">${esc(game.title || 'Игра')}</div>
        <div class="hidden-game-meta">${esc(meta)}</div>
      </div>
      <button class="btn-sm btn-ghost hidden-game-return" type="button" data-unhide-game-id="${esc(game.id)}">Вернуть</button>
    </div>`;
  }).join('');
}

document.querySelectorAll('.theme-card').forEach(card => {
  card.addEventListener('click', async () => {
    applyTheme(card.dataset.themeId);
    renderSettingsView();
    await save();
  });
});

document.querySelectorAll('.density-card').forEach(card => {
  card.addEventListener('click', async () => {
    applyDensity(card.dataset.densityId);
    renderSettingsView();
    await save();
  });
});

// ══════════════════════════════════════════════════════════
// GOOGLE DRIVE
// ══════════════════════════════════════════════════════════
let driveConnected = false;
let screenshotDriveSyncBusy = false;

function screenshotUpdateCount(updates = {}) {
  return Object.values(updates || {}).reduce((sum, gameUpdates) => {
    return sum + Object.keys(gameUpdates || {}).length;
  }, 0);
}

function applyScreenshotUpdates(updates = {}) {
  Object.entries(updates || {}).forEach(([gameId, gameUpdates]) => {
    const game = store.games?.[gameId];
    if (!game || !Array.isArray(game.screenshots)) return;
    game.screenshots = game.screenshots.map((shot, idx) => {
      const key = shot.id || shot.driveFileId || shot.driveFileName || shot.fileName || '';
      const patch = gameUpdates?.[key];
      return normalizeScreenshot(patch ? { ...shot, ...patch } : shot, idx);
    });
  });
}

async function persistStoreOnly() {
  store = normalizeStore(store);
  return api.saveData(store);
}

async function downloadScreenshotsFromDrive({ silent = false } = {}) {
  if (!driveConnected || !api.driveDownloadScreenshots) return { ok: false };
  const result = await api.driveDownloadScreenshots({ games: store.games });
  if (!result?.ok) {
    if (!silent) toast('Ошибка загрузки скриншотов из Drive: ' + (result?.error || '?'), 'err');
    return result;
  }
  if (screenshotUpdateCount(result.updates)) {
    applyScreenshotUpdates(result.updates);
    await persistStoreOnly();
    if (selectedLibGameId && store.games[selectedLibGameId]) {
      renderSLMediaSection(store.games[selectedLibGameId]);
    }
  }
  return result;
}

async function uploadScreenshotsToDrive({ silent = false, uploadData = true } = {}) {
  if (!driveConnected) {
    if (!silent) toast('Сначала подключи Google Drive в Настройках', 'err');
    return { ok: false };
  }
  if (!api.driveUploadScreenshots) return { ok: false, error: 'Синхронизация скриншотов недоступна' };
  if (screenshotDriveSyncBusy) return { ok: false, busy: true };

  screenshotDriveSyncBusy = true;
  try {
    const result = await api.driveUploadScreenshots({ games: store.games });
    if (!result?.ok) {
      if (!silent) toast('Ошибка загрузки скриншотов в Drive: ' + (result?.error || '?'), 'err');
      return result;
    }

    if (screenshotUpdateCount(result.updates)) {
      applyScreenshotUpdates(result.updates);
    }
    store.settings.drive ??= {};
    store.settings.drive.lastSync = result.time || new Date().toISOString();
    await persistStoreOnly();

    if (uploadData) {
      const dataUp = await api.driveUploadData(store);
      if (dataUp?.ok) {
        store.settings.drive.lastSync = dataUp.time;
        await persistStoreOnly();
      } else if (!silent) {
        toast('Скриншоты загружены, но данные не обновились: ' + (dataUp?.error || '?'), 'err');
      }
    }

    renderDriveSettings();
    if (selectedLibGameId && store.games[selectedLibGameId]) {
      renderSLMediaSection(store.games[selectedLibGameId]);
    }
    if (!silent) toast(result.uploaded ? `Скриншоты синхронизированы: ${result.uploaded}` : 'Скриншоты уже синхронизированы', 'ok');
    return result;
  } finally {
    screenshotDriveSyncBusy = false;
  }
}

async function driveInit() {
  const { clientId, clientSecret } = store.settings.drive || {};
  if (!clientId || !clientSecret) return;
  const res = await api.driveInit({ clientId, clientSecret });
  if (res?.connected) {
    driveConnected = true;
    store.settings.drive.email = res.email;
    renderDriveSettings();
  }
}

function renderDriveSettings() {
  const cfg  = store.settings.drive || {};
  const disc = document.getElementById('drive-disconnected');
  const conn = document.getElementById('drive-connected');
  const err  = document.getElementById('drive-error');
  if (!disc || !conn) return;

  if (driveConnected) {
    disc.classList.add('hidden');
    conn.classList.remove('hidden');
    document.getElementById('drive-email').textContent    = cfg.email || '—';
    document.getElementById('drive-last-sync').textContent =
      cfg.lastSync ? 'Последняя синхронизация: ' + new Date(cfg.lastSync).toLocaleString('ru-RU') : 'Ещё не синхронизировалось';
    document.getElementById('drive-autosync').checked = !!cfg.autoSync;
  } else {
    disc.classList.remove('hidden');
    conn.classList.add('hidden');
    document.getElementById('drive-client-id').value     = cfg.clientId     || '';
    document.getElementById('drive-client-secret').value = cfg.clientSecret || '';
  }
  err.classList.add('hidden');
}

// Подключить Drive
document.getElementById('btn-drive-connect').addEventListener('click', async () => {
  const clientId     = document.getElementById('drive-client-id').value.trim();
  const clientSecret = document.getElementById('drive-client-secret').value.trim();
  const err          = document.getElementById('drive-error');
  const lbl          = document.getElementById('btn-drive-connect-label');
  if (!clientId || !clientSecret) {
    err.textContent = 'Введи Client ID и Client Secret';
    err.classList.remove('hidden'); return;
  }
  lbl.textContent = 'Открываю браузер…';
  err.classList.add('hidden');
  const res = await api.driveConnect({ clientId, clientSecret });
  lbl.textContent = 'Подключить Google Drive';
  if (res?.ok) {
    driveConnected = true;
    store.settings.drive = { ...store.settings.drive, clientId, clientSecret, email: res.email };
    await save();
    renderDriveSettings();
    toast('Google Drive подключён: ' + res.email, 'ok');
  } else {
    err.textContent = 'Ошибка: ' + (res?.error || 'неизвестно');
    err.classList.remove('hidden');
  }
});

// Отключить Drive
document.getElementById('btn-drive-disconnect').addEventListener('click', async () => {
  if (!confirm('Отключить Google Drive? Локальные данные останутся нетронутыми.')) return;
  await api.driveDisconnect();
  driveConnected = false;
  delete store.settings.drive;
  await save();
  renderDriveSettings();
  toast('Google Drive отключён', 'ok');
});

// Экспорт токена для мобильного приложения
document.getElementById('btn-drive-export-token').addEventListener('click', async () => {
  const result = await api.driveExportToken();
  if (!result?.ok) {
    toast(result?.error || 'Токен не найден. Сначала подключи Google Drive.', 'err');
    return;
  }
  await navigator.clipboard.writeText(result.token);
  toast('Токен скопирован в буфер обмена!', 'ok');
});

// Авто-синхронизация toggle
document.getElementById('drive-autosync').addEventListener('change', async e => {
  store.settings.drive ??= {};
  store.settings.drive.autoSync = e.target.checked;
  await save();
});

// Toggle: скрыть шутки/незначительные названия
const hideJokesToggle = document.getElementById('hide-jokes-toggle');
if (hideJokesToggle) {
  hideJokesToggle.addEventListener('change', async (ev) => {
    store.settings ??= {};
    store.settings.hideJokes = ev.target.checked;
    await save();
    if (store.settings.hideJokes) {
      store = removeJokeGamesFromStore(store);
      renderAll();
    } else {
      // Перезагрузка данных, чтобы вернуть 原альные названия
      const fresh = normalizeStore(await api.loadData());
      store = fresh;
      renderAll();
    }
  });
}

document.getElementById('hidden-games-list')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-unhide-game-id]');
  if (!btn) return;
  unhideGameFromLibrary(btn.dataset.unhideGameId);
});

// Синхронизировать сейчас
document.getElementById('btn-drive-sync-now').addEventListener('click', () => driveSync());

async function driveSync() {
  const btn = document.getElementById('btn-drive-sync-now');
  if (btn) btn.textContent = '⏳ Синхронизирую…';
  try {
    const localGamesBeforeSync = store.games || {};
    // Всегда скачиваем из Drive — это последняя актуальная версия
    const cloud = await api.driveDownloadData();
    if (!cloud?.ok) {
      toast('Ошибка загрузки из Drive: ' + (cloud?.error || '?'), 'err');
      return;
    }
    // Сохраняем настройки Drive чтобы не потерять подключение
    const driveSettings = store.settings?.drive;
    store = normalizeStore(cloud.data);
    store.settings ??= {};
    if (driveSettings) store.settings.drive = driveSettings;
    Object.entries(localGamesBeforeSync).forEach(([gameId, localGame]) => {
      if (!localGame?.screenshots?.length || !store.games?.[gameId]) return;
      store.games[gameId].screenshots = mergeScreenshotLists(store.games[gameId].screenshots, localGame.screenshots);
    });
    store.settings.drive ??= {};
    store.settings.drive.lastSync = new Date().toISOString();
    await persistStoreOnly();
    await downloadScreenshotsFromDrive({ silent: true });
    renderAll();
    renderDriveSettings();
    toast('Данные загружены из Drive', 'ok');
    const shotsUp = await uploadScreenshotsToDrive({ silent: true, uploadData: false });
    if (shotsUp && !shotsUp.ok && !shotsUp.busy) {
      toast('Ошибка синхронизации скриншотов: ' + (shotsUp.error || '?'), 'err');
    }
    const up = await api.driveUploadData(store);
    if (up?.ok) {
      store.settings.drive.lastSync = up.time;
      await persistStoreOnly();
      renderDriveSettings();
    } else {
      toast('Ошибка синхронизации: ' + (up?.error || '?'), 'err');
    }
  } finally {
    if (btn) btn.textContent = '↑↓ Синхронизировать';
  }
}

// Инструкция по настройке GCP
document.getElementById('link-gcp').addEventListener('click', e => {
  e.preventDefault();
  api.openExternal('https://console.cloud.google.com/apis/credentials');
});

// ── Сохранения игр ──
document.getElementById('btn-pick-save-path').addEventListener('click', async () => {
  const p = await api.drivePickFolder();
  if (!p) return;
  const game = store.games[openedGameId];
  if (!game) return;
  game.savePath = p;
  document.getElementById('gd-save-path').value = p;
  await save();
});

function saveProgressShow(label) {
  const wrap = document.getElementById('gd-save-progress');
  const fill = document.getElementById('gd-save-progress-fill');
  const lbl  = document.getElementById('gd-save-progress-label');
  if (!wrap) return;
  wrap.classList.remove('hidden');
  fill.classList.remove('done');
  fill.style.width = '0%';
  lbl.textContent  = label;
  // Имитируем прогресс: быстро до 85%, потом ждём ответа
  let pct = 0;
  fill._timer = setInterval(() => {
    pct = pct < 85 ? pct + (pct < 30 ? 4 : pct < 60 ? 2 : 0.5) : 85;
    fill.style.width = pct + '%';
  }, 120);
}

function saveProgressDone(label, isError = false) {
  const wrap = document.getElementById('gd-save-progress');
  const fill = document.getElementById('gd-save-progress-fill');
  const lbl  = document.getElementById('gd-save-progress-label');
  if (!wrap) return;
  clearInterval(fill._timer);
  fill.classList.add('done');
  fill.style.width      = isError ? '100%' : '100%';
  fill.style.background = isError ? 'var(--red)' : 'var(--grad-bar)';
  lbl.textContent       = label;
  setTimeout(() => { wrap.classList.add('hidden'); fill.style.background = ''; }, 2500);
}

document.getElementById('btn-upload-save').addEventListener('click', async () => {
  const game = store.games[openedGameId];
  if (!game?.savePath) { toast('Сначала выбери папку сохранений', 'err'); return; }
  if (!driveConnected) { toast('Сначала подключи Google Drive в Настройках', 'err'); return; }
  const btn = document.getElementById('btn-upload-save');
  btn.disabled = true;
  saveProgressShow('Упаковываю файлы…');
  // Смена лейблов с задержкой для ощущения процесса
  const labels = ['Упаковываю файлы…', 'Подключаюсь к Drive…', 'Загружаю архив…'];
  let li = 0;
  const lt = setInterval(() => {
    li++;
    if (li < labels.length) document.getElementById('gd-save-progress-label').textContent = labels[li];
  }, 1200);
  const res = await api.driveUploadSave({ gameId: openedGameId, gameName: game.title, savePath: game.savePath });
  clearInterval(lt);
  btn.disabled = false;
  if (res?.ok) {
    saveProgressDone('Загружено в Drive ✓');
    game.saveLastSync = res.time; await save();
    document.getElementById('gd-save-last-sync').textContent = 'Загружено ' + new Date(res.time).toLocaleString('ru-RU');
  } else {
    saveProgressDone('Ошибка: ' + (res?.error || '?'), true);
  }
});

document.getElementById('btn-download-save').addEventListener('click', async () => {
  const game = store.games[openedGameId];
  if (!game?.savePath) { toast('Сначала выбери папку сохранений', 'err'); return; }
  if (!driveConnected) { toast('Сначала подключи Google Drive в Настройках', 'err'); return; }
  if (!confirm('Восстановить сохранение из Drive? Текущие файлы будут заменены.')) return;
  const btn = document.getElementById('btn-download-save');
  btn.disabled = true;
  saveProgressShow('Подключаюсь к Drive…');
  const labels = ['Подключаюсь к Drive…', 'Скачиваю архив…', 'Распаковываю файлы…'];
  let li = 0;
  const lt = setInterval(() => {
    li++;
    if (li < labels.length) document.getElementById('gd-save-progress-label').textContent = labels[li];
  }, 1200);
  const res = await api.driveDownloadSave({ gameId: openedGameId, gameName: game.title, savePath: game.savePath });
  clearInterval(lt);
  btn.disabled = false;
  if (res?.ok) {
    saveProgressDone('Сохранение восстановлено ✓');
  } else {
    saveProgressDone('Ошибка: ' + (res?.error || '?'), true);
  }
});

// ══════════ БИБЛИОТЕКА ════════════════════════════════════
function renderLibrary() {
  applyLibrarySidebarState();
  updateFilterBtnStates();
  const list = filterAndSort();
  if (selectedLibGameId && store.games[selectedLibGameId]) {
    openGameDetail(selectedLibGameId);
  } else {
    selectedLibGameId = null;
    showLibraryOverview(list);
  }
  requestAnimationFrame(syncAppHeaderCondensedState);
}

function filterAndSort() {
  const q   = (document.getElementById('sl-search')?.value || '').toLowerCase();
  const srt = document.getElementById('sl-sort')?.value || 'hours';
  let list  = gamesList().filter(g => {
    if (q && !g.title.toLowerCase().includes(q)) return false;
    if (activeCollection) {
      const col = store.collections[activeCollection];
      if (!col || !col.gameIds.includes(g.id)) return false;
    }
    if (activeTagFilter && !(g.tags || []).includes(activeTagFilter)) return false;
    if (activePlatformFilter && gamePlatformFilterKey(g) !== activePlatformFilter) return false;
    // Фильтр по статусу
    if (activeStatusFilter !== '') {
      if (activeStatusFilter === 'none') {
        if (g.status) return false;
      } else {
        if (g.status !== activeStatusFilter) return false;
      }
    }
    // Фильтр по оценке
    if (activeRatingFilter !== null) {
      if (activeRatingFilter === 0) {
        if (g.rating) return false;          // без оценки
      } else {
        const max = activeRatingFilter === 9 ? 10
                  : activeRatingFilter === 7 ? 8
                  : activeRatingFilter === 5 ? 6
                  : 4; // 1-4
        if (!g.rating || g.rating < activeRatingFilter || g.rating > max) return false;
      }
    }
    return true;
  });

  // Применяем пользовательский порядок (drag&drop) только при сортировке «Недавние»
  const order = store.settings.gameOrder || [];
  if (srt === 'recent' && order.length) {
    list.sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      if (ia === -1 && ib === -1) return (new Date(b.lastPlayedAt||0)) - (new Date(a.lastPlayedAt||0));
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  } else {
    list.sort((a, b) => {
      if (srt === 'hours')  return (b.hoursPlayed || 0) - (a.hoursPlayed || 0);
      if (srt === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (srt === 'alpha')  return a.title.localeCompare(b.title, 'ru');
      if (srt === 'ach')    return (b.achievementsUnlocked || 0) - (a.achievementsUnlocked || 0);
      const ta = a.lastPlayedAt ? new Date(a.lastPlayedAt) : new Date(0);
      const tb = b.lastPlayedAt ? new Date(b.lastPlayedAt) : new Date(0);
      return tb - ta;
    });
  }

  renderSLGameList(list);
  if (!selectedLibGameId || !store.games[selectedLibGameId]) {
    renderSLOverview(list);
  }
  return list;
}

function renderTagsBar() {
  // no-op: tags bar removed from library layout
}

function reorderGames(draggedId, targetId) {
  const order = store.settings.gameOrder?.length
    ? [...store.settings.gameOrder]
    : gamesList().map(g => g.id);
  const from = order.indexOf(draggedId);
  const to   = order.indexOf(targetId);
  if (from === -1 || to === -1) return;
  order.splice(from, 1);
  order.splice(to, 0, draggedId);
  store.settings.gameOrder = order;
  save();
  filterAndSort();
}

document.getElementById('sl-search').addEventListener('input', () => {
  clearTimeout(librarySearchTimer);
  librarySearchTimer = setTimeout(filterAndSort, LIBRARY_SEARCH_DEBOUNCE_MS);
});
document.getElementById('sl-sort').addEventListener('change', filterAndSort);
document.querySelector('.content').addEventListener('scroll', scheduleAppHeaderCondensedState, { passive: true });
document.getElementById('sl-detail').addEventListener('scroll', handleLibraryDetailScroll, { passive: true });
document.getElementById('sl-overview').addEventListener('scroll', handleLibraryOverviewScroll, { passive: true });
document.getElementById('sl-game-list').addEventListener('scroll', handleSLGameListScroll, { passive: true });
bindScrollPerformanceHints(document.getElementById('sl-detail'));
bindScrollPerformanceHints(document.getElementById('sl-overview'));
bindScrollPerformanceHints(document.getElementById('sl-game-list'));
document.getElementById('sl-overview-toggle-list').addEventListener('click', async e => {
  const btn = e.target.closest('.sl-overview-toggle');
  if (!btn) return;

  const activeIds = getLibraryOverviewSectionIds();
  const sectionId = btn.dataset.sectionId;
  const nextIds = activeIds.includes(sectionId)
    ? activeIds.filter(id => id !== sectionId)
    : [...activeIds, sectionId];

  setLibraryOverviewSectionIds(nextIds);
  await save();
  if (!selectedLibGameId) renderLibrary();
});
document.getElementById('sl-overview-reset').addEventListener('click', async () => {
  setLibraryOverviewSectionIds(DEFAULT_LIBRARY_OVERVIEW_SECTION_IDS);
  await save();
  if (!selectedLibGameId) renderLibrary();
});
document.getElementById('sl-overview-sections').addEventListener('click', e => {
  const btn = e.target.closest('.sl-overview-expand');
  if (!btn) return;
  const sectionId = String(btn.dataset.sectionId || '');
  if (!sectionId) return;
  if (expandedLibraryOverviewSections.has(sectionId)) {
    expandedLibraryOverviewSections.delete(sectionId);
  } else {
    expandedLibraryOverviewSections.add(sectionId);
  }
  if (!selectedLibGameId) renderLibrary();
});
document.getElementById('sl-back-btn').addEventListener('click', () => returnToLibraryOverview());
document.getElementById('sl-left-header').addEventListener('click', () => returnToLibraryOverview());
document.getElementById('sl-left-toggle').addEventListener('click', () => {
  setLibrarySidebarCollapsed(!librarySidebarCollapsed);
});
window.addEventListener('resize', () => {
  clearTimeout(librarySidebarResizeTimer);
  librarySidebarResizeTimer = setTimeout(() => {
    syncLibrarySidebarToViewport();
  }, 90);
});

// ── Steam-style library list ───────────────────────────
function renderSLGameList(list) {
  const container = document.getElementById('sl-game-list');
  slGameListVirtual = { list, start: 0, end: 0 };
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<div class="sl-list-empty">Игры не найдены</div>';
    return;
  }
  const totalHeight = list.length * SL_GAME_LIST_ITEM_HEIGHT;
  const maxScrollTop = Math.max(0, totalHeight - container.clientHeight);
  if (container.scrollTop > maxScrollTop) container.scrollTop = maxScrollTop;
  renderSLGameListWindow();
}

function renderSLGameListWindow() {
  const container = document.getElementById('sl-game-list');
  const list = slGameListVirtual.list || [];
  if (!container || !list.length) return;

  const viewportHeight = container.clientHeight || 640;
  const scrollTop = container.scrollTop || 0;
  const start = Math.max(0, Math.floor(scrollTop / SL_GAME_LIST_ITEM_HEIGHT) - SL_GAME_LIST_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / SL_GAME_LIST_ITEM_HEIGHT) + SL_GAME_LIST_OVERSCAN * 2;
  const end = Math.min(list.length, start + visibleCount);

  if (slGameListVirtual.start === start && slGameListVirtual.end === end && container.childElementCount) return;
  slGameListVirtual.start = start;
  slGameListVirtual.end = end;

  const fragment = document.createDocumentFragment();
  const topSpacer = document.createElement('div');
  topSpacer.className = 'sl-list-spacer';
  topSpacer.style.height = `${start * SL_GAME_LIST_ITEM_HEIGHT}px`;
  fragment.appendChild(topSpacer);

  list.slice(start, end).forEach(g => {
    const item = document.createElement('div');
    item.className = 'sl-game-item' + (g.id === selectedLibGameId ? ' active' : '');
    item.dataset.id = g.id;
    const cover = gameCover(g);
    const ratingHtml = g.rating ? `<span class="sl-item-rating">★ ${g.rating}</span>` : '';
    item.innerHTML = `
      <div class="sl-item-thumb">
        ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" decoding="async" fetchpriority="low" onerror="this.style.display='none'"/>` : ''}
      </div>
      <div class="sl-item-info">
        <div class="sl-item-title">${esc(g.title)}</div>
        <div class="sl-item-meta">
          <span>${fmtH(g.hoursPlayed || 0)} ч.</span>
          ${ratingHtml}
        </div>
      </div>`;
    item.addEventListener('click', () => openGameDetail(g.id));
    item.addEventListener('contextmenu', e => openGameStatusMenu(e, g.id));
    fragment.appendChild(item);
  });

  const bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'sl-list-spacer';
  bottomSpacer.style.height = `${(list.length - end) * SL_GAME_LIST_ITEM_HEIGHT}px`;
  fragment.appendChild(bottomSpacer);

  container.innerHTML = '';
  container.appendChild(fragment);
}

function librarySortLabel(value) {
  if (value === 'alpha') return 'по алфавиту';
  if (value === 'hours') return 'по времени в игре';
  if (value === 'rating') return 'по оценке';
  if (value === 'ach') return 'по достижениям';
  return 'по недавним';
}

function compareGamesByTitle(a, b) {
  return a.title.localeCompare(b.title, 'ru');
}

function compareGamesByRecent(a, b) {
  const ta = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
  const tb = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
  if (tb !== ta) return tb - ta;
  return compareGamesByTitle(a, b);
}

function compareGamesByHours(a, b) {
  const diff = (b.hoursPlayed || 0) - (a.hoursPlayed || 0);
  if (diff) return diff;
  return compareGamesByRecent(a, b);
}

function compareGamesByAchievementProgress(a, b) {
  const aPct = (a.achievementsTotal || 0) ? (a.achievementsUnlocked || 0) / a.achievementsTotal : 0;
  const bPct = (b.achievementsTotal || 0) ? (b.achievementsUnlocked || 0) / b.achievementsTotal : 0;
  if (bPct !== aPct) return bPct - aPct;
  const unlockedDiff = (b.achievementsUnlocked || 0) - (a.achievementsUnlocked || 0);
  if (unlockedDiff) return unlockedDiff;
  return compareGamesByTitle(a, b);
}

function getLibraryOverviewSectionIds() {
  const validIds = new Set(LIBRARY_OVERVIEW_SECTION_DEFS.map(def => def.id));
  const saved = Array.isArray(store.settings.libraryOverviewSections)
    ? store.settings.libraryOverviewSections.filter(id => validIds.has(id))
    : [];
  const unique = [...new Set(saved)];
  return unique.length ? unique : [...DEFAULT_LIBRARY_OVERVIEW_SECTION_IDS];
}

function setLibraryOverviewSectionIds(ids) {
  const validIds = new Set(LIBRARY_OVERVIEW_SECTION_DEFS.map(def => def.id));
  const order = LIBRARY_OVERVIEW_SECTION_DEFS.map(def => def.id);
  store.settings.libraryOverviewSections = [...new Set((ids || []).filter(id => validIds.has(id)))]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function getLibraryOverviewMatches(list, sectionId) {
  if (sectionId === 'recent') {
    return [...list]
      .filter(game => game.lastPlayedAt)
      .sort(compareGamesByRecent);
  }
  if (sectionId === 'hours') {
    return [...list]
      .filter(game => (game.hoursPlayed || 0) > 0)
      .sort(compareGamesByHours);
  }
  if (sectionId === 'progress') {
    return [...list]
      .filter(game => (game.achievementsTotal || 0) > 0)
      .sort(compareGamesByAchievementProgress);
  }
  if (['playing', 'completed', 'planned', 'dropped'].includes(sectionId)) {
    return [...list]
      .filter(game => game.status === sectionId)
      .sort(compareGamesByRecent);
  }
  if (sectionId === 'all') {
    return [...list];
  }
  return [];
}

function getLibraryOverviewLimit(sectionId) {
  if (sectionId === 'all') return 12;
  if (['playing', 'completed', 'planned', 'dropped'].includes(sectionId)) return 8;
  return 6;
}

function renderSLOverviewControls(list, activeIds) {
  const toggleListEl = document.getElementById('sl-overview-toggle-list');
  if (!toggleListEl) return;

  toggleListEl.innerHTML = LIBRARY_OVERVIEW_SECTION_DEFS.map(def => {
    const count = getLibraryOverviewMatches(list, def.id).length;
    const active = activeIds.includes(def.id);
    return `<button class="sl-overview-toggle${active ? ' active' : ''}" type="button" data-section-id="${esc(def.id)}">
      ${esc(def.label)} (${count})
    </button>`;
  }).join('');
}

function showLibraryOverview(list = []) {
  const overviewEl = document.getElementById('sl-overview');
  const detailEl = document.getElementById('sl-detail');
  if (!overviewEl || !detailEl) return;

  overviewEl.classList.remove('hidden');
  detailEl.classList.add('hidden');
  document.getElementById('sl-ach-modal').classList.add('hidden');
  document.querySelectorAll('.sl-game-item').forEach(el => el.classList.remove('active'));
  renderSLOverview(list);
}

function returnToLibraryOverview() {
  selectedLibGameId = null;
  closeModal('modal-sl-settings');
  renderLibrary();
}

function openSLSettingsModal() {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  document.getElementById('sl-settings-subtitle').textContent = `Настройки для ${game.title}`;
  document.getElementById('sl-gear-status').textContent = '';
  document.getElementById('sl-launch-path-val').textContent = getLaunchPath(game) || 'Исполняемый файл не задан';
  document.getElementById('sl-steam-appid').value = getAchievementAppId(game);
  renderSLPosterEditor(game);
  renderSLHeroEditor(game);
  const steamSyncDisabledEl = document.getElementById('sl-steam-sync-disabled');
  if (steamSyncDisabledEl) steamSyncDisabledEl.checked = !!game.steamSyncDisabled;
  setGameSettingsTab('media');
  openModal('modal-sl-settings');
}

/* Game settings tabs */
function setGameSettingsTab(tabId = 'media') {
  document.querySelectorAll('[data-game-tab]').forEach(btn => {
    const active = btn.dataset.gameTab === tabId;
    btn.classList.toggle('active', active);
  });
  document.querySelectorAll('[data-game-panel]').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.gamePanel === tabId);
  });
}
document.querySelector('.game-settings-tabs')?.addEventListener('click', e => {
  const tab = e.target.closest('[data-game-tab]');
  if (!tab) return;
  setGameSettingsTab(tab.dataset.gameTab);
});

function renderSLPosterEditor(game) {
  const poster = gamePoster(game) || gameCover(game);
  const urlInput = document.getElementById('sl-poster-url');
  const img = document.getElementById('sl-poster-preview-img');
  const ph = document.getElementById('sl-poster-preview-ph');
  if (urlInput) urlInput.value = game.posterUrl || '';
  if (!img || !ph) return;
  img.onload = () => { img.classList.remove('hidden'); ph.classList.add('hidden'); };
  img.onerror = () => { img.classList.add('hidden'); ph.classList.remove('hidden'); };
  if (poster) {
    img.src = poster;
    if (img.complete) {
      img.classList.remove('hidden');
      ph.classList.add('hidden');
    }
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    ph.classList.remove('hidden');
  }
}

async function setSelectedGamePoster(posterUrl) {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  game.posterUrl = String(posterUrl || '').trim();
  await save();
  renderSLPosterEditor(game);
  openGameDetail(selectedLibGameId);
  renderLibrary();
  renderStats();
  openSLSettingsModal();
  toast(game.posterUrl ? 'Постер обновлён' : 'Постер сброшен', 'ok');
}

function currentHeroPreviewUrl(game) {
  if (game.heroUrl) return game.heroUrl;
  const appId = String(game.appid || game.steamAppId || '').trim();
  if (appId) return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`;
  return game.coverUrl || game.posterUrl || '';
}

function renderSLHeroEditor(game) {
  const hero = currentHeroPreviewUrl(game);
  const urlInput = document.getElementById('sl-hero-url');
  const img = document.getElementById('sl-hero-preview-img');
  const ph = document.getElementById('sl-hero-preview-ph');
  if (urlInput) urlInput.value = game.heroUrl || '';
  if (!img || !ph) return;
  img.onload = () => { img.classList.remove('hidden'); ph.classList.add('hidden'); };
  img.onerror = () => { img.classList.add('hidden'); ph.classList.remove('hidden'); };
  if (hero) {
    img.src = hero;
    if (img.complete) {
      img.classList.remove('hidden');
      ph.classList.add('hidden');
    }
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    ph.classList.remove('hidden');
  }
}

async function setSelectedGameHero(heroUrl) {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  game.heroUrl = String(heroUrl || '').trim();
  await save();
  renderSLHeroEditor(game);
  openGameDetail(selectedLibGameId);
  renderLibrary();
  openSLSettingsModal();
  toast(game.heroUrl ? 'Фон игры обновлён' : 'Фон игры сброшен', 'ok');
}

function renderSLOverview(list) {
  const headingEl = document.getElementById('sl-overview-heading');
  const summaryEl = document.getElementById('sl-overview-summary');
  const sectionsEl = document.getElementById('sl-overview-sections');
  if (!headingEl || !summaryEl || !sectionsEl) return;

  const visibleGames = Array.isArray(list) ? list : [];
  const totalGames = gamesList().length;
  const currentCollection = activeCollection ? store.collections[activeCollection] : null;
  const currentQuery = String(document.getElementById('sl-search')?.value || '').trim();
  const sortLabel = librarySortLabel(document.getElementById('sl-sort')?.value || 'recent');
  const activeSectionIds = getLibraryOverviewSectionIds();
  slOverviewArtworkQueue.length = 0;

  headingEl.textContent = currentCollection?.name || 'Мои игры';
  const summaryParts = [
    visibleGames.length === totalGames
      ? `${visibleGames.length} игр`
      : `${visibleGames.length} из ${totalGames} игр`,
    `Сортировка ${sortLabel}`,
  ];
  const platformLabel = libraryPlatformLabel(activePlatformFilter);
  if (platformLabel) summaryParts.push(`Платформа: ${platformLabel}`);
  if (currentQuery) summaryParts.push(`Поиск: ${currentQuery}`);
  summaryEl.textContent = summaryParts.join(' • ');
  renderSLOverviewControls(visibleGames, activeSectionIds);
  sectionsEl.innerHTML = '';
  if (!visibleGames.length) {
    const emptyTitle = totalGames
      ? 'Ничего не найдено'
      : 'Библиотека пока пустая';
    const emptyText = totalGames
      ? 'Попробуй изменить поиск или фильтры слева, и карточки снова появятся в обзоре.'
      : 'Добавь первую игру вручную или импортируй библиотеку Steam, и здесь появятся большие карточки как в Steam.';
    sectionsEl.innerHTML = `
      <div class="sl-overview-empty">
        <div class="sl-overview-empty-icon">🎮</div>
        <div class="sl-overview-empty-title">${emptyTitle}</div>
        <div class="sl-overview-empty-text">${emptyText}</div>
      </div>`;
    return;
  }

  if (!activeSectionIds.length) {
    sectionsEl.innerHTML = `
      <div class="sl-overview-empty">
        <div class="sl-overview-empty-icon">🗂</div>
        <div class="sl-overview-empty-title">Полки отключены</div>
        <div class="sl-overview-empty-text">Включи хотя бы один блок сверху или нажми «Сбросить», чтобы вернуть стандартный набор секций.</div>
      </div>`;
    return;
  }

  const sections = activeSectionIds
    .map(id => {
      const def = LIBRARY_OVERVIEW_SECTION_DEFS.find(section => section.id === id);
      if (!def) return null;
      const matches = getLibraryOverviewMatches(visibleGames, id);
      const limit = getLibraryOverviewLimit(id);
      const expanded = expandedLibraryOverviewSections.has(id);
      return {
        ...def,
        id,
        chip: `${matches.length} игр`,
        expanded,
        expandable: matches.length > limit,
        items: expanded ? matches : matches.slice(0, limit),
      };
    })
    .filter(Boolean);

  const fragment = document.createDocumentFragment();
  sections.forEach(section => {
    const block = document.createElement('section');
    block.className = 'sl-overview-section';
    block.innerHTML = `
      <div class="sl-overview-section-head">
        <div>
          <div class="sl-overview-section-title">${esc(section.title)}</div>
          <div class="sl-overview-section-note">${esc(section.note)}</div>
        </div>
        <div class="sl-overview-section-meta">
          <div class="sl-overview-section-chip">${esc(section.chip)}</div>
          ${section.expandable
            ? `<button class="sl-overview-expand" type="button" data-section-id="${esc(section.id)}" title="${section.expanded ? 'Свернуть' : 'Раскрыть'}" aria-label="${section.expanded ? 'Свернуть' : 'Раскрыть'}">${section.expanded ? '-' : '+'}</button>`
            : ''}
        </div>
      </div>`;
    if (section.items.length) {
      const grid = document.createElement('div');
      grid.className = 'sl-overview-grid';
      section.items.forEach(game => grid.appendChild(makeSLOverviewCard(game)));
      block.appendChild(grid);
    } else {
      const empty = document.createElement('div');
      empty.className = 'sl-overview-section-empty';
      empty.textContent = 'В этом блоке пока нет игр по текущим фильтрам.';
      block.appendChild(empty);
    }
    fragment.appendChild(block);
  });
  sectionsEl.appendChild(fragment);
}

async function fetchSteamArtworkForGame(gameId, appId) {
  const cleanAppId = String(appId || '').trim();
  if (!cleanAppId || !api.steamArtwork) return null;
  if (!steamArtworkCache.has(cleanAppId)) {
    steamArtworkCache.set(cleanAppId, api.steamArtwork(cleanAppId).catch(() => null));
  }

  const result = await steamArtworkCache.get(cleanAppId);
  const coverUrl = String(result?.coverUrl || '').trim();
  const posterUrl = String(result?.posterUrl || coverUrl || '').trim();
  if (!result?.ok || (!coverUrl && !posterUrl)) return null;

  const game = store.games?.[gameId];
  if (game) {
    let changed = false;
    if (coverUrl && game.coverUrl !== coverUrl) {
      game.coverUrl = coverUrl;
      game.img = coverUrl;
      changed = true;
    }
    if (posterUrl && game.posterUrl !== posterUrl) {
      game.posterUrl = posterUrl;
      changed = true;
    }
    if (changed) save().catch(() => {});
  }

  return { coverUrl, posterUrl };
}

function getSLOverviewArtworkObserver() {
  if (slOverviewArtworkObserver) return slOverviewArtworkObserver;
  const root = document.getElementById('sl-overview');
  if (!root || typeof IntersectionObserver === 'undefined') return null;

  slOverviewArtworkObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      enqueueSLOverviewArtwork(entry.target);
      slOverviewArtworkObserver?.unobserve(entry.target);
    });
  }, {
    root,
    rootMargin: '640px 0px',
    threshold: 0.01,
  });

  return slOverviewArtworkObserver;
}

function enqueueSLOverviewArtwork(card) {
  if (!card || card.dataset.artLoaded === '1' || card.dataset.artQueued === '1') return;
  card.dataset.artQueued = '1';
  slOverviewArtworkQueue.push(card);
  scheduleSLOverviewArtworkQueue();
}

function scheduleSLOverviewArtworkQueue() {
  if (slOverviewArtworkQueueScheduled) return;
  slOverviewArtworkQueueScheduled = true;
  const schedule = window.requestIdleCallback
    ? callback => window.requestIdleCallback(callback, { timeout: 180 })
    : callback => requestAnimationFrame(() => callback({ timeRemaining: () => 8 }));
  schedule(processSLOverviewArtworkQueue);
}

function processSLOverviewArtworkQueue(deadline) {
  slOverviewArtworkQueueScheduled = false;
  let loaded = 0;
  while (
    slOverviewArtworkQueue.length
    && loaded < 3
    && (!deadline?.timeRemaining || deadline.timeRemaining() > 2)
  ) {
    const card = slOverviewArtworkQueue.shift();
    if (!card?.isConnected || card.dataset.artLoaded === '1') continue;
    delete card.dataset.artQueued;
    loadSLOverviewArtwork(card);
    loaded++;
  }
  if (slOverviewArtworkQueue.length) scheduleSLOverviewArtworkQueue();
}

function loadSLOverviewArtwork(card) {
  if (!card || card.dataset.artLoaded === '1') return;
  card.dataset.artLoaded = '1';

  const posterEl = card.querySelector('.sl-overview-poster');
  const placeholderEl = card.querySelector('.sl-overview-poster-fallback');
  const backdropEl = card.querySelector('.sl-overview-art-backdrop');
  if (!posterEl || !placeholderEl || !backdropEl) return;

  const primaryArt = card.dataset.primaryArt || '';
  const fallbackArt = card.dataset.fallbackArt || '';
  let fallbackTried = !fallbackArt || fallbackArt === primaryArt;
  let remoteArtworkTried = false;

  const setBackdrop = src => {
    backdropEl.style.backgroundImage = src ? `url("${src}")` : 'none';
  };
  const setArtMode = () => {
    const width = posterEl.naturalWidth || 0;
    const height = posterEl.naturalHeight || 0;
    const isPoster = height >= width * 1.32;
    card.classList.toggle('is-framed', !isPoster);
  };
  const finishLoading = () => card.classList.remove('is-loading');

  posterEl.decoding = 'async';

  posterEl.onload = () => {
    posterEl.classList.remove('hidden');
    setArtMode();
    placeholderEl.classList.add('hidden');
    finishLoading();
  };
  posterEl.onerror = async () => {
    if (!fallbackTried && fallbackArt) {
      fallbackTried = true;
      card.classList.add('is-framed');
      setBackdrop(fallbackArt);
      posterEl.src = fallbackArt;
      return;
    }
    if (!remoteArtworkTried && card.dataset.appId) {
      remoteArtworkTried = true;
      const artwork = await fetchSteamArtworkForGame(card.dataset.gameId, card.dataset.appId);
      const nextArt = artwork?.posterUrl || artwork?.coverUrl || '';
      if (nextArt && nextArt !== posterEl.src) {
        setBackdrop(nextArt);
        posterEl.src = nextArt;
        return;
      }
    }
    setBackdrop('');
    posterEl.classList.add('hidden');
    placeholderEl.classList.remove('hidden');
    card.classList.add('is-framed');
    finishLoading();
  };

  if (primaryArt) {
    setBackdrop(primaryArt);
    posterEl.src = primaryArt;
  } else if (fallbackArt) {
    fallbackTried = true;
    setBackdrop(fallbackArt);
    posterEl.src = fallbackArt;
  } else {
    setBackdrop('');
    posterEl.classList.add('hidden');
    placeholderEl.classList.remove('hidden');
    card.classList.add('is-framed');
    finishLoading();
  }
}

function makeSLOverviewCard(game) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'sl-overview-card is-loading';
  card.dataset.gameId = game.id;
  card.dataset.appId = getAchievementAppId(game);
  card.title = game.title || '';
  card.setAttribute('aria-label', game.title || 'Игра');

  const statusLabel = STATUS_LABELS[game.status] || '';
  const unlocked = game.achievementsUnlocked || 0;
  const total = game.achievementsTotal || 0;
  const tierInfo = getGameTierInfo(game.id);
  const tierBadge = tierInfo
    ? `<div class="sl-overview-tier" style="--tier-color:${esc(tierInfo.color)}" title="Тир ${esc(tierInfo.label)}">${esc(tierInfo.shortLabel)}</div>`
    : '';
  const hoursText = `${fmtH(game.hoursPlayed || 0)} ч.`;
  const ratingText = game.rating ? `★ ${game.rating}` : '';

  card.innerHTML = `
    <div class="sl-overview-art">
      <div class="sl-overview-art-backdrop"></div>
      <img class="sl-overview-poster hidden" alt="" />
      <div class="sl-overview-poster-fallback">
        <span class="sl-overview-fallback-icon">🎮</span>
        <span class="sl-overview-fallback-title">${esc(game.title || 'Игра')}</span>
      </div>
      <div class="sl-overview-title-overlay">${esc(game.title || 'РРіСЂР°')}</div>
      ${tierBadge}
      ${statusLabel ? `<div class="sl-overview-status">${esc(statusLabel)}</div>` : ''}
      ${ratingText ? `<div class="sl-overview-rating">${esc(ratingText)}</div>` : ''}
      <div class="sl-overview-badges">
        <div class="sl-overview-badge">${hoursText}</div>
        ${total ? `<div class="sl-overview-badge ach">🏆 ${unlocked}/${total}</div>` : ''}
      </div>
    </div>`;

  const posterEl = card.querySelector('.sl-overview-poster');
  const placeholderEl = card.querySelector('.sl-overview-poster-fallback');
  const primaryArt = gamePoster(game);
  const fallbackArt = gameCover(game);
  card.dataset.primaryArt = primaryArt || '';
  card.dataset.fallbackArt = fallbackArt || '';

  // Ambient Background Events for Library
  card.addEventListener('mouseenter', () => {
    if (primaryArt || fallbackArt) {
      setAmbientBackground(primaryArt || fallbackArt);
    }
  });
  card.addEventListener('mouseleave', () => {
    clearAmbientBackground();
  });
  card.dataset.fallbackArt = fallbackArt || '';
  posterEl.classList.add('hidden');
  placeholderEl.classList.remove('hidden');

  const observer = getSLOverviewArtworkObserver();
  if (observer) observer.observe(card);
  else enqueueSLOverviewArtwork(card);

  card.addEventListener('click', () => openGameDetail(game.id));
  card.addEventListener('contextmenu', e => openGameStatusMenu(e, game.id));
  return card;
}

const slMediaCache = new Map();
let slMediaRenderToken = 0;
let slMediaItems = [];
let slMediaIndex = 0;

function normalizeMediaUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) return '';
  return url.startsWith('http://') ? `https://${url.slice(7)}` : url;
}

function normalizeSLMediaItem(item = {}, idx = 0) {
  const type = item.type === 'video' ? 'video' : 'image';
  const mp4 = normalizeMediaUrl(item.mp4);
  const webm = normalizeMediaUrl(item.webm);
  const thumb = normalizeMediaUrl(item.thumb || item.thumbnail || item.full || item.url || '');
  const full = normalizeMediaUrl(item.full || item.url || thumb);
  if (type === 'video' && !mp4 && !webm) return null;
  if (!thumb && !full) return null;
  return {
    id: String(item.id || `${type}_${idx}`),
    type,
    title: String(item.title || (type === 'video' ? 'Видео' : 'Снимок экрана')).trim(),
    thumb: thumb || full,
    full: full || thumb,
    mp4,
    webm,
    source: String(item.source || '').trim(),
    screenshotId: String(item.screenshotId || '').trim(),
  };
}

async function customSLMediaItems(game = {}) {
  let screenshots = Array.isArray(game.screenshots) ? game.screenshots : [];
  if (!screenshots.length) return [];

  if (api.screenshotsResolve) {
    const resolved = await api.screenshotsResolve({ gameId: game.id, screenshots });
    if (resolved?.ok && Array.isArray(resolved.screenshots)) {
      game.screenshots = resolved.screenshots.map(normalizeScreenshot);
      screenshots = game.screenshots;
    }
  }

  return screenshots
    .map((shot, idx) => normalizeSLMediaItem({
      id: `custom_${shot.id || idx}`,
      type: 'image',
      title: shot.title || `Скриншот ${idx + 1}`,
      thumb: shot.url,
      full: shot.url,
      source: 'custom',
      screenshotId: shot.id,
    }, idx))
    .filter(Boolean);
}

function fallbackSLMediaItems(game = {}) {
  const appId = getAchievementAppId(game);
  const urls = [
    gamePoster(game),
    gameCover(game),
    ...steamImages(appId),
  ].filter(Boolean);
  const seen = new Set();
  return urls
    .filter(url => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((url, idx) => normalizeSLMediaItem({
      id: `fallback_${idx}`,
      type: 'image',
      title: idx === 0 ? 'Обложка' : 'Изображение',
      thumb: url,
      full: url,
    }, idx))
    .filter(Boolean);
}

async function getSLMediaItems(game = {}) {
  const customItems = await customSLMediaItems(game);
  if (customItems.length) return customItems;

  const appId = getAchievementAppId(game);
  const cacheKey = appId || `local:${game.id || game.title || ''}`;
  if (slMediaCache.has(cacheKey)) return slMediaCache.get(cacheKey);

  let items = [];
  if (appId && api.steamMedia) {
    try {
      const result = await api.steamMedia(appId);
      if (result?.ok && Array.isArray(result.media)) {
        items = result.media
          .map(normalizeSLMediaItem)
          .filter(Boolean);
      }
    } catch (err) {
      console.warn('Steam media fetch failed', err);
    }
  }

  if (!items.length) {
    items = fallbackSLMediaItems(game);
  }

  const seen = new Set();
  const uniqueItems = items.filter(item => {
    const key = `${item.type}:${item.full || item.thumb}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  slMediaCache.set(cacheKey, uniqueItems);
  return uniqueItems;
}

function renderSLMediaSkeleton() {
  const section = document.getElementById('sl-media-section');
  const strip = document.getElementById('sl-media-strip');
  if (!section || !strip) return;
  section.classList.remove('hidden');
  section.classList.add('is-loading');
  updateSLMediaActions();
  strip.innerHTML = Array.from({ length: 4 }, () => '<div class="sl-media-skeleton"></div>').join('');
}

function updateSLMediaActions() {
  const addBtn = document.getElementById('sl-media-add');
  const syncBtn = document.getElementById('sl-media-sync');
  if (addBtn) addBtn.disabled = !selectedLibGameId;
  if (syncBtn) {
    syncBtn.classList.toggle('is-disabled', !driveConnected);
    syncBtn.title = driveConnected
      ? 'Синхронизировать скриншоты с Google Drive'
      : 'Подключи Google Drive в настройках';
  }
}

function renderSLMediaStrip(items = []) {
  const section = document.getElementById('sl-media-section');
  const strip = document.getElementById('sl-media-strip');
  if (!section || !strip) return;

  section.classList.remove('hidden');
  section.classList.remove('is-loading');
  updateSLMediaActions();
  if (!items.length) {
    strip.innerHTML = `
      <button class="sl-media-empty" type="button" id="sl-media-empty-add">
        <span>+ Добавить первый скриншот</span>
        <small>Картинки сохранятся локально и смогут уйти в Drive</small>
      </button>
    `;
    document.getElementById('sl-media-empty-add')?.addEventListener('click', addScreenshotsToSelectedGame);
    return;
  }

  strip.innerHTML = items.map((item, idx) => `
    <button class="sl-media-thumb ${item.source === 'custom' ? 'is-custom' : ''}" type="button" data-index="${idx}" aria-label="${esc(item.title)}">
      <img src="${esc(item.thumb || item.full)}" alt="" loading="lazy" />
      ${item.type === 'video' ? '<span class="sl-media-play">▶</span>' : ''}
      ${idx === 0 && item.type === 'video' ? '<span class="sl-media-age">18</span>' : ''}
      ${item.source === 'custom' ? `<span class="sl-media-remove" data-shot-id="${esc(item.screenshotId)}" title="Убрать скриншот">×</span>` : ''}
    </button>
  `).join('');

  strip.querySelectorAll('.sl-media-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      removeCustomScreenshot(btn.dataset.shotId);
    });
  });

  strip.querySelectorAll('.sl-media-thumb').forEach(btn => {
    btn.addEventListener('click', () => openSLMediaModal(Number(btn.dataset.index) || 0));
  });
}

async function renderSLMediaSection(game = {}) {
  const token = ++slMediaRenderToken;
  renderSLMediaSkeleton();
  const items = await getSLMediaItems(game);
  if (token !== slMediaRenderToken) return;
  slMediaItems = items;
  renderSLMediaStrip(items);
}

function renderSLMediaModal() {
  const modal = document.getElementById('sl-media-modal');
  const stage = document.getElementById('sl-media-stage');
  const titleEl = document.getElementById('sl-media-modal-title');
  const countEl = document.getElementById('sl-media-modal-count');
  const thumbsEl = document.getElementById('sl-media-modal-thumbs');
  if (!modal || !stage || !titleEl || !countEl || !thumbsEl || !slMediaItems.length) return;

  slMediaIndex = Math.max(0, Math.min(slMediaIndex, slMediaItems.length - 1));
  const item = slMediaItems[slMediaIndex];
  const safeTitle = esc(item.title || (item.type === 'video' ? 'Видео' : 'Снимок экрана'));
  const videoSrc = item.mp4 || item.webm || item.full;

  stage.innerHTML = item.type === 'video'
    ? `<video src="${esc(videoSrc)}" poster="${esc(item.thumb || '')}" controls autoplay playsinline></video>`
    : `<img src="${esc(item.full || item.thumb)}" alt="${safeTitle}" />`;
  titleEl.textContent = item.title || (item.type === 'video' ? 'Видео' : 'Снимок экрана');
  countEl.textContent = `${slMediaIndex + 1} / ${slMediaItems.length}`;

  thumbsEl.innerHTML = slMediaItems.map((mediaItem, idx) => `
    <button class="sl-media-modal-thumb ${idx === slMediaIndex ? 'active' : ''}" type="button" data-index="${idx}" aria-label="${esc(mediaItem.title)}">
      <img src="${esc(mediaItem.thumb || mediaItem.full)}" alt="" loading="lazy" />
      ${mediaItem.type === 'video' ? '<span class="sl-media-play">▶</span>' : ''}
    </button>
  `).join('');

  thumbsEl.querySelectorAll('.sl-media-modal-thumb').forEach(btn => {
    btn.addEventListener('click', () => {
      slMediaIndex = Number(btn.dataset.index) || 0;
      renderSLMediaModal();
    });
  });

  thumbsEl.querySelector('.sl-media-modal-thumb.active')?.scrollIntoView({
    block: 'nearest',
    inline: 'center',
    behavior: 'smooth',
  });
}

function openSLMediaModal(idx = 0) {
  if (!slMediaItems.length) return;
  slMediaIndex = Math.max(0, Math.min(idx, slMediaItems.length - 1));
  document.getElementById('sl-media-modal')?.classList.remove('hidden');
  renderSLMediaModal();
}

function closeSLMediaModal() {
  const modal = document.getElementById('sl-media-modal');
  const stage = document.getElementById('sl-media-stage');
  modal?.classList.add('hidden');
  if (stage) stage.innerHTML = '';
}

function stepSLMediaModal(delta) {
  if (!slMediaItems.length) return;
  slMediaIndex = (slMediaIndex + delta + slMediaItems.length) % slMediaItems.length;
  renderSLMediaModal();
}

async function addScreenshotsToSelectedGame() {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  const result = await api.screenshotsAdd?.({ gameId: selectedLibGameId, gameTitle: game.title });
  if (!result?.ok) {
    if (!result?.canceled) toast(result?.error || 'Не удалось добавить скриншоты', 'err');
    return;
  }
  const added = (result.screenshots || []).map(normalizeScreenshot);
  if (!added.length) {
    toast('Не нашёл подходящих изображений', 'err');
    return;
  }

  game.screenshots = mergeScreenshotLists(game.screenshots, added);
  await persistStoreOnly();
  renderSLMediaSection(game);
  toast(`Добавлено скриншотов: ${added.length}`, 'ok');

  if (driveConnected) {
    await uploadScreenshotsToDrive({ silent: true });
  }
}

async function removeCustomScreenshot(shotId) {
  if (!selectedLibGameId || !shotId) return;
  const game = store.games[selectedLibGameId];
  if (!game?.screenshots?.length) return;
  const shot = game.screenshots.find(item => item.id === shotId);
  if (!shot) return;
  if (!confirm('Убрать этот скриншот из карточки? Локальный файл тоже будет удалён.')) return;

  game.screenshots = game.screenshots.filter(item => item.id !== shotId);
  await api.screenshotsDeleteLocal?.({ localPath: shot.localPath });
  await persistStoreOnly();
  closeSLMediaModal();
  renderSLMediaSection(game);
  toast('Скриншот убран', 'ok');
  if (driveConnected) {
    await uploadScreenshotsToDrive({ silent: true });
  }
}

document.getElementById('sl-media-prev')?.addEventListener('click', () => {
  const strip = document.getElementById('sl-media-strip');
  strip?.scrollBy({ left: -Math.max(280, strip.clientWidth * .82), behavior: 'smooth' });
});
document.getElementById('sl-media-next')?.addEventListener('click', () => {
  const strip = document.getElementById('sl-media-strip');
  strip?.scrollBy({ left: Math.max(280, strip.clientWidth * .82), behavior: 'smooth' });
});
document.getElementById('sl-media-see-all')?.addEventListener('click', () => openSLMediaModal(0));
document.getElementById('sl-media-add')?.addEventListener('click', addScreenshotsToSelectedGame);
document.getElementById('sl-media-sync')?.addEventListener('click', async () => {
  await downloadScreenshotsFromDrive({ silent: true });
  await uploadScreenshotsToDrive({ silent: false });
});
document.getElementById('sl-media-modal-bg')?.addEventListener('click', closeSLMediaModal);
document.getElementById('sl-media-modal-close')?.addEventListener('click', closeSLMediaModal);
document.getElementById('sl-media-modal-prev')?.addEventListener('click', () => stepSLMediaModal(-1));
document.getElementById('sl-media-modal-next')?.addEventListener('click', () => stepSLMediaModal(1));
document.addEventListener('keydown', e => {
  const modal = document.getElementById('sl-media-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeSLMediaModal();
  if (e.key === 'ArrowLeft') stepSLMediaModal(-1);
  if (e.key === 'ArrowRight') stepSLMediaModal(1);
});

function openGameDetail(gameId) {
  const isSameGame = selectedLibGameId === gameId;
  selectedLibGameId = gameId;
  const game = store.games[gameId];
  if (!game) return;

  document.querySelectorAll('.sl-game-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === gameId)
  );

  document.getElementById('sl-overview').classList.add('hidden');
  const detailEl = document.getElementById('sl-detail');
  detailEl.classList.remove('hidden');
  document.getElementById('sl-ach-modal').classList.add('hidden');
  closeModal('modal-sl-settings');
  if (!isSameGame) detailEl.scrollTop = 0;
  updateLibraryDetailScrollState();

  updateLibraryHero(game);
  document.getElementById('sl-game-title').textContent = game.title;
  renderSLMiniHeader(game);
  renderSLHeroRecentAchievements(game);

  document.querySelectorAll('.sl-status-pill').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.status === (game.status || ''))
  );

  updateSLRatingDisplay(game.rating || 0);
  document.getElementById('sl-save-path-val').textContent = game.savePath || 'Папка не задана';

  document.getElementById('sl-last-played').textContent = game.lastPlayedAt
    ? new Date(game.lastPlayedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Никогда';
  document.getElementById('sl-hours-played').textContent = fmtH(game.hoursPlayed || 0) + ' ч.';
  document.getElementById('sl-notes').value = game.notes || '';
  renderSLNotesMeta(game);

  const achTotal = game.achievementsTotal || 0;
  const achUnlocked = game.achievementsUnlocked || 0;
  const achStatEl = document.getElementById('sl-astat-ach');
  if (achTotal > 0) {
    document.getElementById('sl-ach-count').textContent = `${achUnlocked} / ${achTotal}`;
    document.getElementById('sl-ach-mini-fill').style.width =
      Math.round(achUnlocked / achTotal * 100) + '%';
    achStatEl.classList.remove('hidden');
  } else {
    achStatEl.classList.add('hidden');
  }

  document.getElementById('sl-sessions-list').innerHTML = renderGameActivityTimeline(game);
  renderSLMediaSection(game);

  const achPanel = document.getElementById('sl-ach-panel');
  if (achTotal > 0) {
    achPanel.style.display = '';
    const rareUnlockedCount = (game.achievements || []).filter(a => a.achieved && isRareAchievement(a)).length;
    document.getElementById('sl-ach-summary').textContent =
      `${achUnlocked} из ${achTotal} (${Math.round(achUnlocked / achTotal * 100)}%)${rareUnlockedCount ? ` • редких: ${rareUnlockedCount}` : ''}`;
    document.getElementById('sl-ach-bar-fill').style.width =
      Math.round(achUnlocked / achTotal * 100) + '%';

    const rareWrap = document.getElementById('sl-rare-wrap');
    const rareList = document.getElementById('sl-rare-list');
    const rareCount = document.getElementById('sl-rare-count');
    const rareShowcase = [...(game.achievements || [])]
      .filter(a => achievementPercent(a) !== null)
      .sort((a, b) => {
        const aPct = achievementPercent(a);
        const bPct = achievementPercent(b);
        if (aPct !== bPct) return aPct - bPct;
        return (b.achieved || 0) - (a.achieved || 0);
      })
      .slice(0, 3);
    if (rareShowcase.length) {
      rareWrap.classList.remove('hidden');
      rareCount.textContent = rareUnlockedCount ? `${rareUnlockedCount} получено` : 'по редкости';
      rareList.innerHTML = rareShowcase.map(a => {
        const name = esc(safeAchName(a.displayName, a.apiname));
        const percentText = achievementRarityText(a);
        const icon = a.achieved ? (a.icon || a.iconGray || '') : (a.iconGray || a.icon || '');
        return `<div class="sl-rare-item ${a.achieved ? 'unlocked' : 'locked'}">
          ${icon
            ? `<img class="sl-rare-icon${a.achieved ? '' : ' locked'}" src="${esc(icon)}" alt=""/>`
            : '<div class="sl-locked-icon-ph">🏆</div>'}
          <div class="sl-rare-info">
            <div class="sl-rare-name">${name}</div>
            <div class="sl-rare-meta">
              ${isRareAchievement(a) ? '<span class="sl-rare-badge">Редкое</span>' : ''}
              ${percentText ? `<span class="sl-rare-percent">${percentText}</span>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');
    } else {
      rareWrap.classList.add('hidden');
      rareList.innerHTML = '';
      rareCount.textContent = '';
    }

    const iconsRow = document.getElementById('sl-ach-icons-row');
    const unlocked = [...(game.achievements || [])]
      .filter(a => a.achieved && (a.icon || a.iconGray))
      .sort(sortAchievementsByRarity);
    iconsRow.innerHTML = unlocked.slice(0, 10).map(a =>
      `<img class="sl-ach-icon" src="${esc(a.icon || a.iconGray || '')}" title="${esc(safeAchName(a.displayName, a.apiname))}" alt=""/>`
    ).join('');

    const lockedList = document.getElementById('sl-locked-ach-list');
    const locked = [...(game.achievements || [])]
      .filter(a => !a.achieved)
      .sort(sortAchievementsByRarity)
      .slice(0, 6);
    lockedList.innerHTML = locked.map(a => {
      const name = esc(safeAchName(a.displayName, a.apiname));
      const desc = esc(a.description || '');
      const percentText = achievementRarityText(a);
      return `<div class="sl-locked-item">
        ${a.iconGray
          ? `<img class="sl-locked-icon" src="${esc(a.iconGray)}" alt=""/>`
          : '<div class="sl-locked-icon-ph">🔒</div>'}
        <div class="sl-locked-info">
          <div class="sl-locked-name">${name}</div>
          ${desc ? `<div class="sl-locked-desc">${desc}</div>` : ''}
          ${percentText ? `<div class="sl-locked-desc">${percentText}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  } else {
    achPanel.style.display = 'none';
  }
}

// ── Library inline action handlers ────────────────────
async function hideGameFromLibrary(gameId) {
  const game = store.games?.[gameId];
  if (!game) return false;

  if (activeSession?.gameId === gameId) stopSession();
  game.hidden = true;
  store.tierList = normalizeTierList(store.tierList, store.games);
  if (tierSelectedGameId === gameId) tierSelectedGameId = '';

  if (selectedLibGameId === gameId) {
    selectedLibGameId = null;
    document.getElementById('sl-detail')?.classList.add('hidden');
    document.getElementById('sl-overview')?.classList.remove('hidden');
  }
  if (openedGameId === gameId) openedGameId = null;

  closeModal('modal-sl-settings');
  closeModal('modal-game');
  await save();
  renderAll();
  renderSettingsView();
  toast(`«${game.title}» скрыта из библиотеки`, 'ok');
  return true;
}

async function unhideGameFromLibrary(gameId) {
  const game = store.games?.[gameId];
  if (!game) return false;

  delete game.hidden;
  store.tierList = normalizeTierList(store.tierList, store.games);
  await save();
  renderAll();
  renderSettingsView();
  toast(`«${game.title}» вернулась в библиотеку`, 'ok');
  return true;
}

document.getElementById('sl-play-btn').addEventListener('click', () => {
  if (!selectedLibGameId) return;
  launchGameFromLauncher(selectedLibGameId);
});

document.getElementById('sl-hide-btn')?.addEventListener('click', () => {
  if (!selectedLibGameId) return;
  hideGameFromLibrary(selectedLibGameId);
});

document.getElementById('sl-delete-btn').addEventListener('click', () => {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  if (!confirm(`Удалить «${game.title}»?`)) return;
  if (activeSession?.gameId === selectedLibGameId) stopSession();
  delete store.games[selectedLibGameId];
  selectedLibGameId = null;
  document.getElementById('sl-detail').classList.add('hidden');
  document.getElementById('sl-overview').classList.remove('hidden');
  closeModal('modal-sl-settings');
  save(); renderAll();
  toast(`«${game.title}» удалена`, 'ok');
});

// ── Rating display helper ──────────────────────────────
function updateSLRatingDisplay(rating) {
  const valEl = document.getElementById('sl-rating-val');
  if (rating) {
    valEl.textContent = rating;
    valEl.classList.remove('unrated');
  } else {
    valEl.textContent = '—';
    valEl.classList.add('unrated');
  }
  document.querySelectorAll('.sl-rpick-btn').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.val) === rating)
  );
}

// Rating popup toggle
document.getElementById('sl-rating-display').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('sl-rating-popup').classList.toggle('hidden');
});

// Rating picker selection
document.getElementById('sl-rating-popup').addEventListener('click', async e => {
  const btn = e.target.closest('.sl-rpick-btn, .sl-rpick-clear');
  if (!btn || !selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  game.rating = Number(btn.dataset.val) || 0;
  updateSLRatingDisplay(game.rating);
  document.getElementById('sl-rating-popup').classList.add('hidden');
  await save();
  filterAndSort();
});

// Status
document.getElementById('sl-hero-status').addEventListener('click', async e => {
  const btn = e.target.closest('.sl-status-pill');
  if (!btn || !selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  const val = btn.dataset.status;
  game.status = game.status === val ? null : val;
  document.querySelectorAll('.sl-status-pill').forEach(b =>
    b.classList.toggle('active', b.dataset.status === (game.status || ''))
  );
  await save();
  filterAndSort();
});

// Gear button
document.getElementById('sl-gear-btn').addEventListener('click', e => {
  e.stopPropagation();
  openSLSettingsModal();
});

// Close floating popups on outside click
document.addEventListener('click', () => {
  document.getElementById('sl-rating-popup')?.classList.add('hidden');
});

// Achievements via gear panel
document.getElementById('sl-btn-ach-online').addEventListener('click', async () => {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  const appid = getAchievementAppId(game);
  if (!appid) { toast('Нет Steam AppID', 'err'); return; }
  document.getElementById('sl-gear-status').textContent = '⏳ Загружаю…';
  const apiKey = store.settings.steamApiKey;
  const steamId = store.settings.steamId;
  try {
    const res = await api.steamGetAchievements({ appid, apiKey, steamId });
    if (res?.achievements) {
      applyAchievementUpdate(game, res.achievements);
      await save(); openGameDetail(selectedLibGameId);
      toast('Достижения загружены', 'ok');
    } else toast(res?.error || 'Ошибка загрузки', 'err');
  } catch { toast('Ошибка подключения к Steam', 'err'); }
});

document.getElementById('sl-btn-ach-local').addEventListener('click', async () => {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  const appid = getAchievementAppId(game);
  if (!appid) { toast('Нет Steam AppID', 'err'); return; }
  const steamPath = store.settings.steamPath;
  const steamId   = store.settings.steamId;
  const apiKey    = store.settings.steamApiKey;
  try {
    const res = await api.steamLocalAchievements({ appid, steamPath, steamId, apiKey });
    if (res?.achievements) {
      applyAchievementUpdate(game, res.achievements);
      await save(); openGameDetail(selectedLibGameId);
      toast('Достижения загружены из кеша', 'ok');
    } else toast(res?.error || 'Нет кеша', 'err');
  } catch { toast('Ошибка', 'err'); }
});

document.getElementById('sl-btn-pick-poster')?.addEventListener('click', async e => {
  e.stopPropagation();
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  const btn = document.getElementById('sl-btn-pick-poster');
  btn.disabled = true;
  try {
    const res = await api.pickPoster?.({ gameId: selectedLibGameId, gameTitle: game.title });
    if (res?.canceled) return;
    if (!res?.ok || !res.posterUrl) {
      toast(res?.error || 'Не удалось выбрать постер', 'err');
      return;
    }
    await setSelectedGamePoster(res.posterUrl);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('sl-poster-url')?.addEventListener('change', async e => {
  await setSelectedGamePoster(e.target.value);
});

document.getElementById('sl-btn-reset-poster')?.addEventListener('click', async e => {
  e.stopPropagation();
  await setSelectedGamePoster('');
});

document.getElementById('sl-btn-pick-hero')?.addEventListener('click', async e => {
  e.stopPropagation();
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  const btn = document.getElementById('sl-btn-pick-hero');
  btn.disabled = true;
  try {
    const res = await api.pickPoster?.({ gameId: selectedLibGameId, gameTitle: game.title });
    if (res?.canceled) return;
    if (!res?.ok || !res.posterUrl) {
      toast(res?.error || 'Не удалось выбрать фон', 'err');
      return;
    }
    await setSelectedGameHero(res.posterUrl);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('sl-hero-url')?.addEventListener('change', async e => {
  await setSelectedGameHero(e.target.value);
});

document.getElementById('sl-btn-reset-hero')?.addEventListener('click', async e => {
  e.stopPropagation();
  await setSelectedGameHero('');
});

document.getElementById('sl-btn-upload-save').addEventListener('click', async () => {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game?.savePath) { toast('Папка сохранений не задана', 'err'); return; }
  const res = await api.driveUploadSave({ gameId: selectedLibGameId, savePath: game.savePath });
  if (res?.ok) {
    game.saveLastSync = res.time; await save();
    toast('Сохранение загружено в Drive', 'ok');
  } else toast(res?.error || 'Ошибка загрузки', 'err');
});

document.getElementById('sl-btn-download-save').addEventListener('click', async () => {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game?.savePath) { toast('Папка сохранений не задана', 'err'); return; }
  const res = await api.driveDownloadSave({ gameId: selectedLibGameId, savePath: game.savePath });
  if (res?.ok) toast('Сохранение восстановлено', 'ok');
  else toast(res?.error || 'Ошибка восстановления', 'err');
});

document.getElementById('sl-btn-pick-save').addEventListener('click', async e => {
  e.stopPropagation();
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  const folder = await api.drivePickFolder();
  if (!folder) return;
  game.savePath = folder;
  document.getElementById('sl-save-path-val').textContent = folder;
  await save();
  toast('Папка сохранена', 'ok');
});

document.getElementById('sl-btn-pick-launch').addEventListener('click', async e => {
  e.stopPropagation();
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  const filePath = await api.pickExecutable();
  if (!filePath) return;
  game.launchPath = filePath;
  document.getElementById('sl-launch-path-val').textContent = filePath;
  await save();
  toast('Файл запуска сохранён', 'ok');
});

document.getElementById('sl-btn-save-local-link').addEventListener('click', async () => {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  const appid = String(document.getElementById('sl-steam-appid').value || '').trim();
  if (appid) {
    game.steamAppId = appid;
  } else {
    delete game.steamAppId;
  }
  const steamSyncDisabledEl = document.getElementById('sl-steam-sync-disabled');
  game.steamSyncDisabled = !!steamSyncDisabledEl?.checked;
  await save();
  openGameDetail(selectedLibGameId);
  document.getElementById('sl-gear-status').textContent = appid
    ? 'Локальная связка сохранена'
    : 'Steam AppID очищен';
  toast('Локальная связка обновлена', 'ok');
});

document.getElementById('sl-btn-clear-local-link').addEventListener('click', async () => {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;

  delete game.launchPath;
  delete game.steamAppId;
  game.steamSyncDisabled = false;

  document.getElementById('sl-launch-path-val').textContent = 'Исполняемый файл не задан';
  document.getElementById('sl-steam-appid').value = String(game.appid || '');
  const steamSyncDisabledEl = document.getElementById('sl-steam-sync-disabled');
  if (steamSyncDisabledEl) steamSyncDisabledEl.checked = false;

  await save();
  openGameDetail(selectedLibGameId);
  document.getElementById('sl-gear-status').textContent = 'Steam-синхронизация включена, локальный запуск очищен';
  toast('Игра снова синхронизируется со Steam', 'ok');
});

document.getElementById('sl-btn-save-notes').addEventListener('click', async () => {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game) return;
  game.notes = document.getElementById('sl-notes').value;
  game.notesUpdatedAt = new Date().toISOString();
  renderSLNotesMeta(game);
  await save();
  filterAndSort();
  toast('Заметки сохранены', 'ok');
});

// ── Achievements popup ─────────────────────────────────
let achModalFilter = 'all';
let achModalSearch = '';
let achModalSort = 'recent';

function sortAchievementsForModal(a, b) {
  if (achModalSort === 'alpha') {
    return safeAchName(a.displayName, a.apiname)
      .localeCompare(safeAchName(b.displayName, b.apiname), 'ru');
  }

  if (achModalSort === 'rarity') {
    return sortAchievementsByRarity(a, b);
  }

  if (achModalSort === 'locked') {
    const lockedDiff = (a.achieved || 0) - (b.achieved || 0);
    if (lockedDiff) return lockedDiff;
    return sortAchievementsByRarity(a, b);
  }

  const unlockedDiff = (b.achieved || 0) - (a.achieved || 0);
  if (unlockedDiff) return unlockedDiff;

  const aTime = Number(a.unlocktime) || 0;
  const bTime = Number(b.unlocktime) || 0;
  if (aTime !== bTime) return bTime - aTime;

  return sortAchievementsByRarity(a, b);
}

function openSLAchModal() {
  if (!selectedLibGameId) return;
  const game = store.games[selectedLibGameId];
  if (!game || !(game.achievements?.length)) {
    toast('Достижений нет — загрузи их через ⚙', 'err'); return;
  }

  const total = game.achievementsTotal || game.achievements?.length || 0;
  const unlocked = game.achievementsUnlocked || 0;
  const percent = total ? Math.round(unlocked / total * 100) : 0;
  const heroSrc =
    document.getElementById('sl-hero-backdrop')?.getAttribute('src') ||
    document.getElementById('sl-hero-img')?.getAttribute('src') ||
    gameCover(game) ||
    '';
  const iconSrc = gameCover(game) || heroSrc;

  document.getElementById('sl-ach-modal-title').textContent = game.title;
  document.getElementById('sl-ach-modal-subtitle').textContent =
    `${unlocked} из ${total} достижений`;
  document.getElementById('sl-ach-modal-progress-label').textContent =
    `Получено ${unlocked} из ${total} достижений`;
  document.getElementById('sl-ach-modal-progress-pct').textContent = `(${percent}%)`;
  document.getElementById('sl-ach-modal-progress-fill').style.width = `${percent}%`;

  const heroBg = document.getElementById('sl-ach-modal-hero-bg');
  heroBg.style.backgroundImage = heroSrc ? `url("${heroSrc}")` : 'none';

  const iconEl = document.getElementById('sl-ach-modal-game-icon');
  const iconPh = document.getElementById('sl-ach-modal-game-icon-ph');
  iconEl.onerror = () => {
    iconEl.classList.add('hidden');
    iconPh.classList.remove('hidden');
  };
  if (iconSrc) {
    iconEl.src = iconSrc;
    iconEl.classList.remove('hidden');
    iconPh.classList.add('hidden');
  } else {
    iconEl.removeAttribute('src');
    iconEl.classList.add('hidden');
    iconPh.classList.remove('hidden');
  }

  achModalFilter = 'all';
  achModalSearch = '';
  achModalSort = 'recent';
  document.getElementById('sl-ach-modal-search').value = '';
  document.getElementById('sl-ach-modal-sort').value = 'recent';
  document.querySelectorAll('.sl-ach-mf').forEach(b => b.classList.toggle('active', b.dataset.mf === 'all'));
  renderSLAchModalList(game);
  document.getElementById('sl-ach-modal').classList.remove('hidden');
}

function renderSLAchModalList(game) {
  const list = document.getElementById('sl-ach-modal-list');
  let achs = [...(game.achievements || [])].sort(sortAchievementsForModal);
  if (achModalFilter === 'unlocked') achs = achs.filter(a => a.achieved);
  if (achModalFilter === 'locked') achs = achs.filter(a => !a.achieved);
  if (achModalFilter === 'rare') achs = achs.filter(a => isRareAchievement(a));
  if (achModalSearch) {
    const search = achModalSearch.toLowerCase();
    achs = achs.filter(a => {
      const name = safeAchName(a.displayName, a.apiname).toLowerCase();
      const desc = String(a.description || '').toLowerCase();
      return name.includes(search) || desc.includes(search);
    });
  }
  if (!achs.length) {
    list.innerHTML = '<div class="sl-ach-modal-empty">Ничего не найдено</div>';
    return;
  }
  list.innerHTML = achs.map(a => {
    const name = esc(safeAchName(a.displayName, a.apiname));
    const desc = esc(a.description || '');
    const icon = a.achieved ? (a.icon || a.iconGray || '') : (a.iconGray || a.icon || '');
    const percentText = achievementRarityText(a);
    const unlockText = a.achieved && a.unlocktime
      ? `Получено ${esc(formatTimelineDate(a.unlocktime * 1000))}`
      : 'Не получено';
    return `<div class="sl-ach-row ${a.achieved ? '' : 'locked'}">
      ${icon
        ? `<img class="sl-ach-row-icon${a.achieved ? '' : ' gray'}" src="${esc(icon)}" alt=""/>`
        : `<div class="sl-ach-row-icon ph">${a.achieved ? '🏆' : '🔒'}</div>`}
      <div class="sl-ach-row-info">
        <div class="sl-ach-row-name">${name}</div>
        ${desc ? `<div class="sl-ach-row-desc">${desc}</div>` : ''}
        ${percentText || isRareAchievement(a)
          ? `<div class="sl-ach-row-meta">
              ${isRareAchievement(a) ? '<span class="sl-ach-row-badge">Редкое</span>' : ''}
              ${percentText ? `<span class="sl-ach-row-percent">${percentText}</span>` : ''}
            </div>`
          : ''}
      </div>
      <div class="sl-ach-row-side">
        <div class="sl-ach-row-unlock">${unlockText}</div>
        <div class="sl-ach-row-state">${a.achieved ? 'Получено' : 'Не выполнено'}</div>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('sl-ach-panel-header').addEventListener('click', () => openSLAchModal());
document.getElementById('sl-hero-recent-list').addEventListener('click', e => {
  if (!e.target.closest('.sl-hero-ach') || !selectedLibGameId) return;
  openSLAchModal();
  achModalFilter = 'unlocked';
  document.querySelectorAll('.sl-ach-mf').forEach(b => b.classList.toggle('active', b.dataset.mf === 'unlocked'));
  renderSLAchModalList(store.games[selectedLibGameId]);
});
document.getElementById('sl-ach-modal-close').addEventListener('click', () =>
  document.getElementById('sl-ach-modal').classList.add('hidden')
);
document.getElementById('sl-ach-modal-bg').addEventListener('click', () =>
  document.getElementById('sl-ach-modal').classList.add('hidden')
);
document.getElementById('sl-ach-modal').addEventListener('click', e => {
  const btn = e.target.closest('.sl-ach-mf');
  if (!btn || !selectedLibGameId) return;
  achModalFilter = btn.dataset.mf;
  document.querySelectorAll('.sl-ach-mf').forEach(b => b.classList.toggle('active', b === btn));
  renderSLAchModalList(store.games[selectedLibGameId]);
});
document.getElementById('sl-ach-modal-search').addEventListener('input', e => {
  if (!selectedLibGameId) return;
  achModalSearch = String(e.target.value || '').trim();
  renderSLAchModalList(store.games[selectedLibGameId]);
});
document.getElementById('sl-ach-modal-sort').addEventListener('change', e => {
  if (!selectedLibGameId) return;
  achModalSort = String(e.target.value || 'recent');
  renderSLAchModalList(store.games[selectedLibGameId]);
});

document.querySelectorAll('.lib-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.filterType;
    const val  = btn.dataset.filterVal;
    if (type === 'platform') {
      activePlatformFilter = val === '' || activePlatformFilter === val ? '' : val;
    } else if (type === 'status') {
      // Toggle: повторный клик снимает фильтр (кроме «Все»)
      if (val === '') {
        activeStatusFilter = '';
      } else {
        activeStatusFilter = activeStatusFilter === val ? '' : val;
      }
    } else if (type === 'rating') {
      const num = val === '0' ? 0 : parseInt(val);
      activeRatingFilter = activeRatingFilter === num ? null : num;
    }
    updateFilterBtnStates();
    filterAndSort();
  });
});

function updateFilterBtnStates() {
  document.querySelectorAll('.lib-filter-btn[data-filter-type="platform"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filterVal === activePlatformFilter);
  });
  document.querySelectorAll('.lib-filter-btn[data-filter-type="status"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filterVal === activeStatusFilter);
  });
  document.querySelectorAll('.lib-filter-btn[data-filter-type="rating"]').forEach(btn => {
    const num = btn.dataset.filterVal === '0' ? 0 : parseInt(btn.dataset.filterVal);
    btn.classList.toggle('active', activeRatingFilter === num);
  });
}

// ══════════ ДОСТИЖЕНИЯ (вкладка) ══════════════════════════
let achFilter = 'all';   // 'all' | 'unlocked' | 'locked'

document.querySelectorAll('.ach-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ach-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    achFilter = btn.dataset.filter;
    renderAchievements();
  });
});

document.getElementById('ach-search').addEventListener('input', () => renderAchievements());

function renderAchievements() {
  const list  = gamesList().filter(g => g.achievements?.length > 0);
  const total = list.reduce((s, g) => s + (g.achievementsUnlocked || 0), 0);
  document.getElementById('ach-total-count').textContent = total;

  const q = (document.getElementById('ach-search')?.value || '').toLowerCase().trim();

  const container = document.getElementById('ach-list');
  const empty     = document.getElementById('ach-empty');
  container.innerHTML = '';

  if (!list.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  let rendered = 0;
  list
    .sort((a, b) => (b.achievementsUnlocked || 0) - (a.achievementsUnlocked || 0))
    .forEach(game => {
      // Применяем фильтр и поиск
      const filtered = (game.achievements || []).filter(ach => {
        if (achFilter === 'unlocked' && !ach.achieved) return false;
        if (achFilter === 'locked'   &&  ach.achieved) return false;
        if (q) {
          const name = safeAchName(ach.displayName, ach.apiname).toLowerCase();
          const desc = (ach.description || '').toLowerCase();
          if (!name.includes(q) && !desc.includes(q)) return false;
        }
        return true;
      });
      if (!filtered.length) return;

      const section = document.createElement('div');
      section.className = 'ach-game-section';
      const cover = gameCover(game);
      const unlockedFiltered = filtered.filter(a => a.achieved).length;
      section.innerHTML = `
        <div class="ach-game-header">
          ${cover ? `<img src="${cover}" alt="" onerror="this.style.display='none'" />` : ''}
          <span>${esc(game.title)}</span>
          <span class="ach-count">🏆 ${unlockedFiltered} / ${filtered.length}</span>
        </div>
        <div class="ach-grid-tab"></div>
      `;
      const grid = section.querySelector('.ach-grid-tab');
      [...filtered]
        .sort((a, b) => (b.achieved || 0) - (a.achieved || 0))
        .forEach(ach => grid.appendChild(makeAchItem(ach, game.source === 'manual', game.id, null)));
      container.appendChild(section);
      rendered++;
    });

  if (!rendered) {
    container.innerHTML = '<div class="empty-hint" style="padding:24px 0">Ничего не найдено по выбранному фильтру</div>';
  }
}

// ══════════ СТАТИСТИКА ════════════════════════════════════
let chartGames = null, chartActivity = null, chartRatings = null;

function renderStats() {
  drawStatsCards();
}

function drawStatsCards() {
  const list = gamesList();
  const totalHours = list.reduce((s, g) => s + (g.hoursPlayed || 0), 0);
  const unlockedAchievements = list.reduce((s, g) => s + (g.achievementsUnlocked || 0), 0);
  const totalAchievements = list.reduce((s, g) => s + (g.achievementsTotal || 0), 0);
  const completedGames = list.filter(g => g.status === 'completed').length;
  const completedPct = list.length ? Math.round((completedGames / list.length) * 100) : 0;

  document.getElementById('ssc-games').textContent = list.length;
  document.getElementById('ssc-hours').textContent = fmtH(totalHours);
  document.getElementById('ssc-ach').textContent = unlockedAchievements;
  document.getElementById('ssc-completed').textContent = completedGames;

  const gamesNote = document.getElementById('ssc-games-note');
  const achNote = document.getElementById('ssc-ach-note');
  const completedNote = document.getElementById('ssc-completed-note');
  const heroSub = document.getElementById('sv-hero-sub');
  if (gamesNote) gamesNote.textContent = list.length === 1 ? 'игра' : 'игр';
  if (achNote) achNote.textContent = totalAchievements ? `из ${totalAchievements}` : 'достижений';
  if (completedNote) completedNote.textContent = `${completedPct}% библиотеки`;
  if (heroSub) {
    const recentAll = list.reduce((s, g) => s + getRecentHours(g), 0);
    heroSub.textContent = recentAll > 0
      ? `${fmtH(recentAll)} ч за последние 2 недели`
      : `${list.length} игр в библиотеке`;
  }

  renderStatsTopGames(list);
  renderStatsStatusBreakdown(list);
  renderStatsAchievements(list);
  renderStatsActivity(list);
  renderStatsStory(list);
}

function getRecentHours(game, days = 14) {
  const cutoff = Date.now() - days * 86400000;
  return (game.sessions || []).reduce((sum, s) => {
    const t = new Date(s.date).getTime();
    return t >= cutoff ? sum + (s.minutes || 0) / 60 : sum;
  }, 0);
}

function statsSessionEvents(list, days = 365) {
  const cutoff = Date.now() - days * 86400000;
  return list.flatMap(game => (game.sessions || []).map(session => {
    const time = new Date(session.date).getTime();
    const minutes = Number(session.minutes || 0);
    return { game, time, minutes };
  })).filter(event =>
    Number.isFinite(event.time)
    && event.time >= cutoff
    && Number.isFinite(event.minutes)
    && event.minutes > 0
  );
}

function statsHoursForRange(list, startMs, endMs = Date.now()) {
  return statsSessionEvents(list, 730).reduce((sum, event) => {
    return event.time >= startMs && event.time < endMs ? sum + event.minutes / 60 : sum;
  }, 0);
}

function statsHoursByGameForRange(list, startMs, endMs = Date.now()) {
  const totals = new Map();
  statsSessionEvents(list, 730).forEach(event => {
    if (event.time < startMs || event.time >= endMs) return;
    totals.set(event.game.id, (totals.get(event.game.id) || 0) + event.minutes / 60);
  });
  return totals;
}

function statsMonthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function statsDaysSince(value) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return Infinity;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function statsGameMiniCard(game, { value = '', sub = '', tag = '', accent = 'blue' } = {}) {
  const art = statsGameArt(game);
  return `
    <button class="stats-story-game ${accent}" type="button" data-game-id="${esc(game.id)}">
      <div class="stats-story-game-art">
        ${art ? `<img src="${esc(art)}" alt="" loading="lazy" />` : '<span>🎮</span>'}
      </div>
      <div class="stats-story-game-copy">
        <div class="stats-story-game-title">${esc(game.title || 'Игра')}</div>
        ${sub ? `<div class="stats-story-game-sub">${esc(sub)}</div>` : ''}
      </div>
      <div class="stats-story-game-meta">
        ${value ? `<strong>${esc(value)}</strong>` : ''}
        ${tag ? `<span>${esc(tag)}</span>` : ''}
      </div>
    </button>`;
}

function renderStatsStory(list) {
  renderStatsStoryStrip(list);
  renderStatsWeekStory(list);
  renderStatsMonthGame(list);
  renderStatsDormantGames(list);
  renderStatsRecommendations(list);
}

function renderStatsStoryStrip(list) {
  const root = document.getElementById('stats-story-strip');
  if (!root) return;

  const now = Date.now();
  const weekStart = now - 7 * 86400000;
  const prevWeekStart = now - 14 * 86400000;
  const weekHours = statsHoursForRange(list, weekStart, now);
  const prevWeekHours = statsHoursForRange(list, prevWeekStart, weekStart);
  const completed = list.filter(g => g.status === 'completed').length;
  const dormant = list.filter(g => (g.hoursPlayed || 0) > 0 && statsDaysSince(g.lastPlayedAt) >= 90).length;
  const monthTotals = statsHoursByGameForRange(list, statsMonthStart(), now);
  const monthLeader = [...monthTotals.entries()]
    .map(([gameId, hours]) => ({ game: store.games[gameId], hours }))
    .filter(item => item.game)
    .sort((a, b) => b.hours - a.hours)[0];

  const delta = weekHours - prevWeekHours;
  const deltaText = Math.abs(delta) >= 0.1
    ? `${delta >= 0 ? '+' : '-'}${fmtH(Math.abs(delta))} ч к прошлой неделе`
    : 'примерно как на прошлой неделе';

  root.innerHTML = [
    {
      label: 'Эта неделя',
      value: `${fmtH(weekHours)} ч`,
      sub: weekHours > 0 ? deltaText : 'сессий пока не было',
    },
    {
      label: 'Игра месяца',
      value: monthLeader ? monthLeader.game.title : 'Пока нет',
      sub: monthLeader ? `${fmtH(monthLeader.hours)} ч за месяц` : 'появится после сессий',
    },
    {
      label: 'Прогресс',
      value: `${completed}/${list.length || 0}`,
      sub: list.length ? 'игр отмечено пройденными' : 'библиотека пуста',
    },
    {
      label: 'Стоит вспомнить',
      value: dormant,
      sub: dormant ? 'игр не запускались 90+ дней' : 'хвостов почти нет',
    },
  ].map(item => `
    <div class="stats-story-card">
      <div class="stats-story-label">${esc(item.label)}</div>
      <div class="stats-story-value" title="${esc(item.value)}">${esc(item.value)}</div>
      <div class="stats-story-sub">${esc(item.sub)}</div>
    </div>
  `).join('');
}

function renderStatsWeekStory(list) {
  const root = document.getElementById('stats-week-story');
  const note = document.getElementById('stats-week-note');
  if (!root) return;

  const days = Array.from({ length: 7 }, (_, idx) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - idx));
    return date;
  });
  const events = statsSessionEvents(list, 14);
  const byDay = days.map(day => {
    const start = day.getTime();
    const end = start + 86400000;
    const hours = events.reduce((sum, event) => (
      event.time >= start && event.time < end ? sum + event.minutes / 60 : sum
    ), 0);
    return { day, hours };
  });
  const max = Math.max(...byDay.map(item => item.hours), 1);
  const total = byDay.reduce((sum, item) => sum + item.hours, 0);
  const activeDays = byDay.filter(item => item.hours > 0).length;

  if (note) note.textContent = total > 0 ? `${activeDays}/7 дней` : '';
  if (!list.length) {
    root.innerHTML = statsEmpty('Добавь игры, и здесь появится недельная история');
    return;
  }

  root.innerHTML = `
    <div class="stats-week-bars">
      ${byDay.map(item => {
        const height = Math.max(8, Math.round((item.hours / max) * 100));
        return `
          <div class="stats-week-day" title="${esc(item.day.toLocaleDateString('ru-RU'))}: ${fmtH(item.hours)} ч">
            <span class="stats-week-bar"><span style="height:${height}%"></span></span>
            <strong>${esc(item.day.toLocaleDateString('ru-RU', { weekday: 'short' }))}</strong>
            <em>${item.hours > 0 ? esc(fmtH(item.hours)) : '0'}</em>
          </div>`;
      }).join('')}
    </div>
    <div class="stats-week-caption">
      ${total > 0
        ? `За неделю вышло ${esc(fmtH(total))} ч. Самый активный день: ${esc(byDay.reduce((a, b) => b.hours > a.hours ? b : a).day.toLocaleDateString('ru-RU', { weekday: 'long' }))}.`
        : 'На этой неделе ещё не было игровых сессий.'}
    </div>`;
}

function renderStatsMonthGame(list) {
  const root = document.getElementById('stats-month-game');
  const note = document.getElementById('stats-month-note');
  if (!root) return;

  const totals = statsHoursByGameForRange(list, statsMonthStart(), Date.now());
  let leader = [...totals.entries()]
    .map(([gameId, hours]) => ({ game: store.games[gameId], hours }))
    .filter(item => item.game && item.hours > 0)
    .sort((a, b) => b.hours - a.hours)[0];

  if (!leader) {
    const fallback = [...list]
      .filter(g => (g.hoursPlayed || 0) > 0)
      .sort((a, b) => (b.hoursPlayed || 0) - (a.hoursPlayed || 0))[0];
    if (fallback) leader = { game: fallback, hours: fallback.hoursPlayed || 0, fallback: true };
  }

  if (!leader) {
    root.innerHTML = statsEmpty('Появится после первых игровых сессий');
    if (note) note.textContent = '';
    return;
  }

  if (note) note.textContent = leader.fallback ? 'за всё время' : 'этот месяц';
  const unlocked = leader.game.achievementsUnlocked || 0;
  const total = leader.game.achievementsTotal || 0;
  root.innerHTML = statsGameMiniCard(leader.game, {
    value: `${fmtH(leader.hours)} ч`,
    sub: total ? `Достижения: ${unlocked}/${total}` : 'Главный фокус периода',
    tag: leader.game.status ? (STATUS_LABELS[leader.game.status] || '') : '',
    accent: 'gold',
  });
  bindStatsGameRows(root);
}

function renderStatsDormantGames(list) {
  const root = document.getElementById('stats-dormant-games');
  const note = document.getElementById('stats-dormant-note');
  if (!root) return;

  const dormant = [...list]
    .filter(g => (g.hoursPlayed || 0) > 0 && statsDaysSince(g.lastPlayedAt) >= 60)
    .sort((a, b) => statsDaysSince(b.lastPlayedAt) - statsDaysSince(a.lastPlayedAt))
    .slice(0, 4);

  if (note) note.textContent = dormant.length
    ? `${dormant.length} ${dormant.length === 1 ? 'игра' : 'игры'}`
    : '';
  if (!dormant.length) {
    root.innerHTML = statsEmpty('Нет старых хвостов: библиотека выглядит живой');
    return;
  }

  root.innerHTML = dormant.map(game => {
    const days = statsDaysSince(game.lastPlayedAt);
    return statsGameMiniCard(game, {
      value: `${days} дн.`,
      sub: `${fmtH(game.hoursPlayed || 0)} ч всего`,
      tag: 'не запускалась',
      accent: 'muted',
    });
  }).join('');
  bindStatsGameRows(root);
}

function renderStatsRecommendations(list) {
  const root = document.getElementById('stats-recommendations');
  const note = document.getElementById('stats-recommendations-note');
  if (!root) return;

  const picks = [];
  const playing = [...list]
    .filter(g => g.status === 'playing')
    .sort((a, b) => getRecentHours(b, 30) - getRecentHours(a, 30))[0];
  if (playing) picks.push({
    title: 'Продолжить текущую игру',
    text: `${playing.title}: ${fmtH(getRecentHours(playing, 30))} ч за месяц`,
    game: playing,
  });

  const almostDone = [...list]
    .filter(g => (g.achievementsTotal || 0) > 0)
    .map(g => ({ game: g, pct: (g.achievementsUnlocked || 0) / Math.max(1, g.achievementsTotal || 0) }))
    .filter(item => item.pct >= .65 && item.pct < 1)
    .sort((a, b) => b.pct - a.pct)[0];
  if (almostDone) picks.push({
    title: 'Добить прогресс',
    text: `${almostDone.game.title}: ${Math.round(almostDone.pct * 100)}% достижений`,
    game: almostDone.game,
  });

  const dormantFavorite = [...list]
    .filter(g => (g.hoursPlayed || 0) >= 5 && statsDaysSince(g.lastPlayedAt) >= 90)
    .sort((a, b) => (b.hoursPlayed || 0) - (a.hoursPlayed || 0))[0];
  if (dormantFavorite) picks.push({
    title: 'Вернуться к старому фавориту',
    text: `${dormantFavorite.title}: ${fmtH(dormantFavorite.hoursPlayed || 0)} ч накоплено`,
    game: dormantFavorite,
  });

  const unrated = [...list]
    .filter(g => (g.hoursPlayed || 0) >= 2 && !g.rating)
    .sort((a, b) => (b.hoursPlayed || 0) - (a.hoursPlayed || 0))[0];
  if (unrated) picks.push({
    title: 'Поставить оценку',
    text: `${unrated.title}: уже ${fmtH(unrated.hoursPlayed || 0)} ч`,
    game: unrated,
  });

  const unique = [];
  const seen = new Set();
  picks.forEach(pick => {
    const key = `${pick.title}:${pick.game?.id || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(pick);
  });

  if (note) note.textContent = unique.length
    ? `${unique.length} ${unique.length === 1 ? 'идея' : 'идеи'}`
    : '';
  if (!unique.length) {
    root.innerHTML = statsEmpty('Пока нечего советовать: добавь игры, сессии или достижения');
    return;
  }

  root.innerHTML = unique.slice(0, 4).map(pick => `
    <button class="stats-rec-card" type="button" data-game-id="${esc(pick.game.id)}">
      <span class="stats-rec-dot"></span>
      <span>
        <strong>${esc(pick.title)}</strong>
        <em>${esc(pick.text)}</em>
      </span>
    </button>
  `).join('');
  bindStatsGameRows(root);
}

function renderStatsActivity(list) {
  const root = document.getElementById('stats-activity-list');
  if (!root) return;

  let recent = [...list]
    .filter(g => g.lastPlayedAt)
    .sort((a, b) => new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime());

  if (!recent.length) {
    recent = [...list]
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  recent = recent.slice(0, 8);

  if (!recent.length) {
    root.innerHTML = statsEmpty('В библиотеке пока нет игр');
    return;
  }

  const totalRecent = recent.reduce((s, g) => s + getRecentHours(g), 0);
  const badge = document.getElementById('sv-activity-badge');
  if (badge) badge.textContent = totalRecent > 0 ? `${fmtH(totalRecent)} ч за 2 нед.` : `${recent.length} игр`;

  root.innerHTML = recent.map(game => {
    const cover = statsGameArt(game);
    const totalH = game.hoursPlayed || 0;
    const recentH = getRecentHours(game);
    const unlocked = game.achievementsUnlocked || 0;
    const total = game.achievementsTotal || 0;
    const achPct = total > 0 ? Math.round(unlocked / total * 100) : 0;
    const lastDate = game.lastPlayedAt
      ? new Date(game.lastPlayedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
      : '';
    const statusLabel = game.status ? (STATUS_LABELS[game.status] || '') : '';
    const statusColor = statusAccentColor(game.status || '');

    return `
      <div class="sa-entry" onclick="openStatsGame('${esc(game.id)}')">
        <div class="sa-capsule-wrap">
          <img class="sa-capsule" src="${esc(cover)}" alt=""
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="sa-capsule-fallback" style="display:none">🎮</div>
        </div>
        <div class="sa-info">
          <div class="sa-row-top">
            <span class="sa-title">${esc(game.title)}</span>
            ${statusLabel ? `<span class="sa-status" style="--sc:${statusColor}">${esc(statusLabel)}</span>` : ''}
          </div>
          <div class="sa-hours">
            <span class="sa-hours-total">${fmtH(totalH)} ч всего</span>
            ${recentH > 0 ? `<span class="sa-hours-sep">·</span><span class="sa-hours-recent">${fmtH(recentH)} ч за 2 нед.</span>` : ''}
            ${lastDate ? `<span class="sa-hours-sep">·</span><span class="sa-last-played">${lastDate}</span>` : ''}
          </div>
          ${total > 0 ? `
            <div class="sa-ach">
              <div class="sa-ach-track"><div class="sa-ach-fill" style="width:${achPct}%"></div></div>
              <span class="sa-ach-text">${unlocked} / ${total}</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function statsGameArt(game = {}) {
  return gameCover(game) || gamePoster(game) || '';
}

function statsEmpty(text) {
  return `<div class="stats-empty">${esc(text)}</div>`;
}

function openStatsGame(gameId) {
  const game = store.games?.[gameId];
  if (!game) return;
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.view === 'library')
  );
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-library')?.classList.add('active');
  document.getElementById('app').dataset.view = 'library';
  renderLibrary();
  requestAnimationFrame(() => openGameDetail(gameId));
}

function statsGameRow(game, { value, sub = '', percent = 0, accent = 'blue', badge = '', rank = '' } = {}) {
  const art = statsGameArt(game);
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <button class="stats-game-row ${accent}" type="button" data-game-id="${esc(game.id)}">
      <div class="stats-game-rank">${esc(rank || '')}</div>
      <div class="stats-game-cover-wrap">
        ${art
          ? `<img class="stats-game-cover" src="${esc(art)}" alt="" loading="lazy" />`
          : '<div class="stats-game-cover-ph">🎮</div>'}
      </div>
      <div class="stats-game-info">
        <div class="stats-game-title">${esc(game.title || 'Игра')}</div>
        ${sub ? `<div class="stats-game-sub">${esc(sub)}</div>` : ''}
        <div class="stats-mini-track"><div class="stats-mini-fill" style="width:${safePercent}%"></div></div>
      </div>
      <div class="stats-game-value">
        <strong>${esc(value || '')}</strong>
        ${badge ? `<span>${esc(badge)}</span>` : ''}
      </div>
    </button>`;
}

function bindStatsGameRows(root) {
  root?.querySelectorAll('[data-game-id]').forEach(row => {
    row.addEventListener('click', () => openStatsGame(row.dataset.gameId));
  });
}

function statsCoverChip(game = {}, size = 'small') {
  const art = statsGameArt(game);
  return art
    ? `<img class="stats-cover-chip ${size}" src="${esc(art)}" alt="${esc(game.title || '')}" title="${esc(game.title || '')}" loading="lazy" />`
    : `<span class="stats-cover-chip ${size} ph" title="${esc(game.title || '')}">🎮</span>`;
}

function renderStatsBarChart(root, games, getValue, formatValue) {
  if (!root) return;
  if (!games.length) {
    root.innerHTML = statsEmpty('Нет данных для графика');
    return;
  }
  const max = Math.max(...games.map(getValue), 1);
  root.innerHTML = games.map((game, idx) => {
    const value = Number(getValue(game) || 0);
    const height = Math.max(8, Math.round((value / max) * 100));
    return `
      <button class="stats-bar-col" type="button" data-game-id="${esc(game.id)}" title="${esc(game.title || '')}: ${esc(formatValue(value, game))}">
        <span class="stats-bar-value">${esc(formatValue(value, game))}</span>
        <span class="stats-bar-wrap"><span class="stats-bar-fill" style="height:${height}%"></span></span>
        ${statsCoverChip(game, idx === 0 ? 'large' : 'small')}
      </button>`;
  }).join('');
  bindStatsGameRows(root);
}

function renderStatsAchChart(root, games) {
  if (!root) return;
  if (!games.length) {
    root.innerHTML = statsEmpty('Нет данных для графика');
    return;
  }
  root.innerHTML = games.slice(0, 6).map(game => {
    const pct = Math.round(((game.achievementsUnlocked || 0) / Math.max(1, game.achievementsTotal || 0)) * 100);
    return `
      <button class="stats-ach-bar" type="button" data-game-id="${esc(game.id)}" title="${esc(game.title || '')}: ${pct}%">
        ${statsCoverChip(game, 'small')}
        <span class="stats-ach-bar-track"><span class="stats-ach-bar-fill" style="width:${pct}%"></span></span>
        <strong>${pct}%</strong>
      </button>`;
  }).join('');
  bindStatsGameRows(root);
}

function renderStatsTopGames(list) {
  const root = document.getElementById('stats-top-games');
  const chart = document.getElementById('stats-top-chart');
  const note = document.getElementById('stats-top-note');
  if (!root) return;
  const top = [...list]
    .filter(g => Number(g.hoursPlayed || 0) > 0)
    .sort((a, b) => (b.hoursPlayed || 0) - (a.hoursPlayed || 0))
    .slice(0, 8);
  if (!top.length) {
    root.innerHTML = statsEmpty('Пока нет игр с временем');
    if (chart) chart.innerHTML = statsEmpty('Нет данных для графика');
    if (note) note.textContent = '';
    return;
  }
  if (chart) renderStatsBarChart(chart, top.slice(0, 6), g => Number(g.hoursPlayed || 0), value => `${fmtH(value)} ч`);
  if (note) note.textContent = `${top.length} игр`;
  const maxHours = Math.max(...top.map(g => Number(g.hoursPlayed || 0)), 1);
  root.innerHTML = top.map((g, idx) => statsGameRow(g, {
    value: `${fmtH(g.hoursPlayed || 0)} ч`,
    sub: g.lastPlayedAt
      ? `Последний запуск: ${new Date(g.lastPlayedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'Недавних запусков нет',
    percent: (Number(g.hoursPlayed || 0) / maxHours) * 100,
    accent: idx === 0 ? 'gold' : 'blue',
    rank: String(idx + 1),
  })).join('');
  bindStatsGameRows(root);
}

function renderStatsStatusBreakdown(list) {
  const root = document.getElementById('stats-status-list');
  const note = document.getElementById('stats-status-note');
  if (!root) return;

  const total = Math.max(1, list.length);
  const rows = [
    ...STATUS_CONTEXT_OPTIONS.filter(option => option.value),
    { value: 'none', label: 'Без статуса' },
  ].map(option => {
    const count = option.value === 'none'
      ? list.filter(g => !g.status).length
      : list.filter(g => g.status === option.value).length;
    const percent = Math.round((count / total) * 100);
    return {
      ...option,
      count,
      percent,
      color: statusAccentColor(option.value === 'none' ? '' : option.value),
    };
  });

  if (note) {
    const withStatus = list.filter(g => g.status).length;
    note.textContent = list.length ? `${withStatus} отмечено` : '';
  }

  root.innerHTML = rows.map(row => `
    <button class="stats-status-row" type="button" data-status-value="${esc(row.value)}" style="--status-color:${esc(row.color)}">
      <span class="stats-status-dot"></span>
      <span class="stats-status-name">${esc(row.label)}</span>
      <span class="stats-status-count">${row.count}</span>
      <span class="stats-status-track"><span style="width:${row.percent}%"></span></span>
    </button>
  `).join('');

  root.querySelectorAll('[data-status-value]').forEach(row => {
    row.addEventListener('click', () => {
      activeStatusFilter = row.dataset.statusValue || '';
      document.querySelectorAll('.nav-item').forEach(n =>
        n.classList.toggle('active', n.dataset.view === 'library')
      );
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-library')?.classList.add('active');
      document.getElementById('app').dataset.view = 'library';
      updateFilterBtnStates();
      renderLibrary();
    });
  });
}

function renderStatsAchievements(list) {
  const root = document.getElementById('stats-achievements-list');
  const chart = document.getElementById('stats-ach-chart');
  const note = document.getElementById('stats-ach-note');
  if (!root) return;
  const withAch = [...list]
    .filter(g => Number(g.achievementsTotal || 0) > 0)
    .sort((a, b) => {
      const aPct = (a.achievementsUnlocked || 0) / Math.max(1, a.achievementsTotal || 0);
      const bPct = (b.achievementsUnlocked || 0) / Math.max(1, b.achievementsTotal || 0);
      return bPct - aPct || (b.achievementsTotal || 0) - (a.achievementsTotal || 0);
    })
    .slice(0, 10);
  if (!withAch.length) {
    root.innerHTML = statsEmpty('Нет данных о достижениях');
    if (chart) chart.innerHTML = statsEmpty('Нет данных для графика');
    if (note) note.textContent = '';
    return;
  }
  if (chart) renderStatsAchChart(chart, withAch);
  if (note) note.textContent = `${withAch.length} игр`;
  root.innerHTML = withAch.map(g => {
    const pct = Math.round(((g.achievementsUnlocked || 0) / Math.max(1, g.achievementsTotal || 0)) * 100);
    return statsGameRow(g, {
      value: `${pct}%`,
      sub: `${g.achievementsUnlocked || 0} из ${g.achievementsTotal || 0} достижений`,
      percent: pct,
      accent: pct >= 80 ? 'gold' : 'purple',
      badge: `${g.achievementsUnlocked || 0}/${g.achievementsTotal || 0}`,
    });
  }).join('');
  bindStatsGameRows(root);
}

function drawCharts() {
  drawStatsCards();
}

let ambientBgTimeout;
function setAmbientBackground(src) {
  const bg = document.getElementById('ambient-bg');
  if (!bg) return;
  clearTimeout(ambientBgTimeout);
  
  if (bg.src !== src) {
    bg.classList.remove('active');
    setTimeout(() => {
      bg.src = src;
      bg.onload = () => { bg.classList.add('active'); };
    }, 150);
  } else {
    bg.classList.add('active');
  }
}
function clearAmbientBackground() {
  const bg = document.getElementById('ambient-bg');
  if (!bg) return;
  clearTimeout(ambientBgTimeout);
  ambientBgTimeout = setTimeout(() => {
    bg.classList.remove('active');
  }, 200);
}

// ══════════ КАРТОЧКА ИГРЫ ════════════════════════════════
const USE_OLD_GAME_CARD_DESIGN = false; // Поменяйте на true для отката на старый дизайн

function makeGameCard(game) {
  if (USE_OLD_GAME_CARD_DESIGN) {
    return makeGameCardOld(game);
  }
  return makeGameCardV2(game);
}

function makeGameCardV2(game) {
  const card  = document.createElement('div');
  card.className = 'game-card-v2';
  card.dataset.gameId = game.id;
  card.draggable = true;

  const cover    = gameCover(game);
  
  // Ambient Background Events
  card.addEventListener('mouseenter', () => {
    if (cover) setAmbientBackground(cover);
  });
  card.addEventListener('mouseleave', () => {
    clearAmbientBackground();
  });

  const hoursStr = `${fmtH(game.hoursPlayed || 0)}`;
  const achPct   = game.achievementsTotal > 0
    ? Math.round((game.achievementsUnlocked || 0) / game.achievementsTotal * 100) : 0;
  const achStr   = game.achievementsTotal > 0
    ? `🏆 ${game.achievementsUnlocked || 0}/${game.achievementsTotal}` : '';
  const lastPlayed = game.lastPlayedAt
    ? new Date(game.lastPlayedAt).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' })
    : 'Никогда';
  const hasNotes  = !!game.notes?.trim();
  const tierInfo = getGameTierInfo(game.id);
  const tierBadge = tierInfo
    ? `<div class="gc-tier-badge" style="--tier-color:${esc(tierInfo.color)}" title="Тир ${esc(tierInfo.label)}">${esc(tierInfo.shortLabel)}</div>`
    : '';
  const statusBadge = game.status
    ? `<div class="gc-status-badge ${game.status}">${STATUS_LABELS[game.status]}</div>` : '';
  const tagsHtml = (game.tags?.length)
    ? `<div class="gc-tags">${game.tags.slice(0,3).map(t => `<span class="gc-tag">${esc(t)}</span>`).join('')}</div>` : '';
  const canLaunch = canLaunchLocally(game) || !!game.appid;

  card.innerHTML = `
    <div class="gc-art">
      ${cover
        ? `<img class="gc-cover" src="${esc(cover)}" alt="${esc(game.title)}" decoding="async"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
           <div class="gc-no-cover" style="display:none">🎮</div>`
        : `<div class="gc-no-cover">🎮</div>`}
      <div class="gc-art-overlay"></div>
      ${canLaunch ? `<button class="gc-launch-btn" title="Запустить игру">▶</button>` : ''}
      ${tierBadge}
      ${statusBadge}
      ${game.rating ? `<div class="gc-badge-rating">★ ${game.rating}</div>` : ''}
      ${game.achievementsTotal > 0 ? `
        <div class="gc-ach-bar">
          <div class="gc-ach-bar-fill" style="width:${achPct}%"></div>
        </div>` : ''}
    </div>
    <div class="gc-info">
      <div class="gc-title" title="${esc(game.title)}">${esc(game.title)}</div>
      <div class="gc-stats">
        <span class="gc-hours">${hoursStr}<span>ч</span></span>
        ${achStr ? `<span class="gc-ach-count">${achStr}</span>` : ''}
      </div>
      <div class="gc-meta">
        <span class="gc-last-played">${lastPlayed}</span>
        ${hasNotes ? '<span class="gc-notes-dot" title="Есть заметки">📝</span>' : ''}
      </div>
    </div>
    ${tagsHtml}
  `;

  const artEl = card.querySelector('.gc-art');
  const coverEl = card.querySelector('.gc-cover');
  if (artEl && coverEl) {
    artEl.classList.add('is-media-loading');
    coverEl.addEventListener('load', () => artEl.classList.remove('is-media-loading'));
    coverEl.addEventListener('error', () => artEl.classList.remove('is-media-loading'));
    if (coverEl.complete) artEl.classList.remove('is-media-loading');
  }

  card.addEventListener('click', () => openGameModal(game.id));
  card.addEventListener('contextmenu', e => openGameStatusMenu(e, game.id));

  const launchBtn = card.querySelector('.gc-launch-btn');
  if (launchBtn) {
    launchBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await launchGameFromLauncher(game.id);
    });
  }

  // Drag & drop
  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', game.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('drag-over');
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId === game.id) return;
    reorderGames(draggedId, game.id);
  });

  // 3D Tilt Effect
  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -10;
    const rotateY = ((x - centerX) / centerX) * 10;
    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
    card.style.zIndex = 10;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    card.style.zIndex = '';
  });

  return card;
}

function makeGameCardOld(game) {
  const card  = document.createElement('div');
  card.className = 'game-card';
  card.dataset.gameId = game.id;
  card.draggable = true;

  const cover    = gameCover(game);
  
  // Ambient Background Events
  card.addEventListener('mouseenter', () => {
    if (cover) setAmbientBackground(cover);
  });
  card.addEventListener('mouseleave', () => {
    clearAmbientBackground();
  });

  const hoursStr = `${fmtH(game.hoursPlayed || 0)} ч`;
  const achPct   = game.achievementsTotal > 0
    ? Math.round((game.achievementsUnlocked || 0) / game.achievementsTotal * 100) : 0;
  const achStr   = game.achievementsTotal > 0
    ? `🏆 ${game.achievementsUnlocked || 0}/${game.achievementsTotal}` : '';
  const lastPlayed = game.lastPlayedAt
    ? new Date(game.lastPlayedAt).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' })
    : '';
  const hasNotes  = !!game.notes?.trim();
  const tierInfo = getGameTierInfo(game.id);
  const tierBadge = tierInfo
    ? `<div class="gc-tier-badge" style="--tier-color:${esc(tierInfo.color)}" title="Тир ${esc(tierInfo.label)}">${esc(tierInfo.shortLabel)}</div>`
    : '';
  const statusBadge = game.status
    ? `<div class="gc-status-badge ${game.status}">${STATUS_LABELS[game.status]}</div>` : '';
  const tagsHtml = (game.tags?.length)
    ? `<div class="gc-tags">${game.tags.slice(0,3).map(t => `<span class="gc-tag">${esc(t)}</span>`).join('')}</div>` : '';
  const canLaunch = canLaunchLocally(game) || !!game.appid;

  card.innerHTML = `
    <div class="gc-art">
      ${cover
        ? `<img class="gc-cover" src="${esc(cover)}" alt="${esc(game.title)}" decoding="async"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
           <div class="gc-no-cover" style="display:none">🎮</div>`
        : `<div class="gc-no-cover">🎮</div>`}
      <div class="gc-art-overlay">
        <span class="gc-overlay-label">Открыть →</span>
      </div>
      ${canLaunch ? `<button class="gc-launch-btn" title="Запустить игру">▶</button>` : ''}
      ${tierBadge}
      ${statusBadge}
      ${game.rating ? `<div class="gc-badge-rating">★ ${game.rating}</div>` : ''}
      ${game.achievementsTotal > 0 ? `
        <div class="gc-ach-bar">
          <div class="gc-ach-bar-fill" style="width:${achPct}%"></div>
        </div>` : ''}
    </div>
    <div class="gc-info">
      <div class="gc-title" title="${esc(game.title)}">${esc(game.title)}</div>
      <div class="gc-stats">
        <span class="gc-hours">${hoursStr}</span>
        <span class="gc-ach-count">${achStr}</span>
      </div>
      <div class="gc-meta">
        <span class="gc-last-played">${lastPlayed}</span>
        ${hasNotes ? '<span class="gc-notes-dot" title="Есть заметки">📝</span>' : ''}
      </div>
    </div>
    ${tagsHtml}
  `;

  const artEl = card.querySelector('.gc-art');
  const coverEl = card.querySelector('.gc-cover');
  if (artEl && coverEl) {
    artEl.classList.add('is-media-loading');
    coverEl.addEventListener('load', () => artEl.classList.remove('is-media-loading'));
    coverEl.addEventListener('error', () => artEl.classList.remove('is-media-loading'));
    if (coverEl.complete) artEl.classList.remove('is-media-loading');
  }

  card.addEventListener('click', () => openGameModal(game.id));
  card.addEventListener('contextmenu', e => openGameStatusMenu(e, game.id));

  const launchBtn = card.querySelector('.gc-launch-btn');
  if (launchBtn) {
    launchBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await launchGameFromLauncher(game.id);
    });
  }

  // Drag & drop
  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', game.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('drag-over');
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId === game.id) return;
    reorderGames(draggedId, game.id);
  });

  // 3D Tilt Effect
  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -10; // max rotation
    const rotateY = ((x - centerX) / centerX) * 10;
    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
    card.style.zIndex = 10;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    card.style.zIndex = '';
  });

  return card;
}

// ══════════════════════════════════════════════════════════
// СТРАНИЦА ДЕТАЛИ ИГРЫ
// ══════════════════════════════════════════════════════════

// Steam изображения по appId (порядок = приоритет в карусели)
function steamImages(appId) {
  if (!appId) return [];
  const base = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}`;
  return [
    `${base}/library_hero.jpg`,
    `${base}/capsule_616x353.jpg`,
    `${base}/header.jpg`,
    `${base}/page_bg_generated_v6b.jpg`,
  ];
}

let carouselIdx = 0;
let carouselSlides = [];

function buildCarousel(game) {
  const track = document.getElementById('gd2-carousel-track');
  const dots  = document.getElementById('gd2-carousel-dots');
  track.innerHTML = '';
  dots.innerHTML  = '';
  carouselIdx = 0;
  carouselSlides = [];

  const urls = steamImages(game.steamAppId);
  if (!urls.length) {
    track.innerHTML = `<div class="gd2-carousel-empty">🎮</div>`;
    document.getElementById('gd2-carousel-prev').style.display = 'none';
    document.getElementById('gd2-carousel-next').style.display = 'none';
    return;
  }

  document.getElementById('gd2-carousel-prev').style.display = '';
  document.getElementById('gd2-carousel-next').style.display = '';

  // Проверяем каждый URL — добавляем только загрузившиеся
  let loaded = 0;
  urls.forEach(url => {
    const tester = new Image();
    tester.onload = () => {
      carouselSlides.push(url);
      const slide = document.createElement('div');
      slide.className = 'gd2-carousel-slide';
      slide.innerHTML = `<img src="${url}" alt="" loading="lazy" />`;
      track.appendChild(slide);
      const dot = document.createElement('button');
      dot.className = 'gd2-carousel-dot' + (carouselSlides.length === 1 ? ' active' : '');
      dot.addEventListener('click', () => goToSlide(carouselSlides.length - 1));
      dots.appendChild(dot);
      if (carouselSlides.length === 1) updateCarousel();
      loaded++;
    };
    tester.onerror = () => {
      loaded++;
      if (loaded === urls.length && !carouselSlides.length) {
        // Все 404 — показать заглушку
        track.innerHTML = `<div class="gd2-carousel-empty">🎮</div>`;
      }
    };
    tester.src = url;
  });
}

function updateCarousel() {
  const track = document.getElementById('gd2-carousel-track');
  track.style.transform = `translateX(-${carouselIdx * 100}%)`;
  document.querySelectorAll('.gd2-carousel-dot').forEach((d, i) =>
    d.classList.toggle('active', i === carouselIdx));
}

function goToSlide(idx) {
  carouselIdx = Math.max(0, Math.min(idx, carouselSlides.length - 1));
  updateCarousel();
}

document.getElementById('gd2-carousel-prev').addEventListener('click', () =>
  goToSlide(carouselIdx === 0 ? carouselSlides.length - 1 : carouselIdx - 1));
document.getElementById('gd2-carousel-next').addEventListener('click', () =>
  goToSlide(carouselIdx === carouselSlides.length - 1 ? 0 : carouselIdx + 1));

// Свайп клавишами когда открыта страница
document.addEventListener('keydown', e => {
  if (!document.getElementById('view-game-detail').classList.contains('active')) return;
  if (e.key === 'ArrowLeft')  goToSlide(carouselIdx - 1);
  if (e.key === 'ArrowRight') goToSlide(carouselIdx + 1);
  if (e.key === 'Escape')     gamePageBack();
});

function openGamePage(gameId) {
  const game = store.games[gameId];
  if (!game) return;
  openedGameId = gameId;

  // Запоминаем из какого раздела пришли
  const active = document.querySelector('.nav-item.active');
  prevView = active?.dataset?.view || 'library';

  // Переключаем вид
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-game-detail').classList.add('active');
  document.getElementById('app').dataset.view = 'game-detail';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Заголовок
  document.getElementById('gd2-topbar-title').textContent = game.title;

  // Карусель
  buildCarousel(game);

  // Обложка
  const cover = gamePoster(game) || gameCover(game);
  const img   = document.getElementById('gd2-cover');
  const ph    = document.getElementById('gd2-cover-ph');
  if (cover) { img.src = cover; img.classList.remove('hidden'); ph.classList.add('hidden'); }
  else       { img.classList.add('hidden'); ph.classList.remove('hidden'); }
  const posterUrlInput = document.getElementById('gd2-poster-url');
  if (posterUrlInput) posterUrlInput.value = game.posterUrl || '';

  // Статистика
  document.getElementById('gd2-hours').textContent    = `${fmtH(game.hoursPlayed || 0)} ч`;
  document.getElementById('gd2-ach-count').textContent = `${game.achievementsUnlocked || 0} / ${game.achievementsTotal || 0}`;
  document.getElementById('gd2-last').textContent     = game.lastPlayedAt
    ? new Date(game.lastPlayedAt).toLocaleDateString('ru-RU') : 'Никогда';
  document.getElementById('gd2-platform').textContent = game.platform || '—';

  // Статус
  renderStatusPills(game.status);

  // Оценка
  renderRatingPicker2(game.rating || 0);

  // Заметки
  document.getElementById('gd2-notes').value = game.notes || '';

  // Теги
  renderGameTags(gameId);

  // Коллекции
  renderGameCollections2(gameId);

  // Достижения
  renderGameAchievements2(game);

  // Кнопка сессии
  const btnPlay = document.getElementById('gd2-btn-play');
  if (activeSession?.gameId === gameId) {
    btnPlay.textContent = '■ Остановить';
    btnPlay.onclick = () => { stopSession(); gamePageBack(); };
  } else {
    btnPlay.textContent = '▶ Играть';
    btnPlay.onclick = async () => { await launchGameFromLauncher(gameId); gamePageBack(); };
  }
}

function gamePageBack() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${prevView}`)?.classList.add('active');
  document.getElementById('app').dataset.view = prevView;
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.view === prevView));
}

document.getElementById('btn-game-back').addEventListener('click', gamePageBack);

document.getElementById('gd2-btn-hide')?.addEventListener('click', async () => {
  const gameId = openedGameId;
  if (!gameId) return;
  const hidden = await hideGameFromLibrary(gameId);
  if (hidden) gamePageBack();
});

document.getElementById('gd2-btn-delete').addEventListener('click', () => {
  const game = store.games[openedGameId];
  if (!game) return;
  if (!confirm(`Удалить «${game.title}»?`)) return;
  if (activeSession?.gameId === openedGameId) stopSession();
  delete store.games[openedGameId];
  save(); renderAll(); gamePageBack();
  toast(`«${game.title}» удалена`, 'ok');
});

// Статус
function renderStatusPills(status) {
  document.querySelectorAll('.gd2-status-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.status === status));
}
document.querySelectorAll('.gd2-status-pill').forEach(pill => {
  pill.addEventListener('click', async () => {
    const game = store.games[openedGameId];
    if (!game) return;
    game.status = game.status === pill.dataset.status ? null : pill.dataset.status;
    renderStatusPills(game.status);
    await save();
    filterAndSort(); // обновляет карточку в библиотеке
  });
});

// Оценка (вторая копия для страницы)
function renderRatingPicker2(val) {
  document.querySelectorAll('#gd2-rating .rating-btn').forEach(b => {
    const v = +b.dataset.val;
    b.classList.toggle('active', v <= val);
    b.classList.toggle('best',   v === val && val > 0);
  });
}
document.getElementById('gd2-rating').addEventListener('click', async e => {
  const btn = e.target.closest('.rating-btn');
  if (!btn || !store.games[openedGameId]) return;
  const val = +btn.dataset.val;
  store.games[openedGameId].rating = store.games[openedGameId].rating === val ? 0 : val;
  renderRatingPicker2(store.games[openedGameId].rating);
  await save();
});

// Изменение времени
async function setOpenedGamePoster(posterUrl) {
  const game = store.games[openedGameId];
  if (!game) return;
  game.posterUrl = String(posterUrl || '').trim();
  await save();
  openGamePage(openedGameId);
  renderLibrary();
  renderStats();
  toast(game.posterUrl ? 'Постер обновлён' : 'Постер сброшен', 'ok');
}

document.getElementById('gd2-poster-pick')?.addEventListener('click', async () => {
  const game = store.games[openedGameId];
  if (!game) return;
  const btn = document.getElementById('gd2-poster-pick');
  btn.disabled = true;
  try {
    const res = await window.api.pickPoster?.({ gameId: openedGameId, gameTitle: game.title });
    if (res?.canceled) return;
    if (!res?.ok || !res.posterUrl) {
      toast(res?.error || 'Не удалось выбрать постер', 'err');
      return;
    }
    await setOpenedGamePoster(res.posterUrl);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('gd2-poster-url')?.addEventListener('change', async e => {
  await setOpenedGamePoster(e.target.value);
});

document.getElementById('gd2-poster-reset')?.addEventListener('click', async () => {
  await setOpenedGamePoster('');
});

document.getElementById('gd2-hours-edit-btn').addEventListener('click', () => {
  const game = store.games[openedGameId];
  if (!game) return;
  document.getElementById('gd2-hours-input').value = game.hoursPlayed || 0;
  document.getElementById('gd2-hours-edit').classList.remove('hidden');
});
document.getElementById('gd2-hours-cancel').addEventListener('click', () =>
  document.getElementById('gd2-hours-edit').classList.add('hidden'));
document.getElementById('gd2-hours-ok').addEventListener('click', async () => {
  const game = store.games[openedGameId];
  if (!game) return;
  const val = parseFloat(document.getElementById('gd2-hours-input').value);
  if (isNaN(val) || val < 0) return;
  game.hoursPlayed = val;
  document.getElementById('gd2-hours').textContent = `${fmtH(val)} ч`;
  document.getElementById('gd2-hours-edit').classList.add('hidden');
  await save(); renderAll();
});

// Заметки
document.getElementById('gd2-btn-save-notes').addEventListener('click', async () => {
  const game = store.games[openedGameId];
  if (!game) return;
  game.notes = document.getElementById('gd2-notes').value;
  await save();
  toast('Заметки сохранены', 'ok');
});

// ── Теги ──
const SUGGESTED_TAGS = ['RPG','Экшен','Стратегия','Инди','Хоррор','Платформер',
  'Симулятор','Головоломка','Приключение','Мультиплеер','Сложная','Расслабляющая'];

function renderGameTags(gameId) {
  const game = store.games[gameId];
  if (!game) return;
  game.tags ??= [];
  const container = document.getElementById('gd2-tags');
  container.innerHTML = '';
  game.tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${esc(tag)}<button class="tag-chip-remove" title="Удалить">×</button>`;
    chip.querySelector('.tag-chip-remove').addEventListener('click', async () => {
      game.tags = game.tags.filter(t => t !== tag);
      renderGameTags(gameId);
      await save(); filterAndSort();
    });
    container.appendChild(chip);
  });

  // Подсказки — теги которых ещё нет у игры
  const sugg = document.getElementById('gd2-tag-suggestions');
  sugg.innerHTML = '';
  SUGGESTED_TAGS.filter(t => !game.tags.includes(t)).forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'tag-suggestion';
    btn.textContent = tag;
    btn.addEventListener('click', () => addTag(gameId, tag));
    sugg.appendChild(btn);
  });
}

async function addTag(gameId, raw) {
  const tag = raw.trim();
  if (!tag) return;
  const game = store.games[gameId];
  if (!game) return;
  game.tags ??= [];
  if (game.tags.includes(tag)) return;
  game.tags.push(tag);
  document.getElementById('gd2-tag-input').value = '';
  renderGameTags(gameId);
  await save(); filterAndSort();
}

document.getElementById('gd2-tag-add').addEventListener('click', () =>
  addTag(openedGameId, document.getElementById('gd2-tag-input').value));
document.getElementById('gd2-tag-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTag(openedGameId, e.target.value);
});

// ── Коллекции (копия для новой страницы) ──
function renderGameCollections2(gameId) {
  const container = document.getElementById('gd2-collections');
  container.innerHTML = '';
  const cols = Object.values(store.collections);
  if (!cols.length) {
    container.innerHTML = '<span class="gd-no-collections">Нет коллекций — создай в боковой панели</span>';
    return;
  }
  cols.forEach(col => {
    const inCol = col.gameIds.includes(gameId);
    const badge = document.createElement('button');
    badge.className = 'gd-coll-badge' + (inCol ? ' in-collection' : '');
    badge.innerHTML = `<span>${col.emoji}</span><span>${esc(col.name)}</span>`;
    badge.addEventListener('click', async () => {
      if (inCol) col.gameIds = col.gameIds.filter(id => id !== gameId);
      else if (!col.gameIds.includes(gameId)) col.gameIds.push(gameId);
      await save();
      renderGameCollections2(gameId);
      renderSidebarCollections();
      if (activeCollection === col.id) renderLibrary();
    });
    container.appendChild(badge);
  });
}

// ── Достижения на странице ──
function renderGameAchievements2(game) {
  const list       = document.getElementById('gd2-ach-list');
  const badge      = document.getElementById('gd2-ach-badge');
  const fetchWrap  = document.getElementById('gd2-fetch-ach-wrap');
  const manualForm = document.getElementById('gd2-manual-ach-form');

  list.innerHTML = '';
  badge.textContent = game.achievementsTotal > 0
    ? `${game.achievementsUnlocked || 0} / ${game.achievementsTotal}` : '';

  const isManual     = game.source === 'manual';
  const hasSteamKeys = store.settings.steamApiKey && store.settings.steamId;
  const hasSteamPath = !!store.settings.steamPath;
  const achievementAppId = getAchievementAppId(game);
  const canFetch = !!achievementAppId && (hasSteamKeys || hasSteamPath);
  fetchWrap.classList.toggle('hidden', !(canFetch && !game.achievements?.length));
  document.getElementById('gd2-btn-fetch-ach').classList.toggle('hidden', !hasSteamKeys || !achievementAppId);
  document.getElementById('gd2-btn-fetch-local-ach').classList.toggle('hidden', !hasSteamPath || !achievementAppId);
  manualForm.classList.toggle('hidden', !isManual);

  const sorted = [...(game.achievements || [])]
    .map((a, origIdx) => ({ ...a, origIdx }))
    .sort(sortAchievementsByRarity);
  sorted.forEach(ach => list.appendChild(makeAchItem(ach, isManual, game.id, ach.origIdx)));
}

document.getElementById('gd2-btn-add-ach').addEventListener('click', async () => {
  const name = document.getElementById('gd2-new-ach-name').value.trim();
  if (!name) return;
  const game = store.games[openedGameId];
  if (!game) return;
  game.achievements ??= [];
  game.achievements.push({ displayName: name, description: document.getElementById('gd2-new-ach-desc').value.trim(), achieved: 0, apiname: `manual_${Date.now()}` });
  document.getElementById('gd2-new-ach-name').value = '';
  document.getElementById('gd2-new-ach-desc').value = '';
  await save();
  renderGameAchievements2(game);
});

document.getElementById('gd2-btn-fetch-ach').addEventListener('click', async () => {
  const gameId = openedGameId;
  const game   = store.games[gameId];
  const appId  = getAchievementAppId(game);
  if (!game) return;
  document.getElementById('gd2-btn-fetch-ach').disabled = true;
  document.getElementById('gd2-btn-fetch-ach').textContent = '⏳ Загружаю…';
  try {
    const result = await api.steamGetAchievements({ appid: appId, apiKey: store.settings.steamApiKey, steamId: store.settings.steamId });
    if (!result?.achievements?.length) { toast('Нет достижений или ошибка', 'err'); return; }
    applyAchievementUpdate(store.games[gameId], result.achievements);
    const saved = await save();
    if (saved?.ok) renderGameAchievements2(store.games[gameId]);
  } catch(e) { toast('Ошибка: ' + e.message, 'err'); }
  finally {
    const btn = document.getElementById('gd2-btn-fetch-ach');
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Загрузить из Steam (онлайн)'; }
  }
});

document.getElementById('gd2-btn-fetch-local-ach').addEventListener('click', async () => {
  const gameId = openedGameId;
  const game   = store.games[gameId];
  const appId  = getAchievementAppId(game);
  if (!game) return;
  document.getElementById('gd2-btn-fetch-local-ach').disabled = true;
  try {
    const result = await api.steamLocalAchievements({
      appid: appId,
      steamPath: store.settings.steamPath,
      steamId: store.settings.steamId || '',
      apiKey: store.settings.steamApiKey || '',
    });
    if (!result?.achievements?.length) { toast('Локальный кеш не найден или пуст', 'err'); return; }
    applyAchievementUpdate(store.games[gameId], result.achievements);
    const saved = await save();
    if (saved?.ok) renderGameAchievements2(store.games[gameId]);
  } catch(e) { toast('Ошибка: ' + e.message, 'err'); }
  finally {
    const btn = document.getElementById('gd2-btn-fetch-local-ach');
    if (btn) { btn.disabled = false; }
  }
});

// ══════════ ДЕТАЛИ ИГРЫ ═══════════════════════════════════
function openGameModal(gameId) {
  const game = store.games[gameId];
  if (!game) return;
  openedGameId = gameId;

  // Базовые поля
  document.getElementById('gd-title').textContent     = game.title;
  document.getElementById('gd-hours').textContent     = `${fmtH(game.hoursPlayed || 0)} часов`;
  document.getElementById('gd-ach-count').textContent = `${game.achievementsUnlocked || 0} / ${game.achievementsTotal || 0}`;
  document.getElementById('gd-last').textContent      = game.lastPlayedAt
    ? new Date(game.lastPlayedAt).toLocaleDateString('ru-RU') : 'Никогда';
  document.getElementById('gd-platform').textContent  = game.platform || '—';

  // Обложка + фон героя
  const cover  = gameCover(game);
  const img    = document.getElementById('gd-cover');
  const ph     = document.getElementById('gd-cover-ph');
  const heroBg = document.getElementById('gd-hero-bg');
  if (cover) {
    img.src = cover;
    img.classList.remove('hidden');
    ph.classList.add('hidden');
    heroBg.style.backgroundImage = `url("${cover}")`;
  } else {
    img.classList.add('hidden');
    ph.classList.remove('hidden');
    heroBg.style.backgroundImage = 'none';
  }

  // Статус
  renderModalStatusPills(game.status);

  // Оценка
  renderRatingPicker(game.rating || 0);

  // Заметки — сворачиваем при открытии, показываем кнопку
  document.getElementById('gd-notes').value = game.notes || '';
  const notesWrap = document.getElementById('gd-notes-wrap');
  notesWrap.classList.add('hidden');
  const notesToggleBtn = document.getElementById('btn-notes-toggle');
  notesToggleBtn.textContent = game.notes?.trim() ? 'Редактировать' : 'Открыть';

  // Сохранения
  document.getElementById('gd-save-path').value = game.savePath || '';
  const syncEl = document.getElementById('gd-save-last-sync');
  syncEl.textContent = game.saveLastSync
    ? 'Загружено ' + new Date(game.saveLastSync).toLocaleString('ru-RU') : '';
  document.getElementById('gd-saves-section').style.display = driveConnected ? '' : 'none';

  // Теги — поле ввода скрыто по умолчанию
  document.getElementById('gd-tags-input-row').classList.add('hidden');
  renderModalTags(gameId);

  // Коллекции
  renderGameCollections(gameId);

  // Достижения
  renderGameAchievements(game);

  // Кнопка сессии
  const btnPlay = document.getElementById('btn-start-session');
  if (activeSession?.gameId === gameId) {
    btnPlay.textContent = '■ Остановить';
    btnPlay.onclick = () => { stopSession(); closeModal('modal-game'); };
  } else {
    btnPlay.textContent = '▶ Играть';
    btnPlay.onclick = async () => { await launchGameFromLauncher(gameId); closeModal('modal-game'); };
  }

  // Удалить
  const btnHide = document.getElementById('btn-hide-game');
  if (btnHide) btnHide.onclick = () => hideGameFromLibrary(gameId);

  document.getElementById('btn-delete-game').onclick = () => {
    if (!confirm(`Удалить «${game.title}»?`)) return;
    if (activeSession?.gameId === gameId) stopSession();
    delete store.games[gameId];
    save(); renderAll(); closeModal('modal-game');
    toast(`«${game.title}» удалена`, 'ok');
  };

  openModal('modal-game');
}

// ── Статус в модалке ──
function renderModalStatusPills(status) {
  document.querySelectorAll('.gd-status-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.status === status));
}
document.querySelectorAll('.gd-status-pill').forEach(pill => {
  pill.addEventListener('click', async () => {
    const game = store.games[openedGameId];
    if (!game) return;
    game.status = game.status === pill.dataset.status ? null : pill.dataset.status;
    renderModalStatusPills(game.status);
    await save();
    filterAndSort();
  });
});

// ── Теги в модалке ──
// Кеш тегов Steam по appId чтобы не фетчить повторно
const _steamTagsCache = {};

function renderModalTags(gameId, steamSuggestions = null) {
  const game = store.games[gameId];
  if (!game) return;
  game.tags ??= [];

  const container = document.getElementById('gd-tags');
  container.innerHTML = '';
  game.tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${esc(tag)}<button class="tag-chip-remove" title="Удалить">×</button>`;
    chip.querySelector('.tag-chip-remove').addEventListener('click', async () => {
      game.tags = game.tags.filter(t => t !== tag);
      renderModalTags(gameId, _steamTagsCache[game.steamAppId] || null);
      await save(); filterAndSort();
    });
    container.appendChild(chip);
  });

  // Подсказки: Steam-теги (если есть) + дефолтные, минус уже добавленные
  const sugg = document.getElementById('gd-tag-suggestions');
  sugg.innerHTML = '';
  const steamList = steamSuggestions ?? _steamTagsCache[game.steamAppId] ?? [];
  const combined  = [...new Set([...steamList, ...SUGGESTED_TAGS])];
  combined.filter(t => !game.tags.includes(t)).forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'tag-suggestion' + (steamList.includes(tag) ? ' steam-tag' : '');
    btn.textContent = tag;
    btn.addEventListener('click', () => addModalTag(gameId, tag));
    sugg.appendChild(btn);
  });

  // Фетчим Steam-теги если ещё нет
  if (game.steamAppId && !_steamTagsCache[game.steamAppId]) {
    _steamTagsCache[game.steamAppId] = []; // помечаем что уже запрашиваем
    api.steamTags(game.steamAppId).then(res => {
      if (!res?.ok) return;
      const tags = [...(res.genres || []), ...(res.categories || [])];
      _steamTagsCache[game.steamAppId] = tags;
      // Перерисовываем подсказки если модалка ещё открыта для этой игры
      if (openedGameId === gameId) renderModalTags(gameId, tags);
    });
  }
}

async function addModalTag(gameId, raw) {
  const tag = raw.trim();
  if (!tag) return;
  const game = store.games[gameId];
  if (!game) return;
  game.tags ??= [];
  if (game.tags.includes(tag)) return;
  game.tags.push(tag);
  document.getElementById('gd-tag-input').value = '';
  renderModalTags(gameId);
  await save(); filterAndSort();
}

document.getElementById('gd-tag-add').addEventListener('click', () =>
  addModalTag(openedGameId, document.getElementById('gd-tag-input').value));
document.getElementById('gd-tag-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addModalTag(openedGameId, e.target.value);
});

// Достижения в деталях игры
function renderGameAchievements(game) {
  const list       = document.getElementById('gd-ach-list');
  const badge      = document.getElementById('gd-ach-badge');
  const fetchWrap  = document.getElementById('gd-fetch-ach-wrap');
  const manualForm = document.getElementById('gd-manual-ach-form');

  list.innerHTML = '';
  badge.textContent = game.achievementsTotal > 0
    ? `${game.achievementsUnlocked || 0} / ${game.achievementsTotal}` : '';

  const isManual       = game.source === 'manual';
  const hasSteamKeys   = store.settings.steamApiKey && store.settings.steamId;
  const hasSteamPath   = !!store.settings.steamPath;
  const noAchievements = !game.achievements?.length;
  const steamAppId     = getAchievementAppId(game);
  const canFetchSteam  = !!steamAppId;

  // Первичная загрузка — если достижений нет
  fetchWrap.classList.toggle('hidden', !(canFetchSteam && noAchievements && (hasSteamKeys || hasSteamPath)));
  document.getElementById('btn-fetch-ach').classList.toggle('hidden', !hasSteamKeys || !canFetchSteam);
  document.getElementById('btn-fetch-local-ach').classList.toggle('hidden', !hasSteamPath || !canFetchSteam);

  // Тест уведомления
  document.getElementById('btn-test-achievement-notify')?.addEventListener('click', () => {
    const game = store.games[openedGameId] || { title: 'Тестовая игра' };
    const achievement = {
      displayName: 'Тестовое достижение',
      apiname: 'test_achievement',
      description: 'Это проверка того, как выглядят уведомления в стиле Steam.',
      achieved: true,
      globalPercent: 4.5,
      icon: 'https://img.icons8.com/fluency/96/trophy.png'
    };
    notifyAchievementUnlocked(game, achievement);
  });

  // Тест уведомления (боковая панель Aurora)
document.getElementById('btn-test-notif-sl')?.addEventListener('click', (e) => {
  e.stopPropagation();
  e.preventDefault();
  
  const gameId = selectedLibGameId || openedGameId;
  const game = store.games[gameId] || { title: 'Тестовая игра' };
  
  const achievement = {
    displayName: 'Тестовое достижение',
    apiname: 'test_achievement',
    description: 'Это проверка того, как выглядят уведомления в стиле Steam.',
    achieved: true,
    globalPercent: 4.5,
    icon: 'https://img.icons8.com/fluency/96/trophy.png'
  };

  toast('🔔 Тестовое уведомление отправлено!', 'ok');
  
  // Небольшая задержка чтобы пользователь успел свернуть окно если нужно
  setTimeout(() => {
    notifyAchievementUnlocked(game, achievement);
  }, 1000);
});

// Тест уведомления (новая страница)
document.getElementById('gd2-btn-test-notify')?.addEventListener('click', () => {
  const game = store.games[openedGameId] || { title: 'Тестовая игра' };
  const achievement = {
    displayName: 'Тестовое достижение',
    apiname: 'test_achievement',
    description: 'Это проверка того, как выглядят уведомления в стиле Steam.',
    achieved: true,
    globalPercent: 4.5,
    icon: 'https://img.icons8.com/fluency/96/trophy.png'
  };
  notifyAchievementUnlocked(game, achievement);
});

// Кнопка обновления — если достижения уже есть

  const refreshWrap = document.getElementById('gd-ach-refresh-wrap');
  if (refreshWrap) {
    // Показываем блок управления, если есть AppID
    const canShowAnyBtn = !!getAchievementAppId(game);
    refreshWrap.classList.toggle('hidden', !canShowAnyBtn);
    
    const onlineBtn = document.getElementById('btn-refresh-ach');
    const localBtn  = document.getElementById('btn-refresh-ach-local');
    const testBtn   = document.getElementById('btn-test-achievement-notify');

    if (onlineBtn) onlineBtn.classList.toggle('hidden', !hasSteamKeys);
    if (localBtn)  localBtn.classList.toggle('hidden', !hasSteamPath);
    if (testBtn)   testBtn.classList.toggle('hidden', false); // Тест виден всегда
  }

  // Форма добавления — только для ручных игр
  manualForm.classList.toggle('hidden', !isManual);

  // Рендер: сначала выполненные, потом нет
  const sorted = [...(game.achievements || [])]
    .map((a, origIdx) => ({ ...a, origIdx }))
    .sort(sortAchievementsByRarity);

  sorted.forEach(ach => {
    // Передаём оригинальный индекс для правильного обновления массива
    list.appendChild(makeAchItem(ach, isManual, game.id, ach.origIdx));
  });
}

// Элемент достижения
// isManual — игра добавлена вручную (показываем кнопку удаления)
// idx !== null — в контексте деталей игры (показываем тогл)
function makeAchItem(ach, isManual, _gameId, idx) {
  const item = document.createElement('div');
  item.className = 'ach-item' + (ach.achieved ? ' unlocked' : '');

  const iconSrc = ach.achieved
    ? (ach.icon || ach.iconGray || '')
    : (ach.iconGray || ach.icon || '');

  const emoji = ach.achieved ? '🏆' : '🔒';
  const imgHtml = iconSrc
    ? `<img class="ach-img" src="${esc(iconSrc)}" alt=""
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
       <div class="ach-img-placeholder" style="display:none">${emoji}</div>`
    : `<div class="ach-img-placeholder">${emoji}</div>`;

  const dateHtml = (ach.achieved && ach.unlocktime)
    ? `<div class="ach-unlock-date">🕒 ${esc(formatTimelineDate(ach.unlocktime * 1000))}</div>`
    : '';

  const rarityText = achievementRarityText(ach);
  const rarityHtml = (rarityText || isRareAchievement(ach))
    ? `<div class="ach-rarity">
        ${isRareAchievement(ach) ? '<span class="ach-rarity-badge">Редкое</span>' : ''}
        ${rarityText ? `<span class="ach-rarity-percent">${rarityText}</span>` : ''}
      </div>`
    : '';

  const displayName = safeAchName(ach.displayName, ach.apiname);

  let actionsHtml = '';
  if (idx !== null) {
    const toggleTitle = ach.achieved ? 'Снять отметку' : 'Отметить выполненным';
    const toggleIcon = ach.achieved ? '✓' : '○';
    actionsHtml = `
      <div class="ach-item-actions">
        <button class="ach-toggle" title="${toggleTitle}"
          onclick="toggleAch(${idx})">${toggleIcon}</button>
        ${isManual
          ? `<button class="ach-delete" title="Удалить" onclick="deleteManualAch(${idx})">✕</button>`
          : ''}
      </div>`;
  }

  item.innerHTML = `
    <div class="ach-img-wrap">${imgHtml}</div>
    <div class="ach-body">
      <div class="ach-name">${esc(displayName)}</div>
      ${ach.description ? `<div class="ach-desc">${esc(ach.description)}</div>` : ''}
      ${(dateHtml || rarityHtml) ? `<div class="ach-meta-row">${dateHtml}${rarityHtml}</div>` : ''}
    </div>
    ${actionsHtml}
  `;
  return item;
}

// Проверяет и очищает название достижения
function safeAchName(displayName, apiname) {
  if (displayName && displayName.trim() && !/^[A-Z0-9_]{4,}$/.test(displayName.trim()))
    return displayName.trim();
  if (!apiname) return 'Достижение';
  // Humanize: убираем префиксы, подчёркивания → пробелы
  return apiname
    .replace(/^(ACH|ACHIEVEMENT|ACHV|STEAM|GLOBAL)_?/i, '')
    .replace(/_/g, ' ').trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase()) || 'Достижение';
}

function getNewlyUnlockedAchievements(prevAchievements = [], nextAchievements = []) {
  const prevMap = new Map();
  prevAchievements.forEach((achievement, idx) => {
    prevMap.set(achievementKey(achievement, idx), !!achievement.achieved);
  });
  return nextAchievements.filter((achievement, idx) =>
    achievement.achieved && !prevMap.get(achievementKey(achievement, idx))
  );
}

function achievementStateMap(achievements = []) {
  const map = new Map();
  achievements.forEach((achievement, idx) => {
    map.set(achievementKey(achievement, idx), {
      achieved: !!achievement.achieved,
      unlocktime: Number(achievement.unlocktime) || 0,
    });
  });
  return map;
}

function getSessionUnlockedAchievements(session, nextAchievements = []) {
  if (!session || !session.achievementBaseline) return [];
  const sessionStartSec = Math.floor((session.startTime || Date.now()) / 1000);
  return nextAchievements.filter((achievement, idx) => {
    if (!achievement.achieved) return false;
    const key = achievementKey(achievement, idx);
    const baseline = session.achievementBaseline.get(key);
    if (baseline && baseline.achieved) return false;
    const unlocktime = Number(achievement.unlocktime) || 0;
    return !baseline || !unlocktime || unlocktime >= sessionStartSec - 5;
  });
}

function refreshAchievementCounterViews(game) {
  const text = `${game.achievementsUnlocked || 0} / ${game.achievementsTotal || 0}`;
  const ids = ['gd-ach-count', 'gd2-ach-count', 'sl-ach-count'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
}

function buildSessionOverlayData() {
  const session = activeSession || readStoredOverlaySession();
  if (!session) return { active: false };

  const game = store.games[session.gameId];
  if (!game) return { active: false };

  const sessionStartSec = Math.floor((session.startTime || Date.now()) / 1000);
  const achievements = (game.achievements || []).map(normalizeAchievement);
  const unlockedThisSession = achievements
    .filter(achievement => achievement.achieved && Number(achievement.unlocktime || 0) >= sessionStartSec - 5)
    .sort((a, b) => Number(b.unlocktime || 0) - Number(a.unlocktime || 0))
    .slice(0, 8);
  const nextAchievements = achievements
    .filter(achievement => !achievement.achieved)
    .sort(sortAchievementsByRarity)
    .slice(0, 5);

  return {
    active: true,
    game: {
      title: game.title || game.name || 'Игра',
      cover: gameCover(game) || gamePoster(game) || '',
      platform: syncSourceName(game),
      hoursPlayed: Number(game.hoursPlayed || 0),
    },
    session: {
      startedAt: session.startTime,
      elapsedMs: Date.now() - session.startTime,
    },
    achievements: {
      unlocked: game.achievementsUnlocked || achievements.filter(a => a.achieved).length,
      total: game.achievementsTotal || achievements.length,
      unlockedThisSession,
      next: nextAchievements,
    },
  };
}

function pushOverlayData() {
  ensureOverlaySession();
  api.sendOverlayData(buildSessionOverlayData());
}

function storeOverlaySession(gameId, startTime) {
  try {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify({ gameId, startTime }));
  } catch {}
}

function clearStoredOverlaySession() {
  try {
    sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {}
}

function readStoredOverlaySession() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) || 'null');
    if (!parsed?.gameId || !store.games?.[parsed.gameId]) return null;
    const startTime = Number(parsed.startTime || 0);
    if (!Number.isFinite(startTime) || startTime <= 0) return null;
    return { gameId: parsed.gameId, startTime };
  } catch {
    return null;
  }
}

if (api.onOverlayRequest) {
  api.onOverlayRequest(pushOverlayData);
}

document.addEventListener('keydown', event => {
  if (event.key === 'F8' || (event.shiftKey && event.key === 'Tab')) {
    event.preventDefault();
    pushOverlayData();
    api.toggleOverlay?.();
  }
});

function inferOverlayGameId() {
  if (activeSession?.gameId) return activeSession.gameId;
  if (selectedLibGameId && store.games[selectedLibGameId]) return selectedLibGameId;
  if (openedGameId && store.games[openedGameId]) return openedGameId;
  return '';
}

function ensureOverlaySession() {
  if (activeSession) return;
  const stored = readStoredOverlaySession();
  if (stored) {
    const game = store.games[stored.gameId];
    if (!game) return;
    const interval = setInterval(() => {
      const timerEl = document.getElementById('np-timer');
      if (timerEl) timerEl.textContent = fmtSeconds(Math.floor((Date.now() - stored.startTime) / 1000));
    }, 1000);
    activeSession = {
      gameId: stored.gameId,
      startTime: stored.startTime,
      timerInterval: interval,
      achievementBaseline: achievementStateMap(game.achievements || []),
    };
    document.getElementById('np-game').textContent = game.title;
    document.getElementById('np-cover').src = gameCover(game) || '';
    document.getElementById('now-playing').classList.remove('hidden');
    return;
  }

  const gameId = inferOverlayGameId();
  if (!gameId) return;
  startSession(gameId);
  const game = store.games[gameId];
  if (game && store.settings.steamPath && canPollSteamAchievements(game)) {
    startActiveAchievementPolling(gameId);
  }
}

function showAchievementUnlockedPopup(game, achievement) {
  const feed = document.getElementById('achievement-feed');
  if (!feed) return false;

  const achievementName = safeAchName(achievement.displayName, achievement.apiname);
  const icon = achievement.icon || achievement.iconGray || gameCover(game) || gamePoster(game) || '';
  const rare = isRareAchievement(achievement);
  const meta = [];
  if (rare) meta.push('Редкое достижение');
  const rarityText = achievementRarityText(achievement);
  if (rarityText) meta.push(rarityText);
  if (!meta.length) meta.push('Получено только что');

  const item = document.createElement('article');
  item.className = `achievement-notice${rare ? ' rare' : ''}`;
  item.innerHTML = `
    <div class="achievement-notice-icon-wrap">
      ${icon
        ? `<img class="achievement-notice-icon" src="${esc(icon)}" alt=""/>`
        : `<div class="achievement-notice-icon-ph">🏆</div>`}
    </div>
    <div class="achievement-notice-copy">
      <div class="achievement-notice-game">${esc(game.title || 'Игра')}</div>
      <div class="achievement-notice-name">${esc(achievementName)}</div>
      <div class="achievement-notice-meta">${meta.map(part => `<span>${esc(part)}</span>`).join('')}</div>
    </div>
    <div class="achievement-notice-pill">${rare ? 'Редкое' : 'Новое'}</div>
  `;

  const dismiss = () => {
    if (item._closing) return;
    item._closing = true;
    clearTimeout(item._hideTimer);
    item.classList.remove('is-visible');
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 260);
  };

  item.addEventListener('mouseenter', () => clearTimeout(item._hideTimer));
  item.addEventListener('mouseleave', () => {
    clearTimeout(item._hideTimer);
    item._hideTimer = setTimeout(dismiss, 2200);
  });
  item.addEventListener('click', dismiss);

  feed.prepend(item);
  while (feed.children.length > 4) {
    feed.lastElementChild?.remove();
  }

  requestAnimationFrame(() => item.classList.add('is-visible'));
  item._hideTimer = setTimeout(dismiss, ACHIEVEMENT_NOTICE_TTL_MS);
  return true;
}

function notifyAchievementUnlocked(game, achievement) {
  const achievementName = safeAchName(achievement.displayName, achievement.apiname);
  const shownInLauncher = showAchievementUnlockedPopup(game, achievement);
  
  // Вызываем внешнее уведомление (стиль Steam)
  api.showAchievementNotification({ game, achievement });
  pushOverlayData();

  if (!shownInLauncher) {
    toast(`🏆 ${game.title}: ${achievementName}`, 'ok');
  }

  if (typeof Notification === 'undefined') return;

  const showSystemNotification = () => {
    const rarityText = achievementRarityText(achievement);
    const body = [
      'Получено достижение',
      rarityText ? `• ${rarityText}` : '',
    ].filter(Boolean).join(' ');
    try {
      new Notification(game.title, {
        body: `${body}: ${achievementName}`,
        icon: achievement.icon || achievement.iconGray || gameCover(game) || '',
        silent: false,
      });
    } catch {}
  };

  if (Notification.permission === 'granted') {
    showSystemNotification();
    return;
  }

  if (Notification.permission === 'default' && !notificationPermissionRequested) {
    notificationPermissionRequested = true;
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') showSystemNotification();
    }).catch(() => {});
  }
}

async function syncPolledAchievements(gameId, options = {}) {
  const { notify = true, rerender = true } = options;
  const game = store.games[gameId];
  if (!game) return { ok: false, changed: false, unlockedNow: [] };

  const appid = getAchievementAppId(game);
  const steamPath = store.settings.steamPath;
  if (!appid || !steamPath || !canPollSteamAchievements(game)) {
    return { ok: false, changed: false, unlockedNow: [] };
  }

  const result = await api.steamLocalAchievements({
    steamPath,
    steamId: store.settings.steamId || '',
    appid,
    apiKey: store.settings.steamApiKey || '',
  });
  if (!result?.ok || !Array.isArray(result.achievements)) {
    return { ok: false, changed: false, unlockedNow: [] };
  }

  const prevTotal = game.achievementsTotal || 0;
  const prevUnlocked = game.achievementsUnlocked || 0;
  const prevAchievements = (game.achievements || []).map(normalizeAchievement);
  const polledAchievements = result.achievements.map(normalizeAchievement);
  const session = activeSession?.gameId === gameId ? activeSession : null;
  let unlockedNow = [];

  if (session) {
    if (session.achievementBaseline) {
      unlockedNow = getSessionUnlockedAchievements(session, polledAchievements);
    } else {
      // При первом опросе в сессии — запоминаем текущее состояние как базу
      session.achievementBaseline = achievementStateMap(polledAchievements);
      unlockedNow = [];
    }
    // Всегда обновляем базу после каждого опроса, чтобы ловить только «новые»
    session.achievementBaseline = achievementStateMap(polledAchievements);
  }

  applyAchievementUpdate(game, polledAchievements, { preserveAchieved: !session });
  if (!session) {
    unlockedNow = getNewlyUnlockedAchievements(prevAchievements, game.achievements);
  }
  const changed = prevTotal !== game.achievementsTotal || prevUnlocked !== game.achievementsUnlocked;
  if (!unlockedNow.length && !changed) {
    return { ok: true, changed: false, unlockedNow: [] };
  }

  refreshAchievementCounterViews(game);
  if (notify) unlockedNow.forEach(achievement => notifyAchievementUnlocked(game, achievement));
  await save();

  if (rerender) {
    if (selectedLibGameId === gameId) openGameDetail(gameId);
    if (openedGameId === gameId) renderGameAchievements(game);
    if (openedGameId === gameId && isViewActive('game-detail')) renderGameAchievements2(game);
    if (isViewActive('achievements')) renderAchievements();
    if (isViewActive('stats')) renderStats();
    renderDashboard();
  }

  return { ok: true, changed, unlockedNow };
}

function stopActiveAchievementPolling() {
  activeAchievementPollToken += 1;
  if (activeAchievementPollTimeout) {
    clearTimeout(activeAchievementPollTimeout);
    activeAchievementPollTimeout = null;
  }
  if (activeAchievementPoller) {
    clearInterval(activeAchievementPoller);
    activeAchievementPoller = null;
  }
  activeAchievementPollBusy = false;
}

function startActiveAchievementPolling(gameId) {
  stopActiveAchievementPolling();

  const game = store.games[gameId];
  if (!game || !store.settings.steamPath || !canPollSteamAchievements(game)) return;
  const pollToken = activeAchievementPollToken;

  const poll = async () => {
    if (pollToken !== activeAchievementPollToken) return;
    if (activeAchievementPollBusy) return;
    if (!activeSession || activeSession.gameId !== gameId) {
      stopActiveAchievementPolling();
      return;
    }
    activeAchievementPollBusy = true;
    try {
      await syncPolledAchievements(gameId);
    } finally {
      activeAchievementPollBusy = false;
    }
  };

  syncPolledAchievements(gameId, { notify: true }).catch(() => {});
  activeAchievementPollTimeout = setTimeout(() => {
    activeAchievementPollTimeout = null;
    if (pollToken !== activeAchievementPollToken) return;
    if (!activeSession || activeSession.gameId !== gameId) return;
    poll();
    activeAchievementPoller = setInterval(poll, ACHIEVEMENT_POLL_INTERVAL_MS);
  }, ACHIEVEMENT_POLL_DELAY_MS);
}

async function launchGameFromLauncher(gameId) {
  const game = store.games[gameId];
  if (!game) return false;

  startSession(gameId);

  if (canLaunchLocally(game)) {
    const result = await api.launchLocalGame({ launchPath: getLaunchPath(game) });
    if (!result?.ok) {
      stopSession();
      toast(result?.error || 'Не удалось запустить игру', 'err');
      return false;
    }
    await api.watchGameProcess({
      processNames: [result.processName],
      baselineProcessNames: result.baselineProcessNames,
    });
    startActiveAchievementPolling(gameId);
    return true;
  }

  if (game.appid) {
    api.openExternal('steam://run/' + game.appid);
    await api.watchGameProcess();
    startActiveAchievementPolling(gameId);
    return true;
  }

  toast('Запущен только таймер сессии. Чтобы игра запускалась сама, укажи .exe или Steam AppID.', 'ok');
  return true;
}

// ══════════ ТОГЛЫ ДОСТИЖЕНИЙ (для всех игр) ══════════════
window.toggleAch = async (idx) => {
  const game = store.games[openedGameId];
  if (!game?.achievements?.[idx]) return;
  const ach      = game.achievements[idx];
  const wasUnlocked = !!ach.achieved;
  ach.achieved   = ach.achieved ? 0 : 1;
  if (ach.achieved) {
    ach.unlocktime = Math.floor(Date.now() / 1000);
  }
  if (!ach.achieved) ach.unlocktime = 0;
  game.achievementsUnlocked = game.achievements.filter(a => a.achieved).length;
  refreshAchievementCounterViews(game);
  await save();
  if (!wasUnlocked && ach.achieved) notifyAchievementUnlocked(game, ach);
  renderGameAchievements(game);
  renderAll();
};

window.deleteManualAch = async (idx) => {
  const game = store.games[openedGameId];
  if (!game) return;
  game.achievements.splice(idx, 1);
  game.achievementsTotal    = game.achievements.length;
  game.achievementsUnlocked = game.achievements.filter(a => a.achieved).length;
  await save(); renderGameAchievements(game); renderAll();
};

document.getElementById('btn-add-ach').addEventListener('click', async () => {
  const name = document.getElementById('new-ach-name').value.trim();
  if (!name) return;
  const desc = document.getElementById('new-ach-desc').value.trim();
  const game = store.games[openedGameId];
  if (!game) return;

  if (!game.achievements) game.achievements = [];
  game.achievements.push({
    apiname: `manual_${Date.now()}`, displayName: name, description: desc,
    achieved: 0, unlocktime: 0, icon: '', iconGray: '',
  });
  game.achievementsTotal    = game.achievements.length;
  game.achievementsUnlocked = game.achievements.filter(a => a.achieved).length;

  document.getElementById('new-ach-name').value = '';
  document.getElementById('new-ach-desc').value = '';
  await save(); renderGameAchievements(game); renderAll();
});

// ══════════ ЗАГРУЗИТЬ ДОСТИЖЕНИЯ ИЗ STEAM ════════════════
document.getElementById('btn-fetch-ach').addEventListener('click', async () => {
  const game = store.games[openedGameId];
  if (!game) return;
  const { steamApiKey: apiKey, steamId } = store.settings;
  const appid = getAchievementAppId(game);
  if (!apiKey || !steamId || !appid) return;

  const btn = document.getElementById('btn-fetch-ach');
  btn.textContent = '⏳ Загружаю…'; btn.disabled = true;

  const result = await api.steamGetAchievements({ apiKey, steamId, appid });
  btn.disabled = false; btn.textContent = '🔄 Загрузить достижения из Steam (онлайн)';

  if (!result.ok) { toast('Ошибка загрузки достижений: ' + result.error, 'err'); return; }

  applyAchievementUpdate(game, result.achievements);
  await save(); renderGameAchievements(game); renderAll();
  toast(`Загружено ${result.achievementsTotal} достижений!`, 'ok');
});

// Обновить онлайн (Steam API)
document.getElementById('btn-refresh-ach').addEventListener('click', async () => {
  const game = store.games[openedGameId];
  if (!game) return;
  const { steamApiKey: apiKey, steamId } = store.settings;
  if (!apiKey || !steamId) { toast('Нужны Steam API ключ и Steam ID', 'err'); return; }

  const btn = document.getElementById('btn-refresh-ach');
  btn.textContent = '⏳…'; btn.disabled = true;

  const appid  = getAchievementAppId(game);
  const result = await api.steamGetAchievements({ apiKey, steamId, appid });
  btn.textContent = '🔄 Онлайн'; btn.disabled = false;

  if (!result.ok) { toast('Ошибка: ' + result.error, 'err'); return; }

  applyAchievementUpdate(game, result.achievements, { preserveAchieved: false });
  await save();
  renderGameAchievements(game);
  renderAll();
  toast(`Обновлено: ${game.achievementsUnlocked} / ${game.achievementsTotal}`, 'ok');
});

// Обновить локально (Steam кеш)
document.getElementById('btn-refresh-ach-local').addEventListener('click', async () => {
  const gameId = openedGameId;
  const game   = store.games[gameId];
  if (!game) return;
  const { steamPath, steamId, steamApiKey: apiKey } = store.settings;
  if (!steamPath) { toast('Укажи путь к папке Steam в настройках импорта', 'err'); return; }

  const btn = document.getElementById('btn-refresh-ach-local');
  btn.textContent = '⏳…'; btn.disabled = true;

  const result = await api.steamLocalAchievements({
    steamPath,
    steamId:  steamId  || '',
    appid:    game.steamAppId || game.appid,
    apiKey:   apiKey   || '',
  });
  btn.textContent = '💾 Локально'; btn.disabled = false;

  if (!result.ok) { toast('Ошибка: ' + result.error, 'err'); return; }

  applyAchievementUpdate(game, result.achievements, { preserveAchieved: false });
  await save();
  renderGameAchievements(store.games[gameId]);
  renderAll();
  toast(`Обновлено локально: ${game.achievementsUnlocked} / ${game.achievementsTotal}`, 'ok');
});

// Применить обновление достижений — сохраняет ручные отметки
function applyAchievementUpdate(game, newAchs, options = {}) {
  const preserveAchieved = options.preserveAchieved !== false;
  const prevMap = {};
  (game.achievements || []).forEach((achievement, idx) => {
    const normalized = normalizeAchievement(achievement);
    achievementMatchKeys(normalized, idx).forEach(key => {
      if (!(key in prevMap)) prevMap[key] = normalized;
    });
  });
  game.achievements = newAchs.map((achievement, idx) => {
    const normalized = normalizeAchievement(achievement);
    const prev = achievementMatchKeys(normalized, idx)
      .map(key => prevMap[key])
      .find(Boolean);
    const achieved = achievement.achieved || (preserveAchieved && prev?.achieved ? 1 : 0);
    const unlocktime = Number(achievement.unlocktime)
      || (preserveAchieved && achieved && prev?.unlocktime ? Number(prev.unlocktime) : 0)
      || (preserveAchieved && achieved && prev?.achieved ? Math.floor(Date.now() / 1000) : 0);
    return normalizeAchievement({
      ...achievement,
      icon: achievement.icon || prev?.icon || '',
      iconGray: achievement.iconGray || achievement.icon_gray || prev?.iconGray || prev?.icon_gray || '',
      achieved,
      unlocktime,
    });
  });
  game.achievementsTotal    = game.achievements.length;
  game.achievementsUnlocked = game.achievements.filter(a => a.achieved).length;
}

// ══════════ ЛОКАЛЬНЫЙ КЕШ STEAM ═══════════════════════════
document.getElementById('btn-fetch-local-ach').addEventListener('click', async () => {
  // Захватываем gameId ДО первого await — чтобы он не сменился пока идёт запрос
  const gameId = openedGameId;
  const game   = store.games[gameId];
  const appid = getAchievementAppId(game);
  if (!appid) return;
  const { steamPath, steamId } = store.settings;
  if (!steamPath) {
    toast('Укажи путь к папке Steam в настройках импорта', 'err'); return;
  }

  const btn = document.getElementById('btn-fetch-local-ach');
  btn.textContent = '⏳ Читаю локальный кеш…'; btn.disabled = true;

  const result = await api.steamLocalAchievements({
    steamPath,
    steamId: steamId || '',
    appid,
    apiKey:  store.settings.steamApiKey || '',
  });
  btn.disabled = false; btn.textContent = '💾 Загрузить из локального кеша Steam';

  if (!result.ok) { toast('Ошибка: ' + result.error, 'err'); return; }

  // Записываем явно в store.games[gameId], чтобы данные точно попали в хранилище
  const g = store.games[gameId];
  if (!g) { toast('Игра была удалена, обновление невозможно', 'err'); return; }
  g.achievements         = result.achievements;
  g.achievementsUnlocked = result.achievementsUnlocked;
  g.achievementsTotal    = result.achievementsTotal;

  const saved = await save();
  if (saved?.ok) {
    renderGameAchievements(g);
    renderAll();
    toast(`Из локального кеша: ${result.achievementsUnlocked} / ${result.achievementsTotal} достижений`, 'ok');
  }
});

// ══════════ ОЦЕНКА ════════════════════════════════════════
function renderRatingPicker(value) {
  document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.val) <= value);
  });
}

document.getElementById('gd-rating').addEventListener('click', async (e) => {
  const btn = e.target.closest('.rating-btn');
  if (!btn || !openedGameId) return;
  const game = store.games[openedGameId];
  if (!game) return;
  const val = parseInt(btn.dataset.val);
  game.rating = (game.rating === val) ? 0 : val;   // повторный клик снимает оценку
  renderRatingPicker(game.rating);
  await save(); renderAll();
});

// ══════════ РЕДАКТИРОВАНИЕ ВРЕМЕНИ ═══════════════════════
document.getElementById('gd-hours-pill').addEventListener('click', () => {
  const game = store.games[openedGameId];
  if (!game) return;
  document.getElementById('gd-hours-input').value = +(game.hoursPlayed || 0).toFixed(1);
  document.getElementById('gd-hours-edit').classList.remove('hidden');
  document.getElementById('gd-hours-input').focus();
});

document.getElementById('btn-hours-ok').addEventListener('click', async () => {
  const game = store.games[openedGameId];
  if (!game) return;
  const val = parseFloat(document.getElementById('gd-hours-input').value);
  if (!isNaN(val) && val >= 0) {
    game.hoursPlayed = +val.toFixed(3);
    document.getElementById('gd-hours').textContent = `${fmtH(game.hoursPlayed)} ч`;
    await save(); renderAll();
    toast('Время обновлено', 'ok');
  }
  document.getElementById('gd-hours-edit').classList.add('hidden');
});

document.getElementById('btn-hours-cancel').addEventListener('click', () => {
  document.getElementById('gd-hours-edit').classList.add('hidden');
});

// ══════════ ЗАМЕТКИ ════════════════════════════════════════
document.getElementById('btn-notes-toggle').addEventListener('click', () => {
  const wrap = document.getElementById('gd-notes-wrap');
  const btn  = document.getElementById('btn-notes-toggle');
  const open = wrap.classList.toggle('hidden');
  btn.textContent = open ? (store.games[openedGameId]?.notes?.trim() ? 'Редактировать' : 'Открыть') : 'Скрыть';
  if (!open) document.getElementById('gd-notes').focus();
});

document.getElementById('btn-save-notes').addEventListener('click', async () => {
  const game = store.games[openedGameId];
  if (!game) return;
  game.notes = document.getElementById('gd-notes').value;
  const btn  = document.getElementById('btn-notes-toggle');
  btn.textContent = game.notes?.trim() ? 'Редактировать' : 'Открыть';
  await save(); renderAll();
  toast('Заметки сохранены', 'ok');
});

// ── Toggle поля ввода тегов ──
document.getElementById('btn-tag-input-toggle').addEventListener('click', () => {
  const row = document.getElementById('gd-tags-input-row');
  const isHidden = row.classList.toggle('hidden');
  if (!isHidden) document.getElementById('gd-tag-input').focus();
});

// ══════════ СЕССИЯ ════════════════════════════════════════
function startSession(gameId) {
  if (activeSession) stopSession();
  stopActiveAchievementPolling();
  const game = store.games[gameId];
  if (!game) return;

  const startTime = Date.now();
  document.getElementById('np-game').textContent = game.title;
  const cover = gameCover(game);
  document.getElementById('np-cover').src = cover || '';
  document.getElementById('now-playing').classList.remove('hidden');

  const interval = setInterval(() => {
    document.getElementById('np-timer').textContent =
      fmtSeconds(Math.floor((Date.now() - startTime) / 1000));
    pushOverlayData();
  }, 1000);

  activeSession = {
    gameId,
    startTime,
    timerInterval: interval,
    achievementBaseline: achievementStateMap(game.achievements || []),
  };
  storeOverlaySession(gameId, startTime);
  pushOverlayData();
  toast(`▶ Трекинг: ${game.title}`, 'ok');
}

function stopSession() {
  if (!activeSession) return;
  stopActiveAchievementPolling();
  clearInterval(activeSession.timerInterval);
  const minutes = (Date.now() - activeSession.startTime) / 1000 / 60;
  const gameId  = activeSession.gameId;
  activeSession = null;
  clearStoredOverlaySession();
  pushOverlayData();
  document.getElementById('now-playing').classList.add('hidden');
  document.getElementById('np-timer').textContent = '00:00:00';

  const trackedGame = store.games[gameId];
  if (trackedGame && store.settings.steamPath && canPollSteamAchievements(trackedGame)) {
    syncPolledAchievements(gameId, { notify: true }).catch(() => {});
  }

  if (minutes < 0.5) return;

  const game = store.games[gameId];
  if (!game) return;
  game.hoursPlayed  = +((game.hoursPlayed || 0) + minutes / 60).toFixed(3);
  game.lastPlayedAt = new Date().toISOString();
  game.sessions     = [...(game.sessions || []), { date: new Date().toISOString(), minutes: Math.round(minutes) }].slice(-200);

  save(); renderAll();
  toast(`Сессия сохранена: +${Math.round(minutes)} мин`, 'ok');
}

document.getElementById('btn-stop-session').addEventListener('click', stopSession);

// Авто-стоп когда игровой процесс завершился
api.onGameProcessExited(() => {
  if (activeSession) stopSession();
});

// Сохранение сессии при закрытии приложения
api.onAppRequestClose(async () => {
  if (activeSession) {
    stopActiveAchievementPolling();
    clearInterval(activeSession.timerInterval);
    const minutes = (Date.now() - activeSession.startTime) / 1000 / 60;
    const closingGameId = activeSession.gameId;
    const game = store.games[closingGameId];
    if (game && store.settings.steamPath && canPollSteamAchievements(game)) {
      await syncPolledAchievements(closingGameId, { notify: true, rerender: false }).catch(() => {});
    }
    if (game && minutes >= 0.5) {
      game.hoursPlayed  = +((game.hoursPlayed || 0) + minutes / 60).toFixed(3);
      game.lastPlayedAt = new Date().toISOString();
      game.sessions     = [...(game.sessions || []), { date: new Date().toISOString(), minutes: Math.round(minutes) }].slice(-200);
    }
    activeSession = null;
    clearStoredOverlaySession();
    store = normalizeStore(store);
    await api.saveData(store);
  }
  api.readyToClose();
});

// ══════════ ДОБАВИТЬ ВРУЧНУЮ ══════════════════════════════
document.getElementById('btn-add-game').addEventListener('click', () => openModal('modal-add-game'));

document.getElementById('btn-pick-launch-path').addEventListener('click', async () => {
  const filePath = await api.pickExecutable();
  if (!filePath) return;
  document.getElementById('ag-launch-path').value = filePath;
});

document.getElementById('btn-do-add').addEventListener('click', async () => {
  const title    = document.getElementById('ag-title').value.trim();
  const platform = document.getElementById('ag-platform').value;
  const steamAppId = document.getElementById('ag-appid').value.trim();
  const launchPath = document.getElementById('ag-launch-path').value.trim();
  const hours    = parseFloat(document.getElementById('ag-hours').value) || 0;
  const cover    = document.getElementById('ag-cover').value.trim();
  const errEl    = document.getElementById('ag-error');

  errEl.classList.add('hidden');
  if (!title) { errEl.textContent = 'Введи название игры.'; errEl.classList.remove('hidden'); return; }

  const gameId = `manual_${Date.now()}`;
  store.games[gameId] = {
    id: gameId, title, platform, hoursPlayed: hours,
    coverUrl: cover, source: 'manual',
    steamAppId,
    launchPath,
    achievements: [], achievementsUnlocked: 0, achievementsTotal: 0,
    sessions: [], notes: '', rating: 0,
    addedAt:      new Date().toISOString(),
    lastPlayedAt: hours > 0 ? new Date().toISOString() : null,
  };
  await save(); renderAll();
  closeModal('modal-add-game');
  ['ag-title','ag-appid','ag-launch-path','ag-hours','ag-cover'].forEach(id => document.getElementById(id).value = '');
  toast(`«${title}» добавлена!`, 'ok');
});

// ══════════ ПОИСК ИКОНОК ICONS8 ═══════════════════════════
document.getElementById('btn-search-icon').addEventListener('click', () => {
  const gameTitle = document.getElementById('ag-title').value.trim();
  document.getElementById('icon-search-input').value = gameTitle || '';
  document.getElementById('icon-search-results').innerHTML = '';
  document.getElementById('icon-search-status').classList.add('hidden');
  openModal('modal-icon-search');
  setTimeout(() => document.getElementById('icon-search-input').focus(), 150);
});

document.getElementById('icon-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doIconSearch();
});
document.getElementById('btn-do-icon-search').addEventListener('click', doIconSearch);

async function doIconSearch() {
  const query = document.getElementById('icon-search-input').value.trim();
  if (!query) return;

  const statusEl = document.getElementById('icon-search-status');
  const resultsEl = document.getElementById('icon-search-results');
  
  statusEl.textContent = 'Ищу иконки...';
  statusEl.classList.remove('hidden');
  resultsEl.innerHTML = '';

  // Определяем контекст: для игры или для коллекции
  const isForCollection = !document.getElementById('modal-collection').classList.contains('hidden');

  try {
    // Icons8 API (бесплатный поиск)
    const searchQuery = encodeURIComponent(query);
    const apiUrl = `https://search.icons8.com/api/iconsets/v5/search?term=${searchQuery}&amount=24&platform=all`;
    
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error('Ошибка поиска');
    
    const data = await response.json();
    
    if (!data.icons || data.icons.length === 0) {
      statusEl.textContent = 'Иконки не найдены. Попробуйте другой запрос.';
      return;
    }

    statusEl.classList.add('hidden');
    
    data.icons.forEach(icon => {
      const item = document.createElement('div');
      item.className = 'icon-result-item';
      
      // Пробуем разные форматы иконок Icons8
      const formats = [
        `https://img.icons8.com/fluency/96/${icon.commonName}.png`,
        `https://img.icons8.com/color/96/${icon.commonName}.png`,
        `https://img.icons8.com/3d-fluency/96/${icon.commonName}.png`,
        `https://img.icons8.com/emoji/96/${icon.commonName}.png`,
        `https://img.icons8.com/doodle/96/${icon.commonName}.png`,
      ];
      const iconUrl = formats[0]; // Используем первый формат по умолчанию
      
      item.innerHTML = `
        <img src="${iconUrl}" alt="${esc(icon.name)}" 
             onerror="this.onerror=null; this.src='${formats[1]}'; 
                      this.onerror=function(){this.src='${formats[2]}'; 
                      this.onerror=function(){this.src='https://img.icons8.com/fluency/96/image.png';}}" />
        <div class="icon-result-label">${esc(icon.name)}</div>
      `;
      
      item.addEventListener('click', () => {
        const selectedUrl = item.querySelector('img').src;
        if (isForCollection) {
          // Для коллекции: устанавливаем иконку как изображение
          const emojiBtn = document.getElementById('mc-emoji');
          emojiBtn.innerHTML = `<img src="${selectedUrl}" alt="${esc(icon.name)}" />`;
          emojiBtn.dataset.iconUrl = selectedUrl;
        } else {
          // Для игры: вставляем URL в поле обложки
          document.getElementById('ag-cover').value = selectedUrl;
        }
        closeModal('modal-icon-search');
        toast('Иконка выбрана!', 'ok');
      });
      
      resultsEl.appendChild(item);
    });
    
  } catch (error) {
    statusEl.textContent = 'Ошибка: ' + error.message + '. Проверьте подключение к интернету.';
    statusEl.classList.remove('hidden');
  }
}

// ══════════ ПОИСК ИГРЫ В STEAM ════════════════════════════
document.getElementById('btn-open-search').addEventListener('click', () => {
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-status').classList.add('hidden');
  document.getElementById('game-search-input').value = '';
  openModal('modal-search');
  setTimeout(() => document.getElementById('game-search-input').focus(), 150);
});

document.getElementById('game-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSteamSearch();
});
document.getElementById('btn-do-search').addEventListener('click', doSteamSearch);

async function doSteamSearch() {
  const q = document.getElementById('game-search-input').value.trim();
  if (!q) return;

  const status  = document.getElementById('search-status');
  const results = document.getElementById('search-results');
  results.innerHTML = '';
  status.textContent = 'Ищу…'; status.classList.remove('hidden');
  document.getElementById('btn-do-search').disabled = true;

  const res = await api.steamSearch(q);
  document.getElementById('btn-do-search').disabled = false;

  if (!res.ok || !res.results?.length) {
    status.textContent = res.error || 'Ничего не найдено. Попробуй другое название.';
    return;
  }

  status.classList.add('hidden');
  const alreadyAdded = new Set(Object.values(store.games).map(g => g.appid).filter(Boolean));

  res.results.forEach(item => {
    const appid    = String(item.appid);
    const iconUrl  = item.icon
      ? `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${appid}/${item.icon}.jpg`
      : '';
    const isAdded  = alreadyAdded.has(appid);

    const row = document.createElement('div');
    row.className = 'search-result-item';
    row.innerHTML = `
      ${iconUrl ? `<img class="search-result-icon" src="${iconUrl}" alt="" onerror="this.style.display='none'" />` : '<div class="search-result-icon" style="background:var(--bg3)"></div>'}
      <div class="search-result-name">
        ${esc(item.name)}
        <div class="search-result-appid">App ID: ${appid}</div>
      </div>
      <button class="btn-add-result${isAdded ? ' added' : ''}" data-appid="${appid}" data-name="${esc(item.name)}" data-icon="${esc(iconUrl)}" ${isAdded ? 'disabled' : ''}>
        ${isAdded ? '✓ Добавлена' : '＋ Добавить'}
      </button>
    `;

    row.querySelector('.btn-add-result').addEventListener('click', async function() {
      if (isAdded) return;
      await addSteamGame(appid, item.name);
      this.textContent = '✓ Добавлена';
      this.classList.add('added');
      this.disabled = true;
      alreadyAdded.add(appid);
    });

    results.appendChild(row);
  });
}

async function addSteamGame(appid, name) {
  const gameId  = `steam_${appid}`;
  const coverUrl = steamLegacyHeaderUrl(appid);

  store.games[gameId] = {
    id: gameId, title: name, appid,
    platform: 'Steam', hoursPlayed: 0,
    coverUrl, source: 'steam',
    achievements: [], achievementsUnlocked: 0, achievementsTotal: 0,
    sessions: [], notes: '', rating: 0,
    addedAt: new Date().toISOString(), lastPlayedAt: null,
  };
  await save(); renderAll();
  toast(`«${name}» добавлена!`, 'ok');

  // Автозагрузка достижений если есть ключи
  const { steamApiKey: apiKey, steamId } = store.settings;
  if (apiKey && steamId) {
    const res = await api.steamGetAchievements({ apiKey, steamId, appid });
    if (res.ok && res.achievements.length > 0) {
      store.games[gameId].achievements         = res.achievements;
      store.games[gameId].achievementsUnlocked = res.achievementsUnlocked;
      store.games[gameId].achievementsTotal    = res.achievementsTotal;
      await save(); renderAll();
      toast(`Загружено ${res.achievementsTotal} достижений для «${name}»`, 'ok');
    }
  }
}

function mergeSteamImportGames(games = []) {
  const syncedAt = new Date().toISOString();
  let added = 0;
  let updated = 0;

  games.forEach(g => {
    const gameId = `steam_${g.appid}`;
    const prev = store.games[gameId] || {};
    if (prev.id && prev.steamSyncDisabled) return;
    const legacyCoverUrl = steamLegacyHeaderUrl(g.appid);
    const prevCoverUrl = String(prev.coverUrl || '').trim();
    const nextCoverUrl = prevCoverUrl && !isSteamLegacyArtworkUrl(prevCoverUrl)
      ? prevCoverUrl
      : legacyCoverUrl;
    const nextPosterUrl = String(prev.posterUrl || '').trim();
    const importedLastPlayedAt = g.rtime_last_played
      ? new Date(g.rtime_last_played * 1000).toISOString()
      : null;
    const nextLastPlayedAt = latestIsoDate(importedLastPlayedAt, prev.lastPlayedAt);
    const nextLaunchPath = String(prev.launchPath || '').trim();

    const next = {
      ...prev,
      id: gameId,
      title: g.name || prev.title || `Игра ${g.appid}`,
      appid: String(g.appid),
      platform: 'Steam',
      hoursPlayed: +((g.playtime_forever || 0) / 60).toFixed(2),
      coverUrl: nextCoverUrl,
      posterUrl: nextPosterUrl,
      source: 'steam',
      isSharedLibrary: Boolean(g.isSharedLibrary),
      importedFromLocal: Boolean(g.importedFromLocal),
      achievements: g.achievements?.length ? g.achievements : (prev.achievements || []),
      achievementsUnlocked: g.achievementsUnlocked ?? prev.achievementsUnlocked ?? 0,
      achievementsTotal: g.achievementsTotal ?? prev.achievementsTotal ?? 0,
      sessions: prev.sessions || [],
      notes: prev.notes || '',
      rating: prev.rating || 0,
      status: prev.status || null,
      tags: prev.tags || [],
      screenshots: prev.screenshots || [],
      launchPath: nextLaunchPath,
      savePath: prev.savePath || '',
      saveLastSync: prev.saveLastSync || null,
      steamSyncDisabled: !!prev.steamSyncDisabled,
      lastPlayedAt: nextLastPlayedAt,
      importedAt: prev.importedAt || syncedAt,
      syncedAt,
    };

    const changed = !store.games[gameId]
      || prev.title !== next.title
      || Number(prev.hoursPlayed || 0) !== Number(next.hoursPlayed || 0)
      || Number(prev.achievementsUnlocked || 0) !== Number(next.achievementsUnlocked || 0)
      || Number(prev.achievementsTotal || 0) !== Number(next.achievementsTotal || 0)
      || String(prev.lastPlayedAt || '') !== String(next.lastPlayedAt || '')
      || String(prev.coverUrl || '') !== String(next.coverUrl || '')
      || String(prev.posterUrl || '') !== String(next.posterUrl || '')
      || String(prev.launchPath || '') !== String(next.launchPath || '')
      || Boolean(prev.isSharedLibrary) !== Boolean(next.isSharedLibrary);

    store.games[gameId] = next;
    if (!prev.id) added++;
    else if (changed) updated++;
  });

  return { added, updated };
}

function mergeEaImportGames(games = []) {
  const syncedAt = new Date().toISOString();
  let added = 0;
  let updated = 0;

  games.forEach(g => {
    const slug = String(g.eaSlug || g.slug || '').trim();
    if (!slug) return;

    const gameId = `ea_${slug}`;
    const prev = store.games[gameId] || {};
    const importedHours = Number(g.hoursPlayed || 0);
    const nextHours = g.hoursDetected
      ? importedHours
      : Number(prev.hoursPlayed || 0);
    const nextLastPlayedAt = latestIsoDate(g.lastPlayedAt, prev.lastPlayedAt);
    const nextAchievements = g.achievements?.length
      ? g.achievements.map(normalizeAchievement)
      : (prev.achievements || []);
    const nextCover = String(g.coverUrl || '').trim() || prev.coverUrl || '';
    const nextPoster = String(g.posterUrl || '').trim() || prev.posterUrl || nextCover || '';
    const nextLaunchPath = String(g.launchPath || '').trim() || prev.launchPath || '';
    const nextSteamAppId = String(g.steamAppId || '').trim() || String(prev.steamAppId || '').trim() || '';

    const next = {
      ...prev,
      id: gameId,
      title: g.title || prev.title || slug,
      platform: 'EA App',
      source: 'ea',
      eaSlug: slug,
      eaOfferId: g.eaOfferId || prev.eaOfferId || '',
      masterTitleId: g.masterTitleId || prev.masterTitleId || '',
      steamAppId: nextSteamAppId,
      installed: Boolean(g.installed),
      hoursPlayed: +Number(nextHours || 0).toFixed(2),
      coverUrl: nextCover,
      posterUrl: nextPoster,
      launchPath: nextLaunchPath,
      achievements: nextAchievements,
      achievementsUnlocked: g.achievements?.length
        ? (g.achievementsUnlocked ?? nextAchievements.filter(a => a.achieved).length)
        : (prev.achievementsUnlocked ?? 0),
      achievementsTotal: g.achievements?.length
        ? (g.achievementsTotal ?? nextAchievements.length)
        : (prev.achievementsTotal ?? 0),
      sessions: prev.sessions || [],
      notes: prev.notes || '',
      rating: prev.rating || 0,
      status: prev.status || null,
      tags: prev.tags || [],
      screenshots: prev.screenshots || [],
      savePath: prev.savePath || '',
      saveLastSync: prev.saveLastSync || null,
      lastPlayedAt: nextLastPlayedAt,
      importedAt: prev.importedAt || syncedAt,
      syncedAt,
    };

    const changed = !store.games[gameId]
      || prev.title !== next.title
      || Number(prev.hoursPlayed || 0) !== Number(next.hoursPlayed || 0)
      || Number(prev.achievementsUnlocked || 0) !== Number(next.achievementsUnlocked || 0)
      || Number(prev.achievementsTotal || 0) !== Number(next.achievementsTotal || 0)
      || String(prev.lastPlayedAt || '') !== String(next.lastPlayedAt || '')
      || String(prev.coverUrl || '') !== String(next.coverUrl || '')
      || String(prev.posterUrl || '') !== String(next.posterUrl || '')
      || String(prev.launchPath || '') !== String(next.launchPath || '')
      || Boolean(prev.installed) !== Boolean(next.installed)
      || String(prev.eaOfferId || '') !== String(next.eaOfferId || '')
      || String(prev.masterTitleId || '') !== String(next.masterTitleId || '')
      || String(prev.steamAppId || '') !== String(next.steamAppId || '');

    store.games[gameId] = next;
    if (!prev.id) added++;
    else if (changed) updated++;
  });

  return { added, updated };
}

async function syncSteamOnLaunch() {
  const { steamApiKey: apiKey, steamId, steamPath } = store.settings;
  if (!apiKey || !steamId) return;

  try {
    const result = await api.steamImport({ apiKey, steamId, steamPath });
    if (!result?.ok || !Array.isArray(result.games)) return;

    const stats = mergeSteamImportGames(result.games);
    if (!stats.added && !stats.updated) return;

    if (store?.settings?.hideJokes) {
      store = removeJokeGamesFromStore(store);
    }
    await save();
    renderAll();
    toast(
      stats.added
        ? `Steam синхронизирован: ${stats.added} новых, ${stats.updated} обновлено`
        : `Steam синхронизирован: обновлено ${stats.updated} игр`,
      'ok'
    );
  } catch (err) {
    console.warn('Steam startup sync failed', err);
  }
}

async function syncEaOnLaunch() {
  const hasEaGames = Object.values(store.games || {}).some(game => game.source === 'ea');
  if (!store.settings.eaSyncEnabled && !hasEaGames) return;

  try {
    const result = await api.eaImport();
    if (!result?.ok || !Array.isArray(result.games) || !result.games.length) return;

    const stats = mergeEaImportGames(result.games);
    if (!stats.added && !stats.updated) return;

    if (store?.settings?.hideJokes) {
      store = removeJokeGamesFromStore(store);
    }
    await save();
    renderAll();
    toast(
      stats.added
        ? `EA App синхронизирован: ${stats.added} новых, ${stats.updated} обновлено`
        : `EA App синхронизирован: обновлено ${stats.updated} игр`,
      'ok'
    );
  } catch (err) {
    console.warn('EA startup sync failed', err);
  }
}

// ══════════ ИМПОРТ БИБЛИОТЕКИ STEAM ══════════════════════
document.getElementById('btn-steam-import').addEventListener('click', () => {
  // Подставить сохранённые ключи
  if (store.settings.steamApiKey) document.getElementById('steam-api-key').value = store.settings.steamApiKey;
  if (store.settings.steamId)     document.getElementById('steam-id').value = store.settings.steamId;
  if (store.settings.steamPath)   document.getElementById('steam-path').value = store.settings.steamPath;
  openModal('modal-steam');
});

document.getElementById('link-steam-key').addEventListener('click', (e) => {
  e.preventDefault(); api.openExternal('https://steamcommunity.com/dev/apikey');
});

document.getElementById('btn-do-import').addEventListener('click', async () => {
  const apiKey    = document.getElementById('steam-api-key').value.trim();
  const steamId   = document.getElementById('steam-id').value.trim();
  const steamPath = document.getElementById('steam-path').value.trim();
  const errEl   = document.getElementById('steam-error');
  const progWrap = document.getElementById('steam-progress');
  const fill     = document.getElementById('steam-fill');
  const progText = document.getElementById('steam-progress-text');
  const btn      = document.getElementById('btn-do-import');

  errEl.classList.add('hidden');
  if (!apiKey || !steamId) {
    errEl.textContent = 'Заполни оба поля.'; errEl.classList.remove('hidden'); return;
  }

  btn.disabled = true;
  progWrap.classList.remove('hidden');
  fill.style.width = '10%'; progText.textContent = 'Подключаюсь к Steam…';

  const result = await api.steamImport({ apiKey, steamId, steamPath });

  if (!result.ok) {
    btn.disabled = false; progWrap.classList.add('hidden');
    errEl.textContent = result.error || 'Импорт не удался.'; errEl.classList.remove('hidden');
    return;
  }

  fill.style.width = '60%'; progText.textContent = `Найдено ${result.games.length} игр. Сохраняю…`;

  store.settings.steamApiKey = apiKey;
  store.settings.steamId     = steamId;
  if (steamPath) store.settings.steamPath = steamPath;

  mergeSteamImportGames(result.games);

  fill.style.width = '100%'; progText.textContent = 'Готово!';
  await save(); renderAll();

  setTimeout(() => {
    btn.disabled = false; progWrap.classList.add('hidden'); fill.style.width = '0%';
    closeModal('modal-steam');
    toast(`Импортировано ${result.games.length} игр из Steam!`, 'ok');
  }, 700);
});

// ══════════ БЭКАП ═════════════════════════════════════════
document.getElementById('btn-ea-import').addEventListener('click', () => {
  document.getElementById('ea-error').classList.add('hidden');
  document.getElementById('ea-progress').classList.add('hidden');
  document.getElementById('ea-fill').style.width = '0%';
  document.getElementById('ea-progress-text').textContent = 'РЎРєР°РЅРёСЂСѓСЋ EA DesktopвЂ¦';
  openModal('modal-ea');
});

document.getElementById('btn-do-ea-import').addEventListener('click', async () => {
  const errEl    = document.getElementById('ea-error');
  const progWrap = document.getElementById('ea-progress');
  const fill     = document.getElementById('ea-fill');
  const progText = document.getElementById('ea-progress-text');
  const btn      = document.getElementById('btn-do-ea-import');

  errEl.classList.add('hidden');
  btn.disabled = true;
  progWrap.classList.remove('hidden');
  fill.style.width = '12%';
  progText.textContent = 'Р§РёС‚Р°СЋ Р»РѕРєР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ EA DesktopвЂ¦';

  const result = await api.eaImport();

  if (!result?.ok) {
    btn.disabled = false;
    progWrap.classList.add('hidden');
    errEl.textContent = result?.error || 'РРјРїРѕСЂС‚ РёР· EA App РЅРµ СѓРґР°Р»СЃСЏ.';
    errEl.classList.remove('hidden');
    return;
  }

  if (!Array.isArray(result.games) || !result.games.length) {
    btn.disabled = false;
    progWrap.classList.add('hidden');
    errEl.textContent = 'Р’ Р»РѕРєР°Р»СЊРЅС‹С… РґР°РЅРЅС‹С… EA App РЅРµ РЅР°С€Р»РѕСЃСЊ РёРіСЂ РґР»СЏ РёРјРїРѕСЂС‚Р°.';
    errEl.classList.remove('hidden');
    return;
  }

  fill.style.width = '64%';
  progText.textContent = `РќР°Р№РґРµРЅРѕ ${result.games.length} РёРіСЂ. РЎРѕС…СЂР°РЅСЏСЋвЂ¦`;

  store.settings.eaSyncEnabled = true;
  mergeEaImportGames(result.games);

  fill.style.width = '100%';
  progText.textContent = 'Р“РѕС‚РѕРІРѕ!';
  await save();
  renderAll();

  setTimeout(() => {
    btn.disabled = false;
    progWrap.classList.add('hidden');
    fill.style.width = '0%';
    closeModal('modal-ea');
    toast(`РРјРїРѕСЂС‚РёСЂРѕРІР°РЅРѕ ${result.games.length} РёРіСЂ РёР· EA App!`, 'ok');
  }, 700);
});

document.getElementById('btn-backup').addEventListener('click', () => {
  const lastEl = document.getElementById('backup-last');
  if (store.lastBackup) {
    lastEl.textContent = `Последний бэкап: ${new Date(store.lastBackup).toLocaleString('ru-RU')}`;
    lastEl.classList.remove('hidden');
  } else { lastEl.classList.add('hidden'); }
  document.getElementById('backup-error').classList.add('hidden');
  openModal('modal-backup');
});

document.getElementById('btn-sff-open')?.addEventListener('click', async () => {
  if (!api.openSffApp) {
    toast('Запуск SteaMidra недоступен в этой сборке', 'err');
    return;
  }

  const result = await api.openSffApp();
  if (result?.ok) {
    toast('SteaMidra запускается', 'ok');
  } else {
    toast(result?.error || 'Не удалось открыть SteaMidra', 'err');
  }
});

document.getElementById('btn-sff-install')?.addEventListener('click', async e => {
  if (!api.installSffApp) {
    toast('Установка SteaMidra недоступна в этой сборке', 'err');
    return;
  }

  const btn = e.currentTarget;
  const oldText = btn.querySelector('span:last-child')?.textContent || 'Установить / обновить SteaMidra';
  btn.disabled = true;
  const label = btn.querySelector('span:last-child');
  if (label) label.textContent = 'Устанавливаю SteaMidra...';
  toast('Установка SteaMidra началась. Это может занять несколько минут.', 'ok');

  const result = await api.installSffApp();
  btn.disabled = false;
  if (label) label.textContent = oldText;

  if (result?.ok) {
    toast('SteaMidra установлена и переведена на русский', 'ok');
  } else {
    toast(result?.error || 'Не удалось установить SteaMidra', 'err');
  }
});

document.getElementById('btn-export').addEventListener('click', async () => {
  const result = await api.exportBackup(store);
  if (result.ok) {
    store.lastBackup = new Date().toISOString();
    await save(); closeModal('modal-backup'); toast('Резервная копия сохранена!', 'ok');
  } else if (result.error) {
    document.getElementById('backup-error').textContent = result.error;
    document.getElementById('backup-error').classList.remove('hidden');
  }
});

document.getElementById('btn-import').addEventListener('click', async () => {
  if (!confirm('Это заменит ВСЕ текущие данные. Продолжить?')) return;
  const result = await api.importBackup();
  if (!result.ok) {
    if (result.error) {
      document.getElementById('backup-error').textContent = result.error;
      document.getElementById('backup-error').classList.remove('hidden');
    }
    return;
  }
  if (!result.data?.games) {
    document.getElementById('backup-error').textContent = 'Файл повреждён или неверного формата.';
    document.getElementById('backup-error').classList.remove('hidden');
    return;
  }
  store = result.data;
  store.settings    ??= {};
  store.collections ??= {};
  initializeLibrarySidebarState();
  await save(); renderAll(); closeModal('modal-backup'); toast('Данные восстановлены!', 'ok');
});

// ══════════ МОДАЛКИ ═══════════════════════════════════════
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => closeModal(el.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
});

// ══════════ УТИЛИТЫ ═══════════════════════════════════════
function isImportedAddonLikeGame(game = {}) {
  const source = String(game.source || '').toLowerCase();
  const platform = String(game.platform || '').toLowerCase();
  if (source !== 'ea' && platform !== 'ea app') return false;
  if (game.coverUrl || game.posterUrl || game.steamAppId || game.appid) return false;

  const title = normalizeAchievementMatchText(game.title || game.name || game.eaSlug || '');
  return /\b(apocalypse|deluxe|upgrade|expansion|pack|pass|bundle|hellfighter|heroes of the great war|in the name of the tsar|they shall not pass|turning tides|technical playtest)\b/.test(title);
}

function isGameHidden(game = {}) {
  return !!game.hidden || isImportedAddonLikeGame(game);
}

function hiddenGamesList() {
  return Object.values(store.games || {})
    .filter(game => !!game.hidden)
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ru'));
}

function gamesList({ includeHidden = false } = {}) {
  const list = Object.values(store.games || {});
  return includeHidden ? list : list.filter(game => !isGameHidden(game));
}

function gameCover(game) {
  if (game.coverUrl) return game.coverUrl;
  if (game.posterUrl) return game.posterUrl;
  const appId = String(game.steamAppId || game.appid || '').trim();
  if (appId) return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
  return '';
}

function gamePoster(game) {
  if (game.posterUrl) return game.posterUrl;
  const appId = String(game.steamAppId || game.appid || '').trim();
  if (appId) return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`;
  return game.coverUrl || '';
}

function fmtH(h) {
  if (h >= 1000) return Math.round(h).toLocaleString('ru');
  if (h >= 10)   return Math.round(h);
  return (+h).toFixed(1);
}

function fmtSeconds(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  return [h, m, sc].map(n => String(n).padStart(2, '0')).join(':');
}

function calcStreak(list) {
  const days = new Set();
  list.forEach(g => (g.sessions||[]).forEach(s =>
    days.add(new Date(s.date).toISOString().slice(0,10))
  ));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    if (days.has(d.toISOString().slice(0,10))) streak++;
    else if (i > 0) break;
  }
  return streak;
}

function updateSidebarStats() {
  const statsEl = document.getElementById('sidebar-stats');
  if (!statsEl) return;
  const list = gamesList();
  const h    = list.reduce((s, g) => s + (g.hoursPlayed || 0), 0);
  statsEl.textContent = `${list.length} игр · ${fmtH(h)} ч`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 3000);
}
