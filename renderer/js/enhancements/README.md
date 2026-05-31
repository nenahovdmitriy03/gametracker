# GameTracker UX Enhancements (PR #2)

Адитивные модули UX-улучшений. Подключаются в `renderer/index.html`через теги `<script>` и работают параллельно с существующим кодом `app.js` — **никакиествующие файлы не модифицированы**.

## Модули

| Файл | Глобальный API | Что делает |
|------|----------------|-----------|
| `fuzzy-search.js` | `window.GTFuzzy` | Fuzzy-поиск как в VS Code (score + highlight) |
| `virtual-list.js` | `window.GTVirtualList` | Виртуализация длинных списков (500+ айтемов) |
| `skeleton-loader.js` | `window.GTSkeleton` | Плейсхолдеры при загрузке |
| `command-palette.js` | `window.GTCommandPalette` | Командная палитра по ⌘ / Ctrl+K |
| `ux-loader.js` | `window.GTEnhancements` | Точка входа, ленивая инициализация |

## Подключение

В `renderer/index.html` перед закрывающим `</body>` добавлены строки:

```html
<link rel="stylesheet" href="css/enhancements/ux-improvements.css">
<script src="js/enhancements/fuzzy-search.js"></script>
<script src="js/enhancements/virtual-list.js"></script>
<script src="js/enhancements/skeleton-loader.js"></script>
<script src="js/enhancements/command-palette.js"></script>
<script src="js/enhancements/ux-loader.js"></script>
```

## API

### Fuzzy search
```js
const results = GTFuzzy.filter(games, query, g => g.title);
// results: [{ item, score, matches: [indexes] }, ...]
element.innerHTML = GTFuzzy.highlight(game.title, results[0].matches);
```

### Virtual list
```js
const vlist = new GTVirtualList({
  container: document.getElementById('game-list'),
  items: games,
  itemHeight: 72,
  renderItem: (game) => {
    const el = document.createElement('div');
    el.textContent = game.title;
    return el;
  }
});
vlist.setItems(newGames);
```

### Skeleton
```js
GTSkeleton.gameGrid(document.getElementById('library'), 12);
// ...fetch data...
GTSkeleton.clear(document.getElementById('library'));
```

### Command palette
Открывается автоматически по **⌘K / Ctrl+K**. Подхватывает sidebar и игры из DOM.

```js
GTCommandPalette.register({
  title: 'Sync Steam',
  icon: '🎮',
  group: 'Actions',
  shortcut: '⌘S',
  run: () => window.syncSteam()
});
```

## Откат

Если что-то сломалось — удалите 5 строк подключения из `renderer/index.html`. Все файлы изолированы в `renderer/js/enhancements/` и `renderer/css/enhancements/`.
