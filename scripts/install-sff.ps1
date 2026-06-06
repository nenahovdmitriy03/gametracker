param(
  [string]$InstallDir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'SFF'),
  [string]$RepoUrl = 'https://github.com/Midrags/SFF.git'
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "[SteaMidra] $Message"
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = (Get-Location).Path
  )

  Write-Step "$FilePath $($Arguments -join ' ')"
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Command failed with exit code $($process.ExitCode): $FilePath $($Arguments -join ' ')"
  }
}

function Find-Python {
  $candidates = @(
    @{ File = 'py'; Args = @('-3.12') },
    @{ File = 'py'; Args = @('-3.13') },
    @{ File = 'python'; Args = @() }
  )

  foreach ($candidate in $candidates) {
    $cmd = Get-Command $candidate.File -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }

    try {
      $versionArgs = @($candidate.Args) + @('--version')
      $output = & $candidate.File @versionArgs 2>&1
      if ($LASTEXITCODE -eq 0 -and "$output" -match 'Python 3\.(1[2-9]|[2-9][0-9])') {
        return @{ File = $candidate.File; Args = [string[]]$candidate.Args }
      }
    } catch {
      continue
    }
  }

  throw 'Python 3.12+ was not found. Install Python 3.12/3.13 and run this installer again.'
}

function Update-TextFile {
  param(
    [string]$Path,
    [scriptblock]$Transform
  )

  $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $next = & $Transform $text
  if ($next -ne $text) {
    Set-Content -LiteralPath $Path -Value $next -Encoding UTF8 -NoNewline
  }
}

function Set-JsonTranslations {
  param([string]$Path)

  $json = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  $translations = [ordered]@{
    '-- Select a game --' = '-- Выберите игру --'
    '-- select a recent file --' = '-- выберите недавний файл --'
    '1. Verify + first launch' = '1. Проверка файлов и первый запуск'
    '2. Steam launch options' = '2. Параметры запуска Steam'
    '3. Rename EAC folder' = '3. Переименовать папку EAC'
    '4. Executable swap' = '4. Подмена исполняемого файла'
    '5. steam_appid.txt / .bat' = '5. steam_appid.txt / .bat'
    '6. Firewall block' = '6. Блокировка через firewall'
    '7. Crack / fix files' = '7. Файлы исправлений'
    'A new LumaCore version is available.' = 'Доступна новая версия LumaCore.'
    'About' = 'О программе'
    'Account & Credentials' = 'Аккаунт и учётные данные'
    'Achievements safe' = 'Безопасно для достижений'
    'Active downloads & history' = 'Активные загрузки и история'
    'Advanced Mode' = 'Расширенный режим'
    'All Save Locations' = 'Все расположения сохранений'
    'Anonymous (no login)' = 'Анонимно (без входа)'
    'Application language' = 'Язык приложения'
    'Apply the selected emulator and settings to the game' = 'Применить выбранный эмулятор и настройки к игре'
    'Auto' = 'Авто'
    'Auto Backup' = 'Автобэкап'
    'Auto LC Setup' = 'Автонастройка LC'
    'Auto-detected' = 'Найдено автоматически'
    'Backing up...' = 'Создаётся резервная копия...'
    'Backup All Now' = 'Сделать бэкап всего сейчас'
    'Backup and restore Steam cloud save files' = 'Резервное копирование и восстановление Steam Cloud-сохранений'
    'Backup Destination:' = 'Куда сохранять бэкапы:'
    'Backup Folder:' = 'Папка бэкапов:'
    'Backup provider:' = 'Провайдер бэкапа:'
    'Backup Retention Count:' = 'Сколько бэкапов хранить:'
    'Browse' = 'Обзор'
    'Browse & download games with cover images' = 'Просмотр и загрузка игр с обложками'
    'Browse for game folder' = 'Выбрать папку игры'
    'Browse for Steam folder' = 'Выбрать папку Steam'
    'Browse local files' = 'Открыть локальные файлы'
    'Browse...' = 'Обзор...'
    'Check for updates' = 'Проверить обновления'
    'Check Status' = 'Проверить статус'
    'Choose' = 'Выбрать'
    'Choose a folder...' = 'Выберите папку...'
    'Clear log' = 'Очистить журнал'
    'Cloud Provider' = 'Облачный провайдер'
    'Configure SteaMidra preferences' = 'Настройки SteaMidra'
    'Copy all log text' = 'Скопировать весь журнал'
    'Current version:' = 'Текущая версия:'
    'Date' = 'Дата'
    'Debug' = 'Отладка'
    'Default' = 'По умолчанию'
    'Deselect All' = 'Снять выделение'
    'Desktop Notifications' = 'Уведомления рабочего стола'
    'Destination folder:' = 'Папка назначения:'
    'Download' = 'Загрузить'
    'Download Game' = 'Загрузить игру'
    'Download older version' = 'Загрузить старую версию'
    'Download Selected' = 'Загрузить выбранное'
    'Download Settings' = 'Настройки загрузки'
    'Download source:' = 'Источник загрузки:'
    'Download via DDMod' = 'Загрузить через DDMod'
    'Download via Steam' = 'Загрузить через Steam'
    'Download Workshop Item' = 'Загрузить элемент Workshop'
    'Drop .lua / .manifest files here' = 'Перетащите сюда .lua / .manifest файлы'
    'Enable advanced mode with extra options' = 'Включить расширенный режим с дополнительными параметрами'
    'Enable desktop notifications for completed tasks' = 'Показывать уведомления о завершённых задачах'
    'English' = 'Английский'
    'Enter API key' = 'Введите API-ключ'
    'Enter App ID' = 'Введите App ID'
    'Enter Steam password' = 'Введите пароль Steam'
    'Enter Steam username' = 'Введите логин Steam'
    'Enter Steam Web API key' = 'Введите Steam Web API key'
  }

  foreach ($key in $translations.Keys) {
    $json | Add-Member -NotePropertyName $key -NotePropertyValue $translations[$key] -Force
  }

  $json | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding UTF8
}

