const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fetch = require('node-fetch');
const fsSync = require('fs');
const { pathToFileURL } = require('url');

let mainWindow;
const getDataPath = () => path.join(app.getPath('userData'), 'gametracker-data.json');

// в”Ђв”Ђ РћРєРЅРѕ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300, height: 840,
    minWidth: 960, minHeight: 620,
    frame: false,
    backgroundColor: '#0a0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  mainWindow.loadFile('renderer/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // РџРµСЂРµС…РІР°С‚С‹РІР°РµРј Р·Р°РєСЂС‹С‚РёРµ вЂ” РїСЂРѕСЃРёРј СЂРµРЅРґРµСЂРµСЂ СЃРѕС…СЂР°РЅРёС‚СЊ СЃРµСЃСЃРёСЋ РїРµСЂРµРґ РІС‹С…РѕРґРѕРј
  mainWindow.on('close', e => {
    if (mainWindow._readyToClose) return;
    e.preventDefault();
    mainWindow.webContents.send('app:request-close');
    // РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ Р·Р°РєСЂС‹РІР°РµРј С‡РµСЂРµР· 2СЃ РµСЃР»Рё СЂРµРЅРґРµСЂРµСЂ РЅРµ РѕС‚РІРµС‚РёР»
    setTimeout(() => {
      mainWindow._readyToClose = true;
      mainWindow.close();
    }, 2000);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// в”Ђв”Ђ РЈРїСЂР°РІР»РµРЅРёРµ РѕРєРЅРѕРј в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window:close', () => mainWindow.close());
ipcMain.on('app:ready-to-close', () => {
  mainWindow._readyToClose = true;
  mainWindow.close();
});
ipcMain.on('open:external', (_e, url) => shell.openExternal(url));

// РЎРёРЅС…СЂРѕРЅРЅРѕРµ СЃРѕС…СЂР°РЅРµРЅРёРµ (РґР»СЏ beforeunload)
ipcMain.on('data:save-sync', (e, data) => {
  try {
    require('fs').writeFileSync(getDataPath(), JSON.stringify(data, null, 2), 'utf-8');
    e.returnValue = { ok: true };
  } catch (err) {
    e.returnValue = { ok: false, error: err.message };
  }
});

// РќР°Р±Р»СЋРґР°С‚РµР»СЊ Р·Р° РёРіСЂРѕРІС‹Рј РїСЂРѕС†РµСЃСЃРѕРј
let gameWatcher = null;
const gameWatcherIgnoredProcessNames = new Set([
  'conhost.exe',
  'crashpad_handler.exe',
  'electron.exe',
  'game tracker.exe',
  'steam.exe',
  'steamservice.exe',
  'steamwebhelper.exe',
]);

function normalizeProcessNames(names = []) {
  return Array.isArray(names)
    ? names.map(name => String(name || '').trim().toLowerCase()).filter(Boolean)
    : [];
}

function snapshotProcessNames() {
  const { execSync } = require('child_process');
  try {
    return new Set(
      execSync('tasklist /FO CSV /NH', { encoding: 'utf8', windowsHide: true })
        .split('\n')
        .map(l => l.split(',')[0]?.replace(/"/g, '').toLowerCase())
        .filter(Boolean)
    );
  } catch { return new Set(); }
}

function isTrackableGameProcessName(name) {
  return name && !gameWatcherIgnoredProcessNames.has(name);
}

function stopGameWatcher() {
  if (gameWatcher) {
    clearInterval(gameWatcher);
    gameWatcher = null;
  }
}
ipcMain.handle('game:startWatch', (_e, opts = {}) => {
  stopGameWatcher();

  const targetNames = normalizeProcessNames(opts.processNames);
  const baseline = new Set(normalizeProcessNames(opts.baselineProcessNames));
  if (!baseline.size) {
    snapshotProcessNames().forEach(name => baseline.add(name));
  }

  if (targetNames.length) {
    const startedAt = Date.now();
    const candidateNames = new Set(targetNames);
    let sawTrackedProcess = false;
    let idleChecks = 0;

    gameWatcher = setInterval(() => {
      const running = snapshotProcessNames();
      const canDiscoverProcesses = Date.now() - startedAt <= 120000;
      running.forEach(name => {
        if (canDiscoverProcesses && !baseline.has(name) && isTrackableGameProcessName(name)) {
          candidateNames.add(name);
        }
      });

      const hasCandidate = [...candidateNames].some(name => running.has(name));
      if (hasCandidate) {
        sawTrackedProcess = true;
        idleChecks = 0;
        return;
      }

      idleChecks += 1;
      const waitedMs = Date.now() - startedAt;
      if ((sawTrackedProcess && idleChecks >= 15) || (!sawTrackedProcess && waitedMs >= 45000)) {
        stopGameWatcher();
        mainWindow?.webContents.send('game:processExited');
      }
    }, 4000);
    return { ok: true };
  }

  const startedAt = Date.now();
  const candidateNames = new Set();
  let sawTrackedProcess = false;
  let idleChecks = 0;

  gameWatcher = setInterval(() => {
    const running = snapshotProcessNames();
    const canDiscoverProcesses = Date.now() - startedAt <= 180000;
    running.forEach(name => {
      if (canDiscoverProcesses && !baseline.has(name) && isTrackableGameProcessName(name)) {
        candidateNames.add(name);
      }
    });

    const hasCandidate = [...candidateNames].some(name => running.has(name));
    if (hasCandidate) {
      sawTrackedProcess = true;
      idleChecks = 0;
      return;
    }

    idleChecks += 1;
    const waitedMs = Date.now() - startedAt;
    if ((sawTrackedProcess && idleChecks >= 12) || (!sawTrackedProcess && waitedMs >= 180000)) {
      stopGameWatcher();
      mainWindow?.webContents.send('game:processExited');
    }
  }, 5000);

  return { ok: true };
});

ipcMain.handle('game:pickExecutable', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Р’С‹Р±РµСЂРё РёСЃРїРѕР»РЅСЏРµРјС‹Р№ С„Р°Р№Р» РёРіСЂС‹',
    properties: ['openFile'],
    filters: [
      { name: 'РСЃРїРѕР»РЅСЏРµРјС‹Рµ С„Р°Р№Р»С‹', extensions: ['exe'] },
      { name: 'Р’СЃРµ С„Р°Р№Р»С‹', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return '';
  return res.filePaths[0];
});

ipcMain.handle('game:launchLocal', async (_e, { launchPath }) => {
  try {
    const normalizedPath = String(launchPath || '').trim();
    if (!normalizedPath) return { ok: false, error: 'РџСѓС‚СЊ Рє РёРіСЂРµ РЅРµ СѓРєР°Р·Р°РЅ' };
    if (!fsSync.existsSync(normalizedPath)) {
      return { ok: false, error: `Р¤Р°Р№Р» РЅРµ РЅР°Р№РґРµРЅ: ${normalizedPath}` };
    }

    const baselineProcessNames = [...snapshotProcessNames()];

    // shell.openPath использует ShellExecute — корректно обрабатывает UAC
    const errMsg = await shell.openPath(normalizedPath);
    if (errMsg) return { ok: false, error: errMsg };

    return {
      ok: true,
      processName: path.basename(normalizedPath).toLowerCase(),
      launchPath: normalizedPath,
      baselineProcessNames,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// в”Ђв”Ђ Р›РѕРєР°Р»СЊРЅРѕРµ С…СЂР°РЅРёР»РёС‰Рµ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
ipcMain.handle('data:load', async () => {
  try { return JSON.parse((await fs.readFile(getDataPath(), 'utf-8')).replace(/^\uFEFF/, '')); }
  catch { return { games: {}, settings: {}, lastBackup: null }; }
});
ipcMain.handle('data:save', async (_e, data) => {
  try { await fs.writeFile(getDataPath(), JSON.stringify(data, null, 2), 'utf-8'); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

// в”Ђв”Ђ Р‘СЌРєР°Рї в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const SCREENSHOT_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

function safePathPart(value = 'item') {
  const cleaned = String(value || 'item')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return cleaned || 'item';
}

function screenshotsRoot() {
  return path.join(app.getPath('userData'), 'screenshots');
}

function postersRoot() {
  return path.join(app.getPath('userData'), 'posters');
}

function screenshotGameDir(gameId) {
  return path.join(screenshotsRoot(), safePathPart(gameId || 'game'));
}

function screenshotUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function imageMimeType(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

async function uniqueFilePath(dir, preferredName) {
  const ext = path.extname(preferredName);
  const base = path.basename(preferredName, ext) || 'screenshot';
  let candidate = path.join(dir, preferredName);
  let counter = 1;
  while (fsSync.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

function assertInsideScreenshotsRoot(filePath) {
  const root = path.resolve(screenshotsRoot());
  const target = path.resolve(filePath || '');
  if (!target.startsWith(root + path.sep)) {
    throw new Error('File is outside screenshots storage');
  }
  return target;
}

ipcMain.handle('screenshots:add', async (_e, { gameId, gameTitle } = {}) => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: `Р”РѕР±Р°РІРёС‚СЊ СЃРєСЂРёРЅС€РѕС‚С‹${gameTitle ? `: ${gameTitle}` : ''}`,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };

    const targetDir = screenshotGameDir(gameId || gameTitle || 'game');
    await fs.mkdir(targetDir, { recursive: true });

    const now = Date.now();
    const screenshots = [];
    for (const [idx, sourcePath] of res.filePaths.entries()) {
      const ext = path.extname(sourcePath).toLowerCase();
      if (!SCREENSHOT_EXTS.has(ext)) continue;
      const sourceStat = await fs.stat(sourcePath).catch(() => null);
      if (!sourceStat?.isFile()) continue;

      const sourceName = path.basename(sourcePath, ext);
      const preferredName = `${now}_${idx}_${safePathPart(sourceName)}${ext}`;
      const destPath = await uniqueFilePath(targetDir, preferredName);
      await fs.copyFile(sourcePath, destPath);
      const destStat = await fs.stat(destPath).catch(() => sourceStat);

      screenshots.push({
        id: `shot_${now}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'image',
        title: sourceName || `РЎРєСЂРёРЅС€РѕС‚ ${idx + 1}`,
        fileName: path.basename(destPath),
        localPath: destPath,
        url: screenshotUrl(destPath),
        addedAt: new Date().toISOString(),
        size: destStat?.size || sourceStat.size || 0,
        mimeType: imageMimeType(destPath),
      });
    }

    return { ok: true, screenshots };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('screenshots:resolve', async (_e, { gameId, screenshots = [] } = {}) => {
  try {
    const gameDir = screenshotGameDir(gameId || 'game');
    const resolved = (Array.isArray(screenshots) ? screenshots : []).map(shot => {
      const fileName = safePathPart(shot.fileName || path.basename(shot.localPath || '') || '');
      const localPath = shot.localPath && fsSync.existsSync(shot.localPath)
        ? shot.localPath
        : (fileName ? path.join(gameDir, fileName) : '');
      const exists = localPath && fsSync.existsSync(localPath);
      return {
        ...shot,
        fileName: fileName || shot.fileName || '',
        localPath: exists ? localPath : (shot.localPath || localPath || ''),
        url: exists ? screenshotUrl(localPath) : (shot.url || ''),
      };
    });
    return { ok: true, screenshots: resolved };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('screenshots:deleteLocal', async (_e, { localPath } = {}) => {
  try {
    if (!localPath) return { ok: true };
    const target = assertInsideScreenshotsRoot(localPath);
    if (fsSync.existsSync(target)) await fs.unlink(target);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('backup:export', async (_e, data) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'РЎРѕС…СЂР°РЅРёС‚СЊ СЂРµР·РµСЂРІРЅСѓСЋ РєРѕРїРёСЋ',
    defaultPath: `gametracker-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled) return { ok: false };
  try { await fs.writeFile(r.filePath, JSON.stringify({ ...data, exportedAt: new Date().toISOString(), version: 1 }, null, 2), 'utf-8'); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('backup:import', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Р—Р°РіСЂСѓР·РёС‚СЊ СЂРµР·РµСЂРІРЅСѓСЋ РєРѕРїРёСЋ',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  try { return { ok: true, data: JSON.parse(await fs.readFile(r.filePaths[0], 'utf-8')) }; }
  catch (err) { return { ok: false, error: 'РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ С„Р°Р№Р»: ' + err.message }; }
});

// в•ђв•ђ STEAM в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

// Р•СЃС‚СЊ Р»Рё РєРёСЂРёР»Р»РёС†Р° РІ СЃС‚СЂРѕРєРµ
const EA_LOCAL_LOG_DIR = path.join(process.env.LOCALAPPDATA || '', 'Electronic Arts', 'EA Desktop', 'Logs');
const EA_BACKGROUND_LOG_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'EA Desktop', 'Logs');
const EA_BROWSER_CACHE_DIR = path.join(
  process.env.LOCALAPPDATA || '',
  'Electronic Arts',
  'EA Desktop',
  'CEF',
  'BrowserCache',
  'EADesktop',
  'Cache',
  'Cache_Data'
);
const EA_STEAM_MATCH_CACHE = new Map();
const STEAM_COMMUNITY_ACHIEVEMENTS_CACHE = new Map();
const STEAM_APP_DETAILS_CACHE = new Map();

function decodeXmlEntities(value = '') {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => {
      try { return String.fromCodePoint(parseInt(code, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_m, code) => {
      try { return String.fromCodePoint(parseInt(code, 10)); } catch { return ''; }
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseEaAttributes(raw = '') {
  const attrs = {};
  String(raw || '').replace(/([\w:-]+)="([^"]*)"/g, (_m, key, value) => {
    attrs[key] = decodeXmlEntities(value);
    return '';
  });
  return attrs;
}

function humanizeEaSlug(slug = '') {
  const stopWords = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to', 'vs']);
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part, idx) => {
      const clean = String(part || '').trim();
      if (!clean) return '';
      if (/^\d+$/.test(clean)) return clean;
      if (/^[a-z]\d+$/i.test(clean)) return clean.toUpperCase();
      const lower = clean.toLowerCase();
      if (idx > 0 && stopWords.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ')
    .replace(/\bEa\b/g, 'EA')
    .replace(/\bNhl\b/g, 'NHL')
    .replace(/\bNba\b/g, 'NBA')
    .replace(/\bFps\b/g, 'FPS')
    .replace(/\bDlc\b/g, 'DLC')
    .trim();
}

function normalizeEaCompareText(value = '') {
  return String(value || '')
    .replace(/[\u2122\u00ae\u00a9]/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\u0400-\u04FF]+/g, ' ')
    .trim()
    .toLowerCase();
}

function unescapeEaLogString(value = '') {
  return String(value || '')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function isEaInstalledStatus(status = '') {
  return ['installed', 'installing', 'repairing', 'updating', 'queued'].includes(String(status || '').trim().toLowerCase());
}

function ensureEaEntry(map, slug) {
  const cleanSlug = String(slug || '').trim();
  if (!cleanSlug) return null;
  if (!map.has(cleanSlug)) {
    map.set(cleanSlug, {
      slug: cleanSlug,
      title: '',
      softwareIds: new Set(),
      softwareStatuses: new Map(),
      offerIds: new Set(),
      masterTitleId: '',
      installPath: '',
      launchPath: '',
      achievements: [],
      achievementsUnlocked: 0,
      achievementsTotal: 0,
      hoursPlayed: 0,
      hoursDetected: false,
      lastPlayedAt: null,
    });
  }
  return map.get(cleanSlug);
}

function collectEaLogFiles() {
  const dirs = [EA_LOCAL_LOG_DIR, EA_BACKGROUND_LOG_DIR];
  const files = [];

  dirs.forEach(dirPath => {
    if (!dirPath || !fsSync.existsSync(dirPath)) return;
    let entries = [];
    try {
      entries = fsSync.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.forEach(entry => {
      if (!entry.isFile()) return;
      if (!/\.(log|bak)$/i.test(entry.name)) return;
      if (!/(EA|EADesktop|Background|Connect|Origin)/i.test(entry.name)) return;

      const fullPath = path.join(dirPath, entry.name);
      try {
        const stat = fsSync.statSync(fullPath);
        files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // ignore unreadable files
      }
    });
  });

  return files
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))
    .map(file => {
      try {
        return { ...file, text: fsSync.readFileSync(file.path, 'utf8') };
      } catch {
        return null;
      }
    })
    .filter(file => file && file.text);
}

function collectEaCacheFiles() {
  if (!EA_BROWSER_CACHE_DIR || !fsSync.existsSync(EA_BROWSER_CACHE_DIR)) return [];

  let entries = [];
  try {
    entries = fsSync.readdirSync(EA_BROWSER_CACHE_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(entry => entry.isFile() && /^data_\d+$/i.test(entry.name))
    .map(entry => {
      const fullPath = path.join(EA_BROWSER_CACHE_DIR, entry.name);
      try {
        const stat = fsSync.statSync(fullPath);
        return { path: fullPath, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
    .map(file => {
      try {
        return { ...file, text: fsSync.readFileSync(file.path, 'latin1') };
      } catch {
        return null;
      }
    })
    .filter(file => file && file.text);
}

function normalizeEaAchievementImageId(imageId = '') {
  return String(imageId || '')
    .trim()
    .replace(/^achieve:/i, '')
    .replace(/[^0-9a-z_-]+/gi, '');
}

function buildEaAchievementIconUrl(imageId = '') {
  const normalized = normalizeEaAchievementImageId(imageId);
  return normalized
    ? `https://achievements.gameservices.ea.com/achievements/icons/${normalized}-208.png`
    : '';
}

function normalizeSteamSearchText(value = '') {
  return String(value || '')
    .replace(/[\u2122\u00ae\u00a9]/g, ' ')
    .replace(/\b(deluxe|ultimate|premium|definitive|game of the year|goty)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compareWords(value = '') {
  return normalizeEaCompareText(value)
    .split(/\s+/)
    .map(part => part.trim())
    .filter(part => part.length > 1);
}

function scoreSteamSearchResult(name = '', title = '', slug = '') {
  const candidate = normalizeEaCompareText(name);
  if (!candidate) return 0;

  const targets = [
    title,
    normalizeSteamSearchText(title),
    humanizeEaSlug(slug),
    String(slug || '').replace(/-/g, ' '),
  ]
    .map(normalizeEaCompareText)
    .filter(Boolean);

  let best = 0;
  const candidateWords = new Set(compareWords(candidate));

  targets.forEach(target => {
    if (!target) return;
    if (candidate === target) {
      best = Math.max(best, 1200);
      return;
    }

    if (candidate.startsWith(target) || target.startsWith(candidate)) {
      best = Math.max(best, 950 - Math.abs(candidate.length - target.length));
    }

    if (candidate.includes(target) || target.includes(candidate)) {
      best = Math.max(best, 820 - Math.abs(candidate.length - target.length));
    }

    const targetWords = [...new Set(compareWords(target))];
    if (!targetWords.length) return;

    let matched = 0;
    targetWords.forEach(word => {
      if (candidateWords.has(word)) matched += 1;
    });

    if (!matched) return;

    const coverage = matched / targetWords.length;
    let score = Math.round(coverage * 500) + matched * 70;
    if (matched === targetWords.length && targetWords.length >= 2) score += 220;
    score -= Math.abs(candidateWords.size - targetWords.length) * 12;
    best = Math.max(best, score);
  });

  return best;
}

async function searchSteamApps(query = '') {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];

  const res = await fetch(`https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(cleanQuery)}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function findSteamMatchForEaGame(title = '', slug = '') {
  const cacheKey = `${normalizeEaCompareText(title)}|${String(slug || '').trim()}`;
  if (EA_STEAM_MATCH_CACHE.has(cacheKey)) return EA_STEAM_MATCH_CACHE.get(cacheKey);

  const queries = [...new Set([
    String(title || '').trim(),
    normalizeSteamSearchText(title),
    humanizeEaSlug(slug),
  ].filter(query => String(query || '').trim().length >= 2))];

  let bestResult = null;
  let bestScore = 0;

  for (const query of queries) {
    try {
      const results = await searchSteamApps(query);
      results.forEach(result => {
        const score = scoreSteamSearchResult(result?.name || '', title, slug);
        if (score > bestScore) {
          bestScore = score;
          bestResult = result;
        }
      });
      if (bestScore >= 1100) break;
    } catch {
      // ignore lookup failures, EA import should still succeed offline
    }
  }

  const match = bestResult && bestScore >= 360
    ? {
      appid: String(bestResult.appid || '').trim(),
      title: String(bestResult.name || '').trim(),
      score: bestScore,
    }
    : null;

  EA_STEAM_MATCH_CACHE.set(cacheKey, match);
  return match;
}

function buildSteamArtworkUrls(appId = '') {
  const cleanAppId = String(appId || '').trim();
  if (!cleanAppId) return { coverUrl: '', posterUrl: '' };
  const base = `https://cdn.akamai.steamstatic.com/steam/apps/${cleanAppId}`;
  return {
    coverUrl: `${base}/header.jpg`,
    posterUrl: `${base}/library_600x900_2x.jpg`,
  };
}

async function fetchSteamAppBasicDetails(appId = '') {
  const cleanAppId = String(appId || '').trim();
  if (!cleanAppId) return null;
  if (STEAM_APP_DETAILS_CACHE.has(cleanAppId)) {
    return STEAM_APP_DETAILS_CACHE.get(cleanAppId);
  }

  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(cleanAppId)}&filters=basic&l=russian`;
    const res = await fetch(url);
    const json = await res.json();
    const data = json?.[cleanAppId]?.data;
    const result = data
      ? {
        appid: cleanAppId,
        name: String(data.name || '').trim(),
        type: String(data.type || '').trim(),
        coverUrl: String(data.header_image || data.capsule_image || data.capsule_imagev5 || '').trim(),
        posterUrl: String(data.header_image || data.capsule_image || data.capsule_imagev5 || '').trim(),
      }
      : null;
    STEAM_APP_DETAILS_CACHE.set(cleanAppId, result);
    return result;
  } catch {
    STEAM_APP_DETAILS_CACHE.set(cleanAppId, null);
    return null;
  }
}

function decodeHtmlEntities(value = '') {
  return decodeXmlEntities(String(value || '').replace(/&nbsp;/gi, ' '));
}

function stripHtmlTags(value = '') {
  return decodeHtmlEntities(
    String(value || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSteamCommunityAchievementsPage(html = '') {
  const rows = [...String(html || '').matchAll(
    /<div class="achieveRow[^>]*">([\s\S]*?)<div style="clear: both;"><\/div>\s*<\/div>/g
  )];

  return rows.map((match, idx) => {
    const block = String(match[1] || '');
    const percentRaw = stripHtmlTags(block.match(/<div class="achievePercent">([\s\S]*?)<\/div>/i)?.[1] || '')
      .replace('%', '')
      .replace(',', '.');
    const globalPercent = Number.parseFloat(percentRaw);

    return {
      idx,
      displayName: stripHtmlTags(block.match(/<h3>([\s\S]*?)<\/h3>/i)?.[1] || ''),
      description: stripHtmlTags(block.match(/<h5>([\s\S]*?)<\/h5>/i)?.[1] || ''),
      icon: decodeHtmlEntities(block.match(/<img src="([^"]+)"/i)?.[1] || ''),
      iconGray: decodeHtmlEntities(block.match(/<img src="([^"]+)"/i)?.[1] || ''),
      globalPercent: Number.isFinite(globalPercent) ? globalPercent : null,
    };
  });
}

async function fetchSteamCommunityAchievementCatalog(appId = '') {
  const cleanAppId = String(appId || '').trim();
  if (!cleanAppId) return null;
  if (STEAM_COMMUNITY_ACHIEVEMENTS_CACHE.has(cleanAppId)) {
    return STEAM_COMMUNITY_ACHIEVEMENTS_CACHE.get(cleanAppId);
  }

  try {
    const [ruHtml, enHtml] = await Promise.all([
      fetch(`https://steamcommunity.com/stats/${cleanAppId}/achievements?l=russian`).then(res => res.text()),
      fetch(`https://steamcommunity.com/stats/${cleanAppId}/achievements?l=english`).then(res => res.text()),
    ]);

    const ruRows = parseSteamCommunityAchievementsPage(ruHtml);
    const enRows = parseSteamCommunityAchievementsPage(enHtml);
    const rowCount = Math.min(ruRows.length, enRows.length);
    if (!rowCount) {
      STEAM_COMMUNITY_ACHIEVEMENTS_CACHE.set(cleanAppId, null);
      return null;
    }

    const catalog = Array.from({ length: rowCount }, (_unused, idx) => {
      const ruItem = ruRows[idx] || {};
      const enItem = enRows[idx] || {};
      const englishName = String(enItem.displayName || ruItem.displayName || '').trim();
      const englishDescription = String(enItem.description || '').trim();
      const keyBase = normalizeEaCompareText(englishName || `achievement_${idx}`).replace(/\s+/g, '_') || `achievement_${idx}`;

      return {
        apiname: `steam_${cleanAppId}_${keyBase}_${idx}`,
        displayName: ruItem.displayName || englishName,
        description: ruItem.description || englishDescription,
        englishName,
        englishDescription,
        achieved: 0,
        unlocktime: 0,
        icon: ruItem.icon || enItem.icon || '',
        iconGray: ruItem.iconGray || enItem.iconGray || ruItem.icon || enItem.icon || '',
        globalPercent: ruItem.globalPercent ?? enItem.globalPercent ?? null,
      };
    });

    STEAM_COMMUNITY_ACHIEVEMENTS_CACHE.set(cleanAppId, catalog);
    return catalog;
  } catch {
    STEAM_COMMUNITY_ACHIEVEMENTS_CACHE.set(cleanAppId, null);
    return null;
  }
}

function buildAchievementMatchKeys(name = '', description = '') {
  const nameKey = normalizeEaCompareText(name);
  const descKey = normalizeEaCompareText(description);
  const keys = [];
  if (nameKey && descKey) keys.push(`both:${nameKey}__${descKey}`);
  if (nameKey) keys.push(`name:${nameKey}`);
  if (descKey) keys.push(`desc:${descKey}`);
  return [...new Set(keys)];
}

function mergeEaAchievementsWithSteamCatalog(eaAchievements = [], steamCatalog = []) {
  if (!Array.isArray(steamCatalog) || !steamCatalog.length) {
    return Array.isArray(eaAchievements) ? eaAchievements : [];
  }

  const merged = steamCatalog.map(achievement => ({
    ...achievement,
    achieved: achievement.achieved ? 1 : 0,
    unlocktime: Number(achievement.unlocktime) || 0,
  }));

  const matchMap = new Map();
  steamCatalog.forEach((achievement, idx) => {
    buildAchievementMatchKeys(achievement.englishName, achievement.englishDescription).forEach(key => {
      if (!matchMap.has(key)) matchMap.set(key, []);
      matchMap.get(key).push(idx);
    });
  });

  const usedIndexes = new Set();
  (Array.isArray(eaAchievements) ? eaAchievements : []).forEach(eaAchievement => {
    const keys = buildAchievementMatchKeys(eaAchievement.displayName, eaAchievement.description);
    let matchIdx = null;

    for (const key of keys) {
      const candidates = matchMap.get(key) || [];
      const nextIdx = candidates.find(idx => !usedIndexes.has(idx));
      if (nextIdx != null) {
        matchIdx = nextIdx;
        break;
      }
    }

    if (matchIdx == null) return;
    usedIndexes.add(matchIdx);

    merged[matchIdx] = {
      ...merged[matchIdx],
      apiname: eaAchievement.apiname || merged[matchIdx].apiname,
      achieved: eaAchievement.achieved ? 1 : 0,
      unlocktime: Number(eaAchievement.unlocktime) || 0,
      icon: merged[matchIdx].icon || eaAchievement.icon || eaAchievement.iconGray || '',
      iconGray: merged[matchIdx].iconGray || eaAchievement.iconGray || eaAchievement.icon || '',
    };
  });

  return merged;
}

function extractEaCachedPlaytime(cacheFiles = []) {
  const playtimeBySlug = new Map();

  cacheFiles.forEach(file => {
    const matches = String(file.text || '').match(/\{"gameSlug":"[^"]+"[^{}\x00-\x1f\x7f-\xff]*"totalPlayTimeSeconds":\d+[^{}\x00-\x1f\x7f-\xff]*\}/g) || [];
    matches.forEach(raw => {
      try {
        const parsed = JSON.parse(raw);
        const slug = String(parsed.gameSlug || '').trim();
        const totalSeconds = Math.max(0, Number(parsed.totalPlayTimeSeconds) || 0);
        const lastPlayedAt = String(parsed.lastSessionEndDate || '').trim();
        if (!slug || !Number.isFinite(totalSeconds)) return;

        const current = playtimeBySlug.get(slug);
        const nextTime = lastPlayedAt ? Date.parse(lastPlayedAt) : 0;
        const prevTime = current?.lastPlayedAt ? Date.parse(current.lastPlayedAt) : 0;

        if (!current || totalSeconds > current.totalSeconds) {
          playtimeBySlug.set(slug, {
            totalSeconds,
            lastPlayedAt: Number.isFinite(nextTime) && nextTime > 0 ? new Date(nextTime).toISOString() : (current?.lastPlayedAt || null),
            detected: true,
          });
          return;
        }

        if (Number.isFinite(nextTime) && nextTime > prevTime) {
          current.lastPlayedAt = new Date(nextTime).toISOString();
        }
        current.detected = true;
      } catch {
        // ignore malformed cache fragments
      }
    });
  });

  return playtimeBySlug;
}

function extractEaCachedArtworkUrls(cacheFiles = []) {
  const urls = [];
  const seen = new Set();

  cacheFiles.forEach(file => {
    const matches = String(file.text || '').match(/https:\/\/app-images\.ea\.com[^\x00-\x20\x7f-\xff"'<>\\]+/g) || [];
    matches.forEach(rawUrl => {
      const cleanUrl = String(rawUrl || '').replace(/\\u0026/gi, '&').trim();
      if (!cleanUrl || seen.has(cleanUrl)) return;
      seen.add(cleanUrl);
      urls.push(cleanUrl);
    });
  });

  return urls;
}

function pickEaArtworkForGame(slug = '', title = '', artworkUrls = []) {
  const compareTargets = [
    normalizeEaCompareText(slug),
    normalizeEaCompareText(String(slug || '').replace(/-/g, ' ')),
    normalizeEaCompareText(title),
  ].filter(Boolean);

  const matches = artworkUrls.filter(url => {
    const normalizedUrl = normalizeEaCompareText(url);
    return compareTargets.some(target => target && normalizedUrl.includes(target));
  });

  const pick = patterns => matches.find(url => patterns.some(pattern => pattern.test(url))) || '';
  const posterUrl = pick([/-hero-/i, /-8x3\./i, /promotion/i, /full-cinematic/i])
    || matches[0]
    || '';
  const coverUrl = pick([/game-art-1x1/i, /-1x1\./i, /-1\./i, /-2\./i, /list-item/i, /item-list/i])
    || posterUrl
    || matches[0]
    || '';

  return {
    coverUrl,
    posterUrl: posterUrl || coverUrl,
  };
}

function listExecutablesLimited(rootDir, depth = 3, bucket = []) {
  if (!rootDir || depth < 0 || !fsSync.existsSync(rootDir)) return bucket;

  let entries = [];
  try {
    entries = fsSync.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return bucket;
  }

  entries.forEach(entry => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (/^(?:__installer|installer|redist|redistributable|support|docs?|manual|cache)$/i.test(entry.name)) return;
      listExecutablesLimited(fullPath, depth - 1, bucket);
      return;
    }
    if (entry.isFile() && /\.exe$/i.test(entry.name)) {
      bucket.push(fullPath);
    }
  });

  return bucket;
}

function scoreEaExecutable(filePath, title = '', slug = '') {
  const lowerName = path.basename(filePath).toLowerCase();
  const lowerPath = String(filePath || '').toLowerCase();

  if (/(?:unins|uninstall|crash|report|patch|setup|helper|vc_redist|eadesktop|eabackgroundservice)/.test(lowerName)) return -1000;
  if (/(?:__installer|installer|redist|redistributable|support|docs?)/.test(lowerPath)) return -300;

  let score = 0;
  if (lowerName.includes('launcher')) score += 90;
  if (lowerName.includes('shipping')) score += 35;
  if (lowerPath.includes('win64')) score += 20;
  if (lowerName.includes('game')) score += 12;
  if (lowerPath.includes('anti') && lowerPath.includes('cheat')) score -= 180;

  const parts = [
    ...String(title || '').toLowerCase().split(/[^a-z0-9\u0400-\u04FF]+/i),
    ...String(slug || '').toLowerCase().split('-'),
  ]
    .map(part => part.trim())
    .filter(part => part.length > 2);

  [...new Set(parts)].forEach(part => {
    if (lowerName.includes(part)) score += 12;
    else if (lowerPath.includes(part)) score += 4;
  });

  score -= lowerPath.split(path.sep).length;
  return score;
}

function detectEaLaunchPath(installPath, title = '', slug = '', preferredPath = '') {
  const preferred = String(preferredPath || '').trim();
  if (preferred && fsSync.existsSync(preferred)) return preferred;

  const root = String(installPath || '').trim();
  if (!root || !fsSync.existsSync(root)) return '';

  const candidates = listExecutablesLimited(root, 3);
  if (!candidates.length) return '';

  return [...candidates]
    .sort((a, b) => scoreEaExecutable(b, title, slug) - scoreEaExecutable(a, title, slug))[0] || '';
}

function queryRegistryValue(fullPath = '') {
  const normalized = String(fullPath || '').trim();
  const lastSlash = normalized.lastIndexOf('\\');
  if (lastSlash <= 0) return '';

  const keyPath = normalized.slice(0, lastSlash);
  const valueName = normalized.slice(lastSlash + 1);
  const candidates = [keyPath];

  if (/^HKEY_LOCAL_MACHINE\\SOFTWARE\\/i.test(keyPath) && !/\\WOW6432Node\\/i.test(keyPath)) {
    candidates.push(keyPath.replace(/^HKEY_LOCAL_MACHINE\\SOFTWARE\\/i, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\'));
  }

  const escapedValue = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const { execFileSync } = require('child_process');

  for (const candidate of candidates) {
    try {
      const output = execFileSync('reg', ['query', candidate, '/v', valueName], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const match = output.match(new RegExp(`${escapedValue}\\s+REG_\\w+\\s+(.+)`));
      if (match?.[1]) return match[1].trim();
    } catch {
      // ignore missing registry keys
    }
  }

  return '';
}

function resolveEaLauncherTemplate(registryRef = '', suffix = '') {
  const basePath = queryRegistryValue(registryRef);
  if (!basePath) return '';
  const cleanBase = String(basePath).replace(/[\\/]+$/, '');
  const cleanSuffix = String(suffix || '').replace(/^[\\/]+/, '');
  const resolved = cleanSuffix ? path.join(cleanBase, cleanSuffix) : cleanBase;
  return fsSync.existsSync(resolved) ? resolved : '';
}

async function importEaLibraryFromLogs() {
  const files = collectEaLogFiles();
  if (!files.length) return { games: [] };

  const state = {
    gamesBySlug: new Map(),
    slugBySoftwareId: new Map(),
    offerToSlug: new Map(),
    pendingOfferMappings: [],
    installInfoByOfferId: new Map(),
    achievementsByMasterTitleId: new Map(),
    slugByMasterTitleId: new Map(),
    playtimeBySlug: new Map(),
    cachedPlaytimeBySlug: new Map(),
    playtimeKeys: new Set(),
    launchPathByMasterTitleId: new Map(),
    fallbackLaunchPaths: new Set(),
    cacheArtworkUrls: [],
  };

  const rememberPlaytime = (slug, seconds, playedAt, dedupeKey) => {
    const cleanSlug = String(slug || '').trim();
    if (!cleanSlug) return;
    const key = String(dedupeKey || '').trim();
    if (key && state.playtimeKeys.has(key)) return;
    if (key) state.playtimeKeys.add(key);

    const current = state.playtimeBySlug.get(cleanSlug) || {
      totalSeconds: 0,
      lastPlayedAt: null,
      detected: false,
    };
    current.totalSeconds += Math.max(0, Number(seconds) || 0);
    current.detected = true;
    if (playedAt) {
      const nextTime = new Date(playedAt).getTime();
      const prevTime = current.lastPlayedAt ? new Date(current.lastPlayedAt).getTime() : 0;
      if (Number.isFinite(nextTime) && nextTime > prevTime) current.lastPlayedAt = new Date(nextTime).toISOString();
    }
    state.playtimeBySlug.set(cleanSlug, current);
  };

  files.forEach(file => {
    const text = file.text;
    const lines = text.split(/\r?\n/);

    lines.forEach(line => {
      let match = line.match(/InstallStore::updateInfos\)\s+IS update: set installInfo for softwareId=\[([^\]]*)\]\s+baseSlug=\[([^\]]*)\]\s+installedStatus=\[([^\]]+)\]/);
      if (match) {
        const [, softwareId, slug, installedStatus] = match.map(v => String(v || '').trim());
        if (slug) {
          const entry = ensureEaEntry(state.gamesBySlug, slug);
          if (entry && softwareId) {
            entry.softwareIds.add(softwareId);
            entry.softwareStatuses.set(softwareId, installedStatus);
            state.slugBySoftwareId.set(softwareId, slug);
          }
        }
      }

      match = line.match(/GamesManagerProxy::getGameStatusV2\)\s+offerId=\[([^\]]+)\]\s+slug=\[([^\]]*)\]/);
      if (match) {
        const offerId = String(match[1] || '').trim();
        const slug = String(match[2] || '').trim();
        if (offerId && slug) {
          const entry = ensureEaEntry(state.gamesBySlug, slug);
          entry?.offerIds.add(offerId);
          state.offerToSlug.set(offerId, slug);
        }
      }

      if (line.includes('offersWithUpdates::<lambda_1>::operator')) {
        match = line.match(/offerId=\[([^\]]+)\]\s+softwareId=\[([^\]]*)\]/);
        if (match) {
          const offerId = String(match[1] || '').trim();
          const softwareId = String(match[2] || '').trim();
          const slug = state.slugBySoftwareId.get(softwareId);
          if (offerId && slug) {
            const entry = ensureEaEntry(state.gamesBySlug, slug);
            entry?.offerIds.add(offerId);
            state.offerToSlug.set(offerId, slug);
          } else if (offerId && softwareId) {
            state.pendingOfferMappings.push({ offerId, softwareId });
          }
        }
      }

      match = line.match(/offer(?:Key\.)?offerId=\[([^\]]+)\].*slug=\[([^\]]+)\]/);
      if (match) {
        const offerId = String(match[1] || '').trim();
        const slug = String(match[2] || '').trim();
        if (offerId && slug) {
          const entry = ensureEaEntry(state.gamesBySlug, slug);
          entry?.offerIds.add(offerId);
          state.offerToSlug.set(offerId, slug);
        }
      }

      if (line.includes('"slug":"')) {
        const slug = line.match(/"slug":"([^"]+)"/)?.[1] || '';
        const masterTitleId = line.match(/"(?:content_id|mdm_mt_id|tl_master_title_id)":"?(\d+)"?/)?.[1] || '';
        if (slug && masterTitleId) {
          state.slugByMasterTitleId.set(masterTitleId, slug);
          const entry = ensureEaEntry(state.gamesBySlug, slug);
          if (entry && !entry.masterTitleId) entry.masterTitleId = masterTitleId;
        }
      }

      if (line.includes('onGameStatusUpdated signal to SPA')) {
        const offerId = line.match(/"offerId":"([^"]+)"/)?.[1] || '';
        const installPath = line.match(/"installPath":"([^"]+)"/)?.[1] || '';
        const masterTitleId = line.match(/"masterTitleId":"([^"]+)"/)?.[1] || '';
        if (offerId && (installPath || masterTitleId)) {
          state.installInfoByOfferId.set(offerId, {
            installPath: unescapeEaLogString(installPath),
            masterTitleId: String(masterTitleId || '').trim(),
          });
        }
      }

      match = line.match(/IGO API: executable=\[([^\]]+)\].*masterTitleId=\[([^\]]+)\]/);
      if (match) {
        const executable = String(match[1] || '').trim();
        const masterTitleId = String(match[2] || '').trim();
        if (executable && masterTitleId) {
          state.launchPathByMasterTitleId.set(masterTitleId, executable);
        }
      }

      match = line.match(/(?:domainLauncher|launcher)\.exePath=\[\[([^\]]+)\]([^\]]*)\]/);
      if (match) {
        const resolved = resolveEaLauncherTemplate(String(match[1] || '').trim(), String(match[2] || '').trim());
        if (resolved) state.fallbackLaunchPaths.add(resolved);
      }

      if (line.includes('Telemetry Event [game.sess.exit]:')) {
        const slug = line.match(/"slug":"([^"]+)"/)?.[1] || '';
        const seconds = parseInt(line.match(/"sdur":(\d+)/)?.[1] || '0', 10);
        const tlsid = line.match(/"tlsid":"([^"]+)"/)?.[1] || '';
        const stamp = line.match(/\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/)?.[1] || '';
        const lastPlayDate = line.match(/"last_play_date":"([^"]+)"/)?.[1] || '';
        const playedAt = stamp || (lastPlayDate ? `${lastPlayDate}T00:00:00Z` : '');
        rememberPlaytime(slug, seconds, playedAt, [slug, seconds, tlsid, stamp].join('|'));
      }
    });

    const achievementBlocks = text.matchAll(/<AchievementSet\b([^>]*)>([\s\S]*?)<\/AchievementSet>/g);
    for (const block of achievementBlocks) {
      const setAttrs = parseEaAttributes(block[1] || '');
      const nameParts = String(setAttrs.Name || '').split('_');
      const masterTitleId = nameParts.find(part => /^\d+$/.test(part)) || '';
      if (!masterTitleId) continue;

      const achievements = [];
      const achievementMatches = String(block[2] || '').matchAll(/<Achievement\b([^>]*)\/>/g);
      for (const achMatch of achievementMatches) {
        const attrs = parseEaAttributes(achMatch[1] || '');
        const grantDate = String(attrs.GrantDate || '').trim();
        const grantTime = Date.parse(grantDate);
        const count = parseInt(attrs.Count || attrs.Progress || '0', 10);
        const total = parseInt(attrs.Total || '0', 10);
        const achieved = (
          (grantDate && !/^0{4}-0{2}-0{2}/.test(grantDate) && !/^1969-12-31/.test(grantDate))
          || (total > 0 && count >= total)
        ) ? 1 : 0;

        achievements.push({
          apiname: `ea_${masterTitleId}_${attrs.Id || achievements.length}`,
          displayName: attrs.Name || attrs.HowTo || `Achievement ${attrs.Id || achievements.length + 1}`,
          description: attrs.Description || attrs.HowTo || '',
          achieved,
          unlocktime: achieved && Number.isFinite(grantTime) ? Math.floor(grantTime / 1000) : 0,
          icon: buildEaAchievementIconUrl(attrs.ImageId || ''),
          iconGray: buildEaAchievementIconUrl(attrs.ImageId || ''),
        });
      }

      const prev = state.achievementsByMasterTitleId.get(masterTitleId);
      if (!prev || achievements.length >= prev.achievements.length) {
        state.achievementsByMasterTitleId.set(masterTitleId, {
          masterTitleId,
          gameName: String(setAttrs.GameName || '').trim(),
          achievements,
        });
      }
    }
  });

  const cacheFiles = collectEaCacheFiles();
  state.cachedPlaytimeBySlug = extractEaCachedPlaytime(cacheFiles);
  state.cacheArtworkUrls = extractEaCachedArtworkUrls(cacheFiles);

  state.pendingOfferMappings.forEach(({ offerId, softwareId }) => {
    const slug = state.slugBySoftwareId.get(softwareId);
    if (!slug) return;
    const entry = ensureEaEntry(state.gamesBySlug, slug);
    entry?.offerIds.add(offerId);
    state.offerToSlug.set(offerId, slug);
  });

  state.installInfoByOfferId.forEach((info, offerId) => {
    const slug = state.offerToSlug.get(offerId);
    if (!slug) return;
    const entry = ensureEaEntry(state.gamesBySlug, slug);
    if (!entry) return;
    if (info.installPath) entry.installPath = info.installPath;
    if (info.masterTitleId) {
      entry.masterTitleId = info.masterTitleId;
      state.slugByMasterTitleId.set(info.masterTitleId, slug);
    }
  });

  const playtimeSlugs = new Set([
    ...state.playtimeBySlug.keys(),
    ...state.cachedPlaytimeBySlug.keys(),
  ]);

  playtimeSlugs.forEach(slug => {
    const playtime = state.cachedPlaytimeBySlug.get(slug) || state.playtimeBySlug.get(slug);
    if (!playtime) return;
    const entry = ensureEaEntry(state.gamesBySlug, slug);
    if (!entry) return;
    entry.hoursDetected = Boolean(playtime.detected);
    entry.hoursPlayed = +((playtime.totalSeconds || 0) / 3600).toFixed(2);
    entry.lastPlayedAt = playtime.lastPlayedAt || entry.lastPlayedAt || null;
  });

  state.achievementsByMasterTitleId.forEach((achievementSet, masterTitleId) => {
    let slug = state.slugByMasterTitleId.get(masterTitleId);
    if (!slug && achievementSet.gameName) {
      const targetName = normalizeEaCompareText(achievementSet.gameName);
      for (const entry of state.gamesBySlug.values()) {
        const candidate = normalizeEaCompareText(entry.title || humanizeEaSlug(entry.slug));
        if (candidate && candidate === targetName) {
          slug = entry.slug;
          break;
        }
      }
    }
    if (!slug) return;

    const entry = ensureEaEntry(state.gamesBySlug, slug);
    if (!entry) return;
    entry.masterTitleId = entry.masterTitleId || masterTitleId;
    if (achievementSet.gameName && !entry.title) entry.title = achievementSet.gameName;
    entry.achievements = achievementSet.achievements;
    entry.achievementsUnlocked = achievementSet.achievements.filter(ach => ach.achieved).length;
    entry.achievementsTotal = achievementSet.achievements.length;
  });

  const installedSlugs = [...state.gamesBySlug.values()].filter(entry =>
    [...entry.softwareStatuses.values()].some(status => isEaInstalledStatus(status))
  );

  const sortedEntries = [...state.gamesBySlug.values()]
    .sort((a, b) => {
      const titleA = a.title || humanizeEaSlug(a.slug);
      const titleB = b.title || humanizeEaSlug(b.slug);
      return titleA.localeCompare(titleB, 'ru');
    });

  const games = [];
  for (const entry of sortedEntries) {
    const installed = [...entry.softwareStatuses.values()].some(status => isEaInstalledStatus(status));
    const installPath = String(entry.installPath || '').trim();
    const installDirName = installPath ? path.basename(installPath.replace(/[\\/]+$/, '')) : '';
    const achievementName = state.achievementsByMasterTitleId.get(entry.masterTitleId || '')?.gameName || '';
    const title = achievementName || entry.title || installDirName || humanizeEaSlug(entry.slug);
    const preferredLaunchPath = entry.masterTitleId ? state.launchPathByMasterTitleId.get(entry.masterTitleId) : '';
    let launchPath = detectEaLaunchPath(installPath, title, entry.slug, preferredLaunchPath);

    if (!launchPath && installedSlugs.length === 1 && state.fallbackLaunchPaths.size === 1) {
      const onlyFallback = [...state.fallbackLaunchPaths][0];
      if (fsSync.existsSync(onlyFallback)) launchPath = onlyFallback;
    }

    const offerId = [...entry.offerIds][0] || '';
    const eaArtwork = pickEaArtworkForGame(entry.slug, title, state.cacheArtworkUrls);
    const steamMatch = await findSteamMatchForEaGame(title, entry.slug);
    const steamAppId = String(steamMatch?.appid || '').trim();
    const steamArtwork = buildSteamArtworkUrls(steamAppId);
    const steamAchievementCatalog = steamAppId
      ? await fetchSteamCommunityAchievementCatalog(steamAppId)
      : null;
    const mergedAchievements = mergeEaAchievementsWithSteamCatalog(entry.achievements || [], steamAchievementCatalog || []);
    const achievementsUnlocked = mergedAchievements.filter(achievement => achievement.achieved).length;
    const achievementsTotal = mergedAchievements.length || entry.achievementsTotal || 0;

    games.push({
      title,
      slug: entry.slug,
      eaSlug: entry.slug,
      eaOfferId: offerId,
      masterTitleId: entry.masterTitleId || '',
      steamAppId,
      platform: 'EA App',
      source: 'ea',
      installed: installed && (!installPath || fsSync.existsSync(installPath)),
      installPath: installPath && fsSync.existsSync(installPath) ? installPath : '',
      launchPath,
      coverUrl: steamArtwork.coverUrl || eaArtwork.coverUrl || '',
      posterUrl: steamArtwork.posterUrl || eaArtwork.posterUrl || eaArtwork.coverUrl || '',
      achievements: mergedAchievements,
      achievementsUnlocked,
      achievementsTotal,
      hoursPlayed: Number(entry.hoursPlayed || 0),
      hoursDetected: Boolean(entry.hoursDetected),
      lastPlayedAt: entry.lastPlayedAt || null,
    });
  }

  return { games };
}

ipcMain.handle('ea:import', async () => {
  try {
    const result = await importEaLibraryFromLogs();
    return { ok: true, games: result.games || [] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

function hasCyrillic(str) {
  return /[\u0400-\u04ff]/.test(str || '');
}

// РљСЌС€ РїРµСЂРµРІРѕРґРѕРІ (СЃР±СЂР°СЃС‹РІР°РµС‚СЃСЏ РїСЂРё РїРµСЂРµР·Р°РїСѓСЃРєРµ РїСЂРёР»РѕР¶РµРЅРёСЏ)
const _txCache = new Map();

// РџРµСЂРµРІРѕРґ РѕРґРЅРѕР№ СЃС‚СЂРѕРєРё РЅР° СЂСѓСЃСЃРєРёР№ С‡РµСЂРµР· РЅРµРѕС„РёС†РёР°Р»СЊРЅС‹Р№ Google Translate (Р±РµР· РєР»СЋС‡Р°, Р±РµР· Р»РёРјРёС‚Р°)
async function translateToRu(text) {
  if (!text || hasCyrillic(text) || looksLikeApiKey(text)) return text;
  const key = text.trim();
  if (_txCache.has(key)) return _txCache.get(key);
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    const d = await r.json();
    const translated = d?.[0]?.map(seg => seg?.[0] || '').join('').trim();
    const result = (translated && translated !== key) ? translated : key;
    _txCache.set(key, result);
    return result;
  } catch { return text; }
}

// РџРµСЂРµРІРѕРґ РјР°СЃСЃРёРІР° РЅР°Р·РІР°РЅРёР№ Рё РѕРїРёСЃР°РЅРёР№ РґРѕСЃС‚РёР¶РµРЅРёР№ (РїР°СЂР°Р»Р»РµР»СЊРЅРѕ, РїРѕ 8 С€С‚СѓРє)
async function translateAchievements(achievements) {
  const CONCURRENT = 8;
  // РЎС‚СЂРѕРёРј СЃРїРёСЃРѕРє Р·Р°РґР°С‡: РєР°Р¶РґС‹Р№ РѕР±СЉРµРєС‚ + РїРѕР»Рµ, РєРѕС‚РѕСЂРѕРµ РЅСѓР¶РЅРѕ РїРµСЂРµРІРµСЃС‚Рё
  const tasks = [];
  for (const a of achievements) {
    if (a.displayName && !hasCyrillic(a.displayName) && !looksLikeApiKey(a.displayName))
      tasks.push({ obj: a, field: 'displayName' });
    if (a.description && !hasCyrillic(a.description) && !looksLikeApiKey(a.description))
      tasks.push({ obj: a, field: 'description' });
  }
  for (let i = 0; i < tasks.length; i += CONCURRENT) {
    const batch = tasks.slice(i, i + CONCURRENT);
    const translated = await Promise.all(batch.map(t => translateToRu(t.obj[t.field])));
    batch.forEach((t, j) => { if (translated[j]) t.obj[t.field] = translated[j]; });
    if (i + CONCURRENT < tasks.length) await new Promise(r => setTimeout(r, 80));
  }
}

// РџСЂРѕРІРµСЂРєР°: РїРѕС…РѕР¶Рµ Р»Рё РЅР°Р·РІР°РЅРёРµ РЅР° С‚РµС…РЅРёС‡РµСЃРєРёР№ РєР»СЋС‡ (РЅРµ РїРµСЂРµРІРµРґРµРЅРѕ)
function looksLikeApiKey(str) {
  if (!str) return true;
  // РўРѕР»СЊРєРѕ Р·Р°РіР»Р°РІРЅС‹Рµ + С†РёС„СЂС‹ + РїРѕРґС‡С‘СЂРєРёРІР°РЅРёСЏ в†’ API-РєР»СЋС‡
  return /^[A-Z0-9_]{3,}$/.test(str.trim());
}

// Р§РµР»РѕРІРµРєРѕС‡РёС‚Р°РµРјРѕРµ РёРјСЏ РёР· API-РєР»СЋС‡Р° (fallback)
function humanizeApiName(apiname) {
  if (!apiname) return 'Р”РѕСЃС‚РёР¶РµРЅРёРµ';
  return apiname
    .replace(/^(ACH|ACHIEVEMENT|ACHV|STEAM|GLOBAL)_?/i, '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase()) || 'Р”РѕСЃС‚РёР¶РµРЅРёРµ';
}

// Р’С‹Р±СЂР°С‚СЊ Р»СѓС‡С€РµРµ РЅР°Р·РІР°РЅРёРµ: РїСЂРёРѕСЂРёС‚РµС‚ вЂ” СЃС…РµРјР° (RU), Р·Р°С‚РµРј player stats, Р·Р°С‚РµРј humanized
function bestName(schemaName, playerName, apiname) {
  if (schemaName && !looksLikeApiKey(schemaName)) return schemaName;
  if (playerName && !looksLikeApiKey(playerName)) return playerName;
  return humanizeApiName(apiname);
}

async function fetchGlobalAchievementPercentages(appid) {
  try {
    const json = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`
    ).then(r => r.json()).catch(() => null);

    const rows = json?.achievementpercentages?.achievements || [];
    const map = {};
    rows.forEach(row => {
      const percent = Number.parseFloat(String(row?.percent ?? '').replace(',', '.'));
      if (row?.name && Number.isFinite(percent)) map[row.name] = percent;
    });
    return map;
  } catch {
    return {};
  }
}

// Р’СЃРїРѕРјРѕРіР°С‚РµР»СЊРЅР°СЏ С„СѓРЅРєС†РёСЏ: РґРѕСЃС‚РёР¶РµРЅРёСЏ РёРіСЂРѕРєР° + РёРєРѕРЅРєРё РёР· СЃС…РµРјС‹ (РЅР° СЂСѓСЃСЃРєРѕРј)
// translate=true в†’ РїРµСЂРµРІРѕРґРёС‚ Р°РЅРіР»РёР№СЃРєРёРµ РЅР°Р·РІР°РЅРёСЏ С‡РµСЂРµР· MyMemory API
async function fetchGameAchievements(apiKey, steamId, appid, translate = false) {
  try {
    const [playerJson, schemaJson, globalPercentMap] = await Promise.all([
      fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${apiKey}&steamid=${steamId}&appid=${appid}&l=russian`)
        .then(r => r.json()).catch(() => null),
      fetch(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appid}&l=russian`)
        .then(r => r.json()).catch(() => null),
      fetchGlobalAchievementPercentages(appid),
    ]);

    const playerAchs = playerJson?.playerstats?.achievements || [];
    const schemaAchs = schemaJson?.game?.availableGameStats?.achievements || [];

    // РРЅРґРµРєСЃ СЃС…РµРјС‹ РїРѕ API-РёРјРµРЅРё
    const schemaMap = {};
    schemaAchs.forEach(a => { schemaMap[a.name] = a; });

    let achievements;

    // РўРѕР»СЊРєРѕ СЃС…РµРјР° (РЅРµС‚ Р»РёС‡РЅС‹С… РґР°РЅРЅС‹С… вЂ” РёРіСЂР° РЅРµ Р·Р°РїСѓСЃРєР°Р»Р°СЃСЊ)
    if (playerAchs.length === 0 && schemaAchs.length > 0) {
      achievements = schemaAchs.map(a => ({
        apiname: a.name,
        displayName: bestName(a.displayName, null, a.name),
        description: a.description || '',
        achieved: 0, unlocktime: 0,
        icon: a.icon || '', iconGray: a.icongray || '',
        globalPercent: globalPercentMap[a.name] ?? null,
      }));
    } else {
      // РћР±СЉРµРґРёРЅСЏРµРј: СЃС‚Р°С‚СѓСЃ РёРіСЂРѕРєР° + РёРєРѕРЅРєРё Рё Р РЈРЎРЎРљРР• РЅР°Р·РІР°РЅРёСЏ РёР· СЃС…РµРјС‹
      achievements = playerAchs.map(a => {
        const schema = schemaMap[a.apiname];
        return {
          apiname: a.apiname,
          // РЎС…РµРјР° РЅР°РґС‘Р¶РЅРµРµ: Steam Р»РѕРєР°Р»РёР·СѓРµС‚ displayName/description РІ GetSchemaForGame
          displayName: bestName(schema?.displayName, a.name, a.apiname),
          description: (schema?.description && !looksLikeApiKey(schema.description))
            ? schema.description
            : (a.description || ''),
          achieved: a.achieved || 0,
          unlocktime: a.unlocktime || 0,
          icon: schema?.icon || '',
          iconGray: schema?.icongray || '',
          globalPercent: globalPercentMap[a.apiname] ?? null,
        };
      });
    }

    // РџРµСЂРµРІРѕРґ Р°РЅРіР»РёР№СЃРєРёС… РЅР°Р·РІР°РЅРёР№ С‡РµСЂРµР· MyMemory (С‚РѕР»СЊРєРѕ РґР»СЏ РѕРґРёРЅРѕС‡РЅРѕРіРѕ Р·Р°РїСЂРѕСЃР°)
    if (translate && achievements.length > 0) {
      await translateAchievements(achievements);
    }

    return achievements;
  } catch {
    return [];
  }
}

// в•ђв•ђ Р›РћРљРђР›Р¬РќР«Р• Р”РћРЎРўРР–Р•РќРРЇ (appcache/stats) в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

// РџР°СЂСЃРµСЂ Р±РёРЅР°СЂРЅРѕРіРѕ VDF (Valve Data Format)
function parseBinaryVDFRet(buf, off) {
  const obj = {};
  while (off < buf.length) {
    const type = buf[off++];
    if (type === 0x08) break;
    let e = off; while (e < buf.length && buf[e] !== 0) e++;
    const key = buf.slice(off, e).toString('utf8'); off = e + 1;
    if (type === 0x00) { const [c, o] = parseBinaryVDFRet(buf, off); obj[key] = c; off = o; }
    else if (type === 0x01) { let e = off; while (e < buf.length && buf[e] !== 0) e++; obj[key] = buf.slice(off, e).toString('utf8'); off = e + 1; }
    else if (type === 0x02) { obj[key] = buf.readInt32LE(off); off += 4; }
    else if (type === 0x03) { obj[key] = buf.readFloatLE(off); off += 4; }
    else if (type === 0x07) { try { obj[key] = Number(buf.readBigUInt64LE(off)); } catch { obj[key] = 0; } off += 8; }
    else break;
  }
  return [obj, off];
}
const parseBinaryVDF = buf => parseBinaryVDFRet(buf, 0)[0];

// Steam64 в†’ AccountID (РєРѕСЂРѕС‚РєРёР№ ID, РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РІ РёРјРµРЅР°С… С„Р°Р№Р»РѕРІ РєРµС€Р°)
function toAccountId(steamId) {
  const STEAM64_BASE = BigInt('76561197960265728');
  try {
    const id = BigInt(String(steamId).trim());
    if (id > STEAM64_BASE) return String(id - STEAM64_BASE);
  } catch { }
  return String(steamId); // СѓР¶Рµ AccountID
}

function resolveSteamLocalAccountIds(steamPath, steamId) {
  return [...new Set([
    steamId ? toAccountId(steamId) : null,
    steamId ? String(steamId).trim() : null,
    detectAccountId(steamPath),
  ].filter(Boolean))];
}

function unescapeVdfString(value = '') {
  return String(value || '')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function parseTextVdf(text = '') {
  const root = {};
  const stack = [root];
  let pendingKey = null;

  String(text || '').split(/\r?\n/).forEach(rawLine => {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('//')) return;

    const structuralLine = line
      .replace(/"((?:\\.|[^"\\])*)"/g, '')
      .trim();

    if (line.startsWith('}')) {
      if (stack.length > 1) stack.pop();
      pendingKey = null;
      return;
    }

    const tokens = [...line.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(match => unescapeVdfString(match[1]));
    const hasOpenBrace = structuralLine.startsWith('{');

    if (hasOpenBrace) {
      const key = tokens[0] ?? pendingKey;
      const nextObj = {};
      if (key != null) {
        stack[stack.length - 1][key] = nextObj;
      }
      stack.push(nextObj);
      pendingKey = null;

      if (tokens.length > 2) {
        for (let i = 1; i + 1 < tokens.length; i += 2) {
          nextObj[tokens[i]] = tokens[i + 1];
        }
      }
      return;
    }

    if (!tokens.length) return;
    if (tokens.length === 1) {
      pendingKey = tokens[0];
      return;
    }

    const target = stack[stack.length - 1];
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      target[tokens[i]] = tokens[i + 1];
    }
    pendingKey = tokens.length % 2 ? tokens[tokens.length - 1] : null;
  });

  return root;
}

// РќР°Р№С‚Рё AccountID РїРѕ РїР°РїРєРµ userdata (Р°РІС‚Рѕ-РѕРїСЂРµРґРµР»РµРЅРёРµ)
function detectAccountId(steamPath) {
  try {
    const userdataDir = path.join(steamPath, 'userdata');
    const fss = require('fs');
    if (!fss.existsSync(userdataDir)) return null;
    const entries = fss.readdirSync(userdataDir).filter(e => /^\d+$/.test(e) && e !== '0');
    // Р‘РµСЂС‘Рј РїР°РїРєСѓ СЃ РЅР°РёР±РѕР»СЊС€РёРј С‡РёСЃР»РѕРј РїРѕРґРїР°РїРѕРє (РіР»Р°РІРЅС‹Р№ Р°РєРєР°СѓРЅС‚)
    let best = null, bestCount = 0;
    for (const e of entries) {
      try {
        const count = fss.readdirSync(path.join(userdataDir, e)).length;
        if (count > bestCount) { bestCount = count; best = e; }
      } catch { }
    }
    return best;
  } catch { return null; }
}

function readSteamLocalConfigApps(steamPath, steamId) {
  const candidates = resolveSteamLocalAccountIds(steamPath, steamId);

  for (const accountId of candidates) {
    try {
      const localConfigPath = path.join(steamPath, 'userdata', accountId, 'config', 'localconfig.vdf');
      if (!fsSync.existsSync(localConfigPath)) continue;

      const parsed = parseTextVdf(fsSync.readFileSync(localConfigPath, 'utf8'));
      const apps = parsed?.UserLocalConfigStore?.Software?.Valve?.Steam?.apps;
      if (apps && typeof apps === 'object') {
        return { accountId, apps };
      }
    } catch {
      // ignore and try next account
    }
  }

  return { accountId: candidates[0] || null, apps: {} };
}

function readSteamLocalPlaytimeMap(steamPath, steamId) {
  const { accountId, apps } = readSteamLocalConfigApps(steamPath, steamId);
  const map = new Map();

  Object.entries(apps || {}).forEach(([appid, info]) => {
    const cleanAppId = String(appid || '').trim();
    if (!/^\d+$/.test(cleanAppId) || !info || typeof info !== 'object') return;

    const playtime = Number.parseInt(String(info.Playtime || info.playtime || '0').trim(), 10);
    const lastPlayed = Number.parseInt(String(info.LastPlayed || info.lastplayed || '0').trim(), 10);
    const playtimeDisconnected = Number.parseInt(String(info.PlaytimeDisconnected || '0').trim(), 10);
    const totalPlaytime = Number.isFinite(playtime) && playtime > 0
      ? playtime
      : (Number.isFinite(playtimeDisconnected) ? playtimeDisconnected : 0);

    if (!totalPlaytime && !lastPlayed) return;
    map.set(cleanAppId, {
      appid: cleanAppId,
      playtime_forever: totalPlaytime,
      rtime_last_played: Number.isFinite(lastPlayed) ? lastPlayed : 0,
      accountId,
    });
  });

  return { accountId, apps: map };
}

// Р§РёС‚Р°РµС‚ РґРѕСЃС‚РёР¶РµРЅРёСЏ РёР· Р»РѕРєР°Р»СЊРЅРѕРіРѕ РєРµС€Р° Steam РґР»СЏ РѕРґРЅРѕР№ РёРіСЂС‹
function steamAchievementIconUrl(appid, iconHash) {
  const cleanHash = String(iconHash || '').trim();
  if (!cleanHash) return '';
  if (/^https?:\/\//i.test(cleanHash)) return cleanHash;
  return `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${cleanHash}`;
}

function readLocalGameAchievements(statsDir, accountId, appid) {
  const schemaPath = path.join(statsDir, `UserGameStatsSchema_${appid}.bin`);
  const statsPath = path.join(statsDir, `UserGameStats_${accountId}_${appid}.bin`);
  if (!require('fs').existsSync(schemaPath) || !require('fs').existsSync(statsPath)) return null;

  const schema = parseBinaryVDF(require('fs').readFileSync(schemaPath));
  const stats = parseBinaryVDF(require('fs').readFileSync(statsPath));

  const appSchema = schema[String(appid)]?.stats || {};
  const cache = stats?.cache || {};
  const achievements = [];

  for (const [blockId, blockSchema] of Object.entries(appSchema)) {
    const bits = blockSchema?.bits || {};
    const block = cache[blockId] || {};
    const mask = block.data || 0;
    const times = block.AchievementTimes || {};

    for (const [bitIdx, bitData] of Object.entries(bits)) {
      const idx = parseInt(bitIdx);
      const achieved = !!(mask & (1 << idx));
      const unlocktime = times[String(idx)] || 0;
      achievements.push({
        apiname: bitData.name || `ach_${blockId}_${idx}`,
        displayName: bitData?.display?.name?.russian || bitData?.display?.name?.english || bitData.name || 'Р”РѕСЃС‚РёР¶РµРЅРёРµ',
        description: bitData?.display?.desc?.russian || bitData?.display?.desc?.english || '',
        achieved: achieved ? 1 : 0,
        unlocktime: typeof unlocktime === 'number' ? unlocktime : 0,
        icon: steamAchievementIconUrl(appid, bitData?.display?.icon),
        iconGray: steamAchievementIconUrl(appid, bitData?.display?.icon_gray || bitData?.display?.icongray),
      });
    }
  }
  return achievements;
}

function readSteamLocalAchievementsForApp(steamPath, steamId, appid) {
  const statsDir = path.join(steamPath, 'appcache', 'stats');
  const candidates = resolveSteamLocalAccountIds(steamPath, steamId);

  for (const accountId of candidates) {
    const achievements = readLocalGameAchievements(statsDir, accountId, appid);
    if (achievements) {
      return { accountId, achievements, statsDir };
    }
  }

  return { accountId: candidates[0] || null, achievements: null, statsDir };
}

function readGseAchievementProgress(appid) {
  const appDataCandidates = [...new Set([
    app.getPath('appData'),
    process.env.APPDATA,
  ].filter(Boolean))];

  for (const appDataDir of appDataCandidates) {
    const achievementsPath = path.join(appDataDir, 'GSE Saves', String(appid), 'achievements.json');
    try {
      if (!fsSync.existsSync(achievementsPath)) continue;
      const parsed = JSON.parse(fsSync.readFileSync(achievementsPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') continue;

      const progress = new Map();
      Object.entries(parsed).forEach(([key, value]) => {
        if (!value || typeof value !== 'object') return;
        progress.set(String(key), {
          achieved: value.earned ? 1 : 0,
          unlocktime: Number(value.earned_time || 0) || 0,
        });
      });
      return { achievementsPath, progress };
    } catch {
      // Try the next candidate path.
    }
  }

  return null;
}

function mergeGseAchievementProgress(achievements, appid) {
  const gse = readGseAchievementProgress(appid);
  if (!gse || !Array.isArray(achievements)) return { achievements, gsePath: null };

  const merged = achievements.map(achievement => {
    const progress = gse.progress.get(String(achievement.apiname || ''));
    if (!progress) return achievement;
    return {
      ...achievement,
      achieved: progress.achieved,
      unlocktime: progress.unlocktime,
    };
  });

  return { achievements: merged, gsePath: gse.achievementsPath };
}

async function enrichLocalSteamAchievements(achievements = [], appid, apiKey, { translate = true } = {}) {
  const next = Array.isArray(achievements)
    ? achievements.map(achievement => ({ ...achievement }))
    : [];

  if (!next.length) return next;

  if (apiKey) {
    try {
      const schemaJson = await fetch(
        `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appid}&l=russian`
      ).then(r => r.json()).catch(() => null);

      const schemaAchs = schemaJson?.game?.availableGameStats?.achievements || [];
      const schemaMap = {};
      schemaAchs.forEach(a => { schemaMap[a.name] = a; });

      next.forEach(achievement => {
        const schemaAchievement = schemaMap[achievement.apiname];
        if (!schemaAchievement) return;
        if (schemaAchievement.icon) achievement.icon = schemaAchievement.icon;
        if (schemaAchievement.icongray) achievement.iconGray = schemaAchievement.icongray;
        if (schemaAchievement.displayName && !looksLikeApiKey(schemaAchievement.displayName)) {
          achievement.displayName = schemaAchievement.displayName;
        }
        if (schemaAchievement.description && !looksLikeApiKey(schemaAchievement.description)) {
          achievement.description = schemaAchievement.description;
        }
      });
    } catch {
      // keep local schema names/descriptions if remote schema is unavailable
    }
  }

  const globalPercentMap = await fetchGlobalAchievementPercentages(appid);
  next.forEach(achievement => {
    const percent = globalPercentMap[achievement.apiname];
    if (Number.isFinite(percent)) achievement.globalPercent = percent;
  });

  if (translate) {
    await translateAchievements(next);
  }

  return next;
}

async function collectSteamLocalSharedGames({ steamPath, steamId, apiKey, ownedAppIds = new Set() }) {
  if (!steamPath || !fsSync.existsSync(steamPath)) return [];

  const { apps: localPlaytimeMap } = readSteamLocalPlaytimeMap(steamPath, steamId);
  const statsDir = path.join(steamPath, 'appcache', 'stats');
  const sharedAppIds = new Set();

  localPlaytimeMap.forEach((_value, appid) => {
    if (!ownedAppIds.has(String(appid))) sharedAppIds.add(String(appid));
  });

  if (fsSync.existsSync(statsDir)) {
    const schemaFiles = fsSync.readdirSync(statsDir).filter(file =>
      file.startsWith('UserGameStatsSchema_') && file.endsWith('.bin')
    );
    schemaFiles.forEach(file => {
      const appid = file.replace('UserGameStatsSchema_', '').replace('.bin', '');
      if (!ownedAppIds.has(String(appid))) sharedAppIds.add(String(appid));
    });
  }

  const sharedGames = await Promise.allSettled([...sharedAppIds].map(async appid => {
    const playtimeInfo = localPlaytimeMap.get(appid) || {};
    const localAchievementsResult = readSteamLocalAchievementsForApp(steamPath, steamId, appid);
    const rawAchievements = localAchievementsResult.achievements || [];
    const achievements = rawAchievements.length
      ? await enrichLocalSteamAchievements(rawAchievements, appid, apiKey, { translate: false })
      : [];
    const details = await fetchSteamAppBasicDetails(appid);
    const title = String(details?.name || '').trim() || `Steam App ${appid}`;

    if (!playtimeInfo.playtime_forever && !achievements.length) return null;

    return {
      appid: String(appid),
      name: title,
      playtime_forever: Number(playtimeInfo.playtime_forever || 0),
      rtime_last_played: Number(playtimeInfo.rtime_last_played || 0),
      achievements,
      achievementsUnlocked: achievements.filter(achievement => achievement.achieved).length,
      achievementsTotal: achievements.length,
      isSharedLibrary: true,
      importedFromLocal: true,
    };
  }));

  return sharedGames
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value);
}

// Читать достижения одной игры из локального кеша
ipcMain.handle('steam:localAchievements', async (_e, { steamPath, steamId, appid, apiKey }) => {
  try {
    let { achievements: rawAchievements, accountId: usedId, statsDir } = readSteamLocalAchievementsForApp(steamPath, steamId, appid);
    
    // Пробуем получить схему через API (если есть ключ)
    if (!rawAchievements && apiKey) {
      const apiResult = await fetchGameAchievements(apiKey, steamId || '0', appid, false);
      if (apiResult && apiResult.length) rawAchievements = apiResult;
    }

    // Если локальных файлов нет и API не дало результат (или нет ключа), пробуем получить схему из сообщества
    if (!rawAchievements) {
      rawAchievements = await fetchSteamCommunityAchievementCatalog(appid);
    }

    if (!rawAchievements) {
      return { ok: false, error: `Не удалось найти схему достижений для AppID ${appid}. Запустите игру в Steam или убедитесь, что AppID верный.` };
    }

    const gseMerge = mergeGseAchievementProgress(rawAchievements, appid);
    let achievements = gseMerge.achievements;
    
    // Обогащаем иконками и переводом
    achievements = await enrichLocalSteamAchievements(achievements, appid, apiKey, { translate: true });

    return {
      ok: true,
      achievements,
      accountId: usedId || '0',
      gsePath: gseMerge.gsePath,
      achievementsUnlocked: achievements.filter(a => a.achieved).length,
      achievementsTotal: achievements.length,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- ОКНО УВЕДОМЛЕНИЙ ---
let notificationWindow = null;
function createNotificationWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  notificationWindow = new BrowserWindow({
    width: 360,
    height: 100,
    x: width - 370,
    y: height - 110,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  notificationWindow.loadFile('renderer/notification.html');
  // notificationWindow.webContents.openDevTools({ mode: 'detach' });
}

ipcMain.on('achievement:show-notification', (e, { game, achievement }) => {
  console.log('IPC: achievement:show-notification received', game?.title, achievement?.displayName);
  if (!notificationWindow) {
    createNotificationWindow();
    notificationWindow.once('ready-to-show', () => {
      console.log('Notification window ready-to-show');
      notificationWindow.webContents.send('achievement:data', { game, achievement });
      notificationWindow.showInactive();
      // notificationWindow.webContents.openDevTools({ mode: 'detach' }); // Раскомментируйте для отладки
    });
  } else {
    console.log('Notification window already exists, sending data');
    notificationWindow.webContents.send('achievement:data', { game, achievement });
    notificationWindow.showInactive();
  }
});

ipcMain.on('achievement:hide-notification', () => {
  if (notificationWindow) {
    notificationWindow.hide();
  }
});

// РЎРєР°РЅРёСЂРѕРІР°С‚СЊ РІСЃРµ РёРіСЂС‹ РёР· Р»РѕРєР°Р»СЊРЅРѕРіРѕ РєРµС€Р°
ipcMain.handle('steam:scanLocal', async (_e, { steamPath, steamId }) => {
  try {
    const statsDir = path.join(steamPath, 'appcache', 'stats');
    const accountId = (steamId ? toAccountId(steamId) : null) || detectAccountId(steamPath);
    const files = await fs.readdir(statsDir);
    const schemaFiles = files.filter(f => f.startsWith('UserGameStatsSchema_') && f.endsWith('.bin'));
    const results = [];
    for (const f of schemaFiles) {
      const appid = f.replace('UserGameStatsSchema_', '').replace('.bin', '');
      const achievements = readLocalGameAchievements(statsDir, accountId, appid);
      if (achievements) {
        results.push({
          appid,
          achievementsTotal: achievements.length,
          achievementsUnlocked: achievements.filter(a => a.achieved).length,
          achievements,
        });
      }
    }
    return { ok: true, games: results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// РџРѕРёСЃРє РёРіСЂ РІ Steam (Р±РµР· API-РєР»СЋС‡Р°)
// Р–Р°РЅСЂС‹ Рё РєР°С‚РµРіРѕСЂРёРё РёРіСЂС‹ РёР· Steam Store (РґР»СЏ Р°РІС‚Рѕ-С‚РµРіРѕРІ)
ipcMain.handle('steam:tags', async (_e, appId) => {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=genres,categories&l=russian`;
    const res = await fetch(url);
    const json = await res.json();
    const data = json?.[appId]?.data;
    if (!data) return { ok: false };
    const genres = (data.genres || []).map(g => g.description).filter(Boolean);
    const categories = (data.categories || []).map(c => c.description).filter(Boolean);
    return { ok: true, genres, categories };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('steam:artwork', async (_e, appId) => {
  try {
    const details = await fetchSteamAppBasicDetails(appId);
    return {
      ok: true,
      coverUrl: details?.coverUrl || '',
      posterUrl: details?.posterUrl || details?.coverUrl || '',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('steam:media', async (_e, appId) => {
  try {
    const cleanAppId = String(appId || '').trim();
    if (!cleanAppId) return { ok: false, media: [] };

    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(cleanAppId)}&filters=screenshots,movies&l=russian`;
    const res = await fetch(url);
    const json = await res.json();
    const data = json?.[cleanAppId]?.data || {};

    const screenshots = (data.screenshots || [])
      .map((item, idx) => ({
        id: `shot_${item.id ?? idx}`,
        type: 'image',
        title: 'РЎРЅРёРјРѕРє СЌРєСЂР°РЅР°',
        thumb: item.path_thumbnail || item.path_full || '',
        full: item.path_full || item.path_thumbnail || '',
      }))
      .filter(item => item.full || item.thumb);

    const movies = (data.movies || [])
      .map((item, idx) => {
        const webm = item.webm?.max || item.webm?.['480'] || '';
        const mp4 = item.mp4?.max || item.mp4?.['480'] || '';
        return {
          id: `movie_${item.id ?? idx}`,
          type: 'video',
          title: item.name || 'Р’РёРґРµРѕ',
          thumb: item.thumbnail || '',
          full: mp4 || webm,
          webm,
          mp4,
        };
      })
      .filter(item => item.mp4 || item.webm);

    return { ok: true, media: [...movies.slice(0, 2), ...screenshots].slice(0, 18) };
  } catch (err) {
    return { ok: false, media: [], error: err.message };
  }
});

ipcMain.handle('steam:search', async (_e, query) => {
  try {
    const res = await fetch(`https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(query)}`);
    const data = await res.json();
    return { ok: true, results: (Array.isArray(data) ? data : []).slice(0, 20) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Р—Р°РіСЂСѓР·РёС‚СЊ/РѕР±РЅРѕРІРёС‚СЊ РґРѕСЃС‚РёР¶РµРЅРёСЏ РґР»СЏ РѕРґРЅРѕР№ РёРіСЂС‹ (СЃ РїРµСЂРµРІРѕРґРѕРј РЅР°Р·РІР°РЅРёР№)
ipcMain.handle('steam:getAchievements', async (_e, { apiKey, steamId, appid }) => {
  try {
    const achievements = await fetchGameAchievements(apiKey, steamId, appid, true);
    return {
      ok: true,
      achievements,
      achievementsUnlocked: achievements.filter(a => a.achieved).length,
      achievementsTotal: achievements.length,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// РџРѕР»РЅС‹Р№ РёРјРїРѕСЂС‚ Steam-Р±РёР±Р»РёРѕС‚РµРєРё
ipcMain.handle('steam:import', async (_e, { apiKey, steamId, steamPath }) => {
  try {
    const summaryJson = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`
    ).then(r => r.json());
    const player = summaryJson?.response?.players?.[0];
    if (!player) throw new Error('РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ. РџСЂРѕРІРµСЂСЊС‚Рµ Steam ID.');

    const gamesJson = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
    ).then(r => r.json());
    const games = gamesJson?.response?.games || [];

    // Р”РѕСЃС‚РёР¶РµРЅРёСЏ РґР»СЏ С‚РѕРї-15 РїРѕ РІСЂРµРјРµРЅРё
    const top15 = [...games].sort((a, b) => b.playtime_forever - a.playtime_forever).slice(0, 15);
    const results = await Promise.allSettled(top15.map(async g => {
      const achievements = await fetchGameAchievements(apiKey, steamId, g.appid);
      return { ...g, achievements, achievementsUnlocked: achievements.filter(a => a.achieved).length, achievementsTotal: achievements.length };
    }));

    const enrichedMap = {};
    results.forEach(r => { if (r.status === 'fulfilled') enrichedMap[r.value.appid] = r.value; });

    const ownedAppIds = new Set(games.map(game => String(game.appid)));
    const localPlaytimeMap = steamPath
      ? readSteamLocalPlaytimeMap(steamPath, steamId).apps
      : new Map();
    const allGames = games.map(g => {
      const game = enrichedMap[g.appid] || { ...g, achievements: [], achievementsUnlocked: 0, achievementsTotal: 0 };
      const localPlaytime = localPlaytimeMap.get(String(g.appid));
      if (!localPlaytime) return game;

      const webPlaytime = Number(game.playtime_forever || 0);
      const webLastPlayed = Number(game.rtime_last_played || 0);
      const localPlaytimeForever = Number(localPlaytime.playtime_forever || 0);
      const localLastPlayed = Number(localPlaytime.rtime_last_played || 0);

      return {
        ...game,
        playtime_forever: Math.max(webPlaytime, localPlaytimeForever),
        rtime_last_played: Math.max(webLastPlayed, localLastPlayed),
      };
    });
    const localSharedGames = steamPath
      ? await collectSteamLocalSharedGames({ steamPath, steamId, apiKey, ownedAppIds })
      : [];

    return { ok: true, player, games: [...allGames, ...localSharedGames] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
// GOOGLE DRIVE
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
const { google } = require('googleapis');
const archiver = require('archiver');
const extractZip = require('extract-zip');
const http = require('http');
const os = require('os');

const TOKEN_PATH = path.join(app.getPath('userData'), 'drive-token.json');
const OAUTH_PORT = 42813;
const FOLDER_NAME = 'Game Tracker';

let _oauthClient = null;
let _oauthServer = null;
let _driveFolderId = null;

function makeOAuthClient(clientId, clientSecret) {
  _oauthClient = new google.auth.OAuth2(
    clientId, clientSecret,
    `http://localhost:${OAUTH_PORT}/oauth2callback`
  );
  _oauthClient.on('tokens', tokens => {
    // РћР±РЅРѕРІР»СЏРµРј СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ С‚РѕРєРµРЅС‹ РїСЂРё Р°РІС‚РѕРѕР±РЅРѕРІР»РµРЅРёРё
    if (tokens.refresh_token) {
      const saved = fsSync.existsSync(TOKEN_PATH)
        ? JSON.parse(fsSync.readFileSync(TOKEN_PATH, 'utf8')) : {};
      fsSync.writeFileSync(TOKEN_PATH, JSON.stringify({ ...saved, ...tokens }));
    }
  });
  return _oauthClient;
}

function getOAuthClient(clientId, clientSecret) {
  if (!_oauthClient) makeOAuthClient(clientId, clientSecret);
  return _oauthClient;
}

// РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ: РїСЂРѕРІРµСЂСЏРµРј СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ С‚РѕРєРµРЅС‹
ipcMain.handle('drive:init', async (_e, { clientId, clientSecret }) => {
  try {
    if (!clientId || !clientSecret) return { ok: true, connected: false };
    const client = getOAuthClient(clientId, clientSecret);
    if (!fsSync.existsSync(TOKEN_PATH)) return { ok: true, connected: false };
    const tokens = JSON.parse(fsSync.readFileSync(TOKEN_PATH, 'utf8'));
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    return { ok: true, connected: true, email: data.email };
  } catch {
    return { ok: true, connected: false };
  }
});

// Р—Р°РїСѓСЃС‚РёС‚СЊ OAuth-Р°РІС‚РѕСЂРёР·Р°С†РёСЋ
ipcMain.handle('drive:connect', async (_e, { clientId, clientSecret }) => {
  return new Promise(resolve => {
    try {
      const client = makeOAuthClient(clientId, clientSecret);
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/userinfo.email'],
        prompt: 'consent',
      });

      // Р›РѕРєР°Р»СЊРЅС‹Р№ СЃРµСЂРІРµСЂ РґР»СЏ РїРµСЂРµС…РІР°С‚Р° РєРѕРґР°
      if (_oauthServer) _oauthServer.close();
      _oauthServer = http.createServer(async (req, res) => {
        if (!req.url.startsWith('/oauth2callback')) return;
        const code = new URL(req.url, `http://localhost:${OAUTH_PORT}`).searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0f1a;color:#e2e8f0"><h2>вњ“ РђРІС‚РѕСЂРёР·Р°С†РёСЏ СѓСЃРїРµС€РЅР°!</h2><p>РњРѕР¶РЅРѕ Р·Р°РєСЂС‹С‚СЊ СЌС‚Рѕ РѕРєРЅРѕ.</p></body></html>');
        _oauthServer.close();
        _oauthServer = null;

        try {
          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          fsSync.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
          const oauth2 = google.oauth2({ version: 'v2', auth: client });
          const { data } = await oauth2.userinfo.get();
          resolve({ ok: true, email: data.email });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });

      _oauthServer.listen(OAUTH_PORT, () => shell.openExternal(authUrl));
      // РўР°Р№РјР°СѓС‚ 5 РјРёРЅСѓС‚
      setTimeout(() => {
        if (_oauthServer) { _oauthServer.close(); _oauthServer = null; }
        resolve({ ok: false, error: 'Timeout' });
      }, 300_000);
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
});

// РћС‚РєР»СЋС‡РёС‚СЊ Drive
ipcMain.handle('drive:disconnect', async () => {
  try {
    if (fsSync.existsSync(TOKEN_PATH)) fsSync.unlinkSync(TOKEN_PATH);
    _oauthClient = null;
    _driveFolderId = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('drive:exportToken', async () => {
  try {
    if (!fsSync.existsSync(TOKEN_PATH)) return { ok: false, error: 'РўРѕРєРµРЅ РЅРµ РЅР°Р№РґРµРЅ' };
    const tokenData = JSON.parse(fsSync.readFileSync(TOKEN_PATH, 'utf8'));
    // Р§РёС‚Р°РµРј clientId/clientSecret РёР· СЃРѕС…СЂР°РЅС‘РЅРЅС‹С… РґР°РЅРЅС‹С… РїСЂРёР»РѕР¶РµРЅРёСЏ
    let clientId = '', clientSecret = '';
    try {
      const appData = JSON.parse(fsSync.readFileSync(getDataPath(), 'utf8'));
      clientId = appData?.settings?.drive?.clientId || '';
      clientSecret = appData?.settings?.drive?.clientSecret || '';
    } catch (_) { }
    const exportData = {
      ...tokenData,
      client_id_hint: clientId,
      client_secret_hint: clientSecret,
    };
    return { ok: true, token: JSON.stringify(exportData) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// РџРѕР»СѓС‡РёС‚СЊ РёР»Рё СЃРѕР·РґР°С‚СЊ РїР°РїРєСѓ "Game Tracker" РІ Drive
async function getDriveFolder(drive) {
  if (_driveFolderId) return _driveFolderId;
  const res = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (res.data.files.length) {
    _driveFolderId = res.data.files[0].id;
    return _driveFolderId;
  }
  const folder = await drive.files.create({
    requestBody: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  _driveFolderId = folder.data.id;
  return _driveFolderId;
}

// Р—Р°РіСЂСѓР·РёС‚СЊ data.json РІ Drive
function driveQueryValue(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function getDriveChildFolder(drive, parentId, name) {
  const folderName = safePathPart(name || 'folder');
  const res = await drive.files.list({
    q: `name='${driveQueryValue(folderName)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
  });
  if (res.data.files.length) return res.data.files[0].id;
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });
  return folder.data.id;
}

async function findDriveFileByName(drive, parentId, name) {
  const res = await drive.files.list({
    q: `name='${driveQueryValue(name)}' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id,name,modifiedTime,size)',
  });
  return res.data.files[0] || null;
}

ipcMain.handle('drive:uploadScreenshots', async (_e, { games = {} } = {}) => {
  try {
    const drive = google.drive({ version: 'v3', auth: _oauthClient });
    const folderId = await getDriveFolder(drive);
    const screenshotsFolderId = await getDriveChildFolder(drive, folderId, 'screenshots');
    const updates = {};
    let uploaded = 0;
    let skipped = 0;

    for (const [gameId, game] of Object.entries(games || {})) {
      const screenshots = Array.isArray(game?.screenshots) ? game.screenshots : [];
      if (!screenshots.length) continue;
      const gameFolderId = await getDriveChildFolder(drive, screenshotsFolderId, gameId);

      for (const shot of screenshots) {
        const localPath = String(shot.localPath || '').trim();
        if (!localPath || !fsSync.existsSync(localPath)) {
          skipped += 1;
          continue;
        }
        const stat = fsSync.statSync(localPath);
        if (!stat.isFile()) {
          skipped += 1;
          continue;
        }

        const shotId = String(shot.id || shot.driveFileId || shot.fileName || path.basename(localPath));
        const fileName = safePathPart(shot.driveFileName || shot.fileName || path.basename(localPath));
        const mimeType = shot.mimeType || imageMimeType(localPath);
        let file = null;
        let fileId = String(shot.driveFileId || '').trim();

        if (fileId) {
          try {
            const res = await drive.files.update({
              fileId,
              media: { mimeType, body: fsSync.createReadStream(localPath) },
              fields: 'id,name,modifiedTime,size',
            });
            file = res.data;
          } catch (_) {
            fileId = '';
          }
        }

        if (!file) {
          const existing = await findDriveFileByName(drive, gameFolderId, fileName);
          if (existing?.id) {
            const res = await drive.files.update({
              fileId: existing.id,
              media: { mimeType, body: fsSync.createReadStream(localPath) },
              fields: 'id,name,modifiedTime,size',
            });
            file = res.data;
          } else {
            const res = await drive.files.create({
              requestBody: { name: fileName, parents: [gameFolderId] },
              media: { mimeType, body: fsSync.createReadStream(localPath) },
              fields: 'id,name,modifiedTime,size',
            });
            file = res.data;
          }
        }

        updates[gameId] ??= {};
        updates[gameId][shotId] = {
          driveFileId: file.id,
          driveFileName: file.name || fileName,
          driveModifiedTime: file.modifiedTime || new Date().toISOString(),
          fileName,
          size: Number(file.size || stat.size || 0),
          mimeType,
          syncedAt: new Date().toISOString(),
        };
        uploaded += 1;
      }
    }

    return { ok: true, uploaded, skipped, updates, time: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('drive:downloadScreenshots', async (_e, { games = {} } = {}) => {
  try {
    const drive = google.drive({ version: 'v3', auth: _oauthClient });
    const updates = {};
    let downloaded = 0;
    let skipped = 0;

    for (const [gameId, game] of Object.entries(games || {})) {
      const screenshots = Array.isArray(game?.screenshots) ? game.screenshots : [];
      if (!screenshots.length) continue;
      const targetDir = screenshotGameDir(gameId);
      await fs.mkdir(targetDir, { recursive: true });

      for (const shot of screenshots) {
        const shotId = String(shot.id || shot.driveFileId || shot.driveFileName || shot.fileName || '');
        const driveFileId = String(shot.driveFileId || '').trim();
        const fileName = safePathPart(shot.driveFileName || shot.fileName || `${shotId || 'screenshot'}.jpg`);
        const destPath = path.join(targetDir, fileName);

        updates[gameId] ??= {};
        if (fsSync.existsSync(destPath)) {
          updates[gameId][shotId] = {
            fileName,
            localPath: destPath,
            url: screenshotUrl(destPath),
            downloadedAt: shot.downloadedAt || new Date().toISOString(),
          };
          continue;
        }

        if (!driveFileId) {
          skipped += 1;
          continue;
        }

        try {
          const dest = fsSync.createWriteStream(destPath);
          const dlRes = await drive.files.get({ fileId: driveFileId, alt: 'media' }, { responseType: 'stream' });
          await new Promise((res, rej) => {
            dlRes.data.pipe(dest);
            dest.on('finish', res);
            dest.on('error', rej);
          });
          updates[gameId][shotId] = {
            fileName,
            localPath: destPath,
            url: screenshotUrl(destPath),
            downloadedAt: new Date().toISOString(),
          };
          downloaded += 1;
        } catch (_) {
          skipped += 1;
        }
      }
    }

    return { ok: true, downloaded, skipped, updates, time: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('drive:uploadData', async (_e, data) => {
  try {
    const drive = google.drive({ version: 'v3', auth: _oauthClient });
    const folderId = await getDriveFolder(drive);
    const content = JSON.stringify(data);
    const stream = require('stream');
    const body = new stream.Readable();
    body.push(content); body.push(null);

    // РџСЂРѕРІРµСЂСЏРµРј СЃСѓС‰РµСЃС‚РІСѓРµС‚ Р»Рё С„Р°Р№Р»
    const existing = await drive.files.list({
      q: `name='data.json' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id)',
    });

    if (existing.data.files.length) {
      await drive.files.update({
        fileId: existing.data.files[0].id,
        media: { mimeType: 'application/json', body },
      });
    } else {
      await drive.files.create({
        requestBody: { name: 'data.json', parents: [folderId] },
        media: { mimeType: 'application/json', body },
        fields: 'id',
      });
    }
    return { ok: true, time: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// РЎРєР°С‡Р°С‚СЊ data.json РёР· Drive
ipcMain.handle('drive:downloadData', async () => {
  try {
    const drive = google.drive({ version: 'v3', auth: _oauthClient });
    const folderId = await getDriveFolder(drive);
    const res = await drive.files.list({
      q: `name='data.json' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id,modifiedTime)',
    });
    if (!res.data.files.length) return { ok: false, error: 'Р¤Р°Р№Р» РЅРµ РЅР°Р№РґРµРЅ РІ Drive' };
    const fileId = res.data.files[0].id;
    const file = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
    return { ok: true, data: JSON.parse(file.data), modifiedTime: res.data.files[0].modifiedTime };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Р—Р°РіСЂСѓР·РёС‚СЊ СЃРѕС…СЂР°РЅРµРЅРёРµ РёРіСЂС‹ (zip РїР°РїРєРё)
ipcMain.handle('drive:uploadSave', async (_e, { gameId, gameName, savePath }) => {
  try {
    if (!fsSync.existsSync(savePath)) return { ok: false, error: 'РџР°РїРєР° РЅРµ РЅР°Р№РґРµРЅР°: ' + savePath };
    const drive = google.drive({ version: 'v3', auth: _oauthClient });
    const folderId = await getDriveFolder(drive);

    // РџР°РїРєР° saves/ РІРЅСѓС‚СЂРё Game Tracker
    let savesFolderId;
    const savesRes = await drive.files.list({
      q: `name='saves' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });
    if (savesRes.data.files.length) {
      savesFolderId = savesRes.data.files[0].id;
    } else {
      const f = await drive.files.create({
        requestBody: { name: 'saves', mimeType: 'application/vnd.google-apps.folder', parents: [folderId] },
        fields: 'id',
      });
      savesFolderId = f.data.id;
    }

    // РЎРѕР·РґР°С‘Рј zip РІРѕ РІСЂРµРјРµРЅРЅРѕР№ РїР°РїРєРµ
    const safe = gameName.replace(/[^Р°-СЏС‘a-z0-9_\-]/gi, '_');
    const zipName = `${gameId}_${safe}.zip`;
    const tmpZip = path.join(os.tmpdir(), zipName);

    await new Promise((res, rej) => {
      const out = fsSync.createWriteStream(tmpZip);
      const arc = archiver('zip', { zlib: { level: 6 } });
      out.on('close', res);
      arc.on('error', rej);
      arc.pipe(out);
      const stat = fsSync.statSync(savePath);
      if (stat.isDirectory()) arc.directory(savePath, false);
      else arc.file(savePath, { name: path.basename(savePath) });
      arc.finalize();
    });

    const zipStream = fsSync.createReadStream(tmpZip);

    // РћР±РЅРѕРІР»СЏРµРј РёР»Рё СЃРѕР·РґР°С‘Рј С„Р°Р№Р» РІ Drive
    const existingZip = await drive.files.list({
      q: `name='${zipName}' and '${savesFolderId}' in parents and trashed=false`,
      fields: 'files(id)',
    });
    if (existingZip.data.files.length) {
      await drive.files.update({
        fileId: existingZip.data.files[0].id,
        media: { mimeType: 'application/zip', body: zipStream },
      });
    } else {
      await drive.files.create({
        requestBody: { name: zipName, parents: [savesFolderId] },
        media: { mimeType: 'application/zip', body: zipStream },
        fields: 'id',
      });
    }

    fsSync.unlinkSync(tmpZip);
    return { ok: true, time: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// РЎРєР°С‡Р°С‚СЊ Рё РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ СЃРѕС…СЂР°РЅРµРЅРёРµ
ipcMain.handle('drive:downloadSave', async (_e, { gameId, gameName, savePath }) => {
  try {
    const drive = google.drive({ version: 'v3', auth: _oauthClient });
    const folderId = await getDriveFolder(drive);

    const savesRes = await drive.files.list({
      q: `name='saves' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });
    if (!savesRes.data.files.length) return { ok: false, error: 'РЎРѕС…СЂР°РЅРµРЅРёР№ РІ Drive РЅРµС‚' };
    const savesFolderId = savesRes.data.files[0].id;

    const safe = gameName.replace(/[^Р°-СЏС‘a-z0-9_\-]/gi, '_');
    const zipName = `${gameId}_${safe}.zip`;
    const zipRes = await drive.files.list({
      q: `name='${zipName}' and '${savesFolderId}' in parents and trashed=false`,
      fields: 'files(id,modifiedTime)',
    });
    if (!zipRes.data.files.length) return { ok: false, error: 'Р¤Р°Р№Р» СЃРѕС…СЂР°РЅРµРЅРёСЏ РЅРµ РЅР°Р№РґРµРЅ РІ Drive' };

    const tmpZip = path.join(os.tmpdir(), zipName);
    const dest = fsSync.createWriteStream(tmpZip);
    const dlRes = await drive.files.get({ fileId: zipRes.data.files[0].id, alt: 'media' }, { responseType: 'stream' });
    await new Promise((res, rej) => {
      dlRes.data.pipe(dest);
      dest.on('finish', res);
      dest.on('error', rej);
    });

    await fs.mkdir(savePath, { recursive: true });
    await extractZip(tmpZip, { dir: savePath });
    fsSync.unlinkSync(tmpZip);
    return { ok: true, modifiedTime: zipRes.data.files[0].modifiedTime };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Р”РёР°Р»РѕРі РІС‹Р±РѕСЂР° РїР°РїРєРё
ipcMain.handle('drive:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Р’С‹Р±РµСЂРё РїР°РїРєСѓ СЃ СЃРѕС…СЂР°РЅРµРЅРёСЏРјРё РёРіСЂС‹',
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('poster:pick', async (_e, { gameId, gameTitle } = {}) => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: `Выбрать постер${gameTitle ? `: ${gameTitle}` : ''}`,
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };

    const sourcePath = res.filePaths[0];
    const ext = path.extname(sourcePath).toLowerCase();
    if (!SCREENSHOT_EXTS.has(ext) || ext === '.gif' || ext === '.bmp') {
      return { ok: false, error: 'Выбери JPG, PNG или WebP' };
    }

    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) return { ok: false, error: 'Файл не найден' };

    const targetDir = path.join(postersRoot(), safePathPart(gameId || gameTitle || 'game'));
    await fs.mkdir(targetDir, { recursive: true });

    const preferredName = `${Date.now()}_${safePathPart(path.basename(sourcePath, ext) || 'poster')}${ext}`;
    const destPath = await uniqueFilePath(targetDir, preferredName);
    await fs.copyFile(sourcePath, destPath);

    return {
      ok: true,
      posterUrl: screenshotUrl(destPath),
      localPath: destPath,
      fileName: path.basename(destPath),
      mimeType: imageMimeType(destPath),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