Write-Step "Target: $InstallDir"

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  throw 'Git was not found. Install Git and run this installer again.'
}

$parent = Split-Path -Parent $InstallDir
New-Item -ItemType Directory -Force -Path $parent | Out-Null

if (-not (Test-Path $InstallDir)) {
  Invoke-Checked -FilePath 'git' -Arguments @('clone', $RepoUrl, $InstallDir) -WorkingDirectory $parent
} elseif (Test-Path (Join-Path $InstallDir '.git')) {
  $dirty = & git -C $InstallDir status --porcelain
  if ($dirty) {
    Write-Step 'Existing SFF checkout has local changes; skipping git pull.'
  } else {
    Invoke-Checked -FilePath 'git' -Arguments @('-C', $InstallDir, 'pull', '--ff-only') -WorkingDirectory $InstallDir
  }
} else {
  throw "Target folder exists but is not a git checkout: $InstallDir"
}

$python = Find-Python
$venvPython = Join-Path $InstallDir '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
  Invoke-Checked -FilePath $python.File -Arguments (@($python.Args) + @('-m', 'venv', (Join-Path $InstallDir '.venv'))) -WorkingDirectory $InstallDir
}

Invoke-Checked -FilePath $venvPython -Arguments @('-m', 'pip', 'install', '--upgrade', 'pip') -WorkingDirectory $InstallDir
Invoke-Checked -FilePath $venvPython -Arguments @('-m', 'pip', 'install', '-r', 'requirements.txt') -WorkingDirectory $InstallDir
Invoke-Checked -FilePath $venvPython -Arguments @('-m', 'pip', 'install', 'steam==1.4.4', '--no-deps') -WorkingDirectory $InstallDir

$i18nPath = Join-Path $InstallDir 'sff\webui\js\i18n.js'
Set-Content -LiteralPath $i18nPath -Encoding UTF8 -NoNewline -Value @'
/**
 * SteaMidra -- Web UI i18n
 * Loads translations from the backend and applies them to [data-i18n] elements.
 */

window.I18n = (function() {
    'use strict';

    var _translations = {};
    var _currentLang = 'ru';
    var _rtlLangs = ['ar', 'he', 'fa', 'ur'];

    function applyLanguage(lang, onDone) {
        if (!lang || lang === 'Auto') lang = 'ru';
        _currentLang = lang;

        Bridge.callWithCallback('get_webui_translations', lang, function(json) {
            try {
                _translations = JSON.parse(json || '{}');
            } catch(e) {
                _translations = {};
            }
            _applyToDOM();
            _setDirection(lang);
            if (typeof onDone === 'function') onDone();
        });
    }

    function t(key) {
        return _translations[key] || key;
    }

    function _applyToDOM() {
        document.querySelectorAll('[data-i18n]').forEach(function(el) {
            var key = el.getAttribute('data-i18n');
            var val = _translations[key];
            if (val) el.textContent = val;
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
            var key = el.getAttribute('data-i18n-placeholder');
            var val = _translations[key];
            if (val) el.placeholder = val;
        });
        _applyPlainTextNodes();
        _applyTranslatableAttributes();
    }

    function _applyPlainTextNodes() {
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        var skipTags = { SCRIPT: true, STYLE: true, TEXTAREA: true, INPUT: true, SELECT: true, OPTION: true, CODE: true, PRE: true };
        var node;
        while ((node = walker.nextNode())) {
            var parent = node.parentElement;
            if (!parent || skipTags[parent.tagName]) continue;
            var raw = node.nodeValue || '';
            var trimmed = raw.trim();
            if (!trimmed) continue;
            var translated = _translations[trimmed];
            if (!translated || translated === trimmed) continue;
            node.nodeValue = raw.replace(trimmed, translated);
        }
    }

    function _applyTranslatableAttributes() {
        ['title', 'data-tooltip', 'aria-label'].forEach(function(attr) {
            document.querySelectorAll('[' + attr + ']').forEach(function(el) {
                var key = el.getAttribute(attr);
                var val = _translations[key];
                if (val) el.setAttribute(attr, val);
            });
        });
    }

    function _setDirection(lang) {
        var isRTL = _rtlLangs.indexOf(lang) !== -1;
        document.documentElement.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
        document.documentElement.setAttribute('lang', lang);
    }

    return {
        applyLanguage: applyLanguage,
        t: t
    };
})();
'@

Update-TextFile -Path (Join-Path $InstallDir 'sff\webui\js\app.js') -Transform {
  param($text)
  $text.Replace("I18n.applyLanguage(lang || 'en')", "I18n.applyLanguage(lang || 'ru')")
}

Update-TextFile -Path (Join-Path $InstallDir 'sff\webui\js\settings.js') -Transform {
  param($text)
  $text.Replace("settings.language || 'en'", "settings.language || 'ru'")
}

Update-TextFile -Path (Join-Path $InstallDir 'Main_gui.py') -Transform {
  param($text)
  $text.Replace('lang = get_setting(Settings.LANGUAGE)', 'lang = get_setting(Settings.LANGUAGE) or "ru"')
}

Set-JsonTranslations -Path (Join-Path $InstallDir 'sff\locales\webui_ru.json')

$runnerPath = Join-Path $InstallDir 'run_sff.bat'
Set-Content -LiteralPath $runnerPath -Encoding ASCII -Value @'
@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "Main_gui.py"
) else (
  python "Main_gui.py"
)
'@

Invoke-Checked -FilePath $venvPython -Arguments @('-m', 'py_compile', 'Main_gui.py', 'sff\gui\web_bridge.py', 'sff\storage\settings.py') -WorkingDirectory $InstallDir

Write-Step "Installed and localized SteaMidra at $InstallDir"
