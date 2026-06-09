/**
 * GameTracker — Virtual List Module (optimized)
 * Renders only visible items for huge lists (500+ games).
 * Improvements:
 *   - Uses transform: translateY for GPU‑accelerated positioning
 *   - Element pooling to reduce DOM allocations
 *   - Adaptive overscan based on viewport size
 *   - CSS contain and will‑change hints
 *   - Debounced resize observer
 */
(function (global) {
  'use strict';

  class GTVirtualList {
    constructor(opts) {
      this.container = opts.container;
      this.items = opts.items || [];
      this.itemHeight = opts.itemHeight || 60;
      // overscan will be computed adaptively; keep a min value for fallback
      this._overscanBase = opts.overscan != null ? opts.overscan : 5;
      this.renderItem = opts.renderItem;
      this.onMount = opts.onMount;
      this.onUnmount = opts.onUnmount;

      this._scrollTop = 0;
      this._mounted = new Map();      // index => {el}
      this._pool = [];                // free elements for reuse
      this._rafId = null;             // for scroll rAF
      this._resizeRAFId = null;       // for resize rAF
      this._containerHeight = 0;

      this._build();
      this._attach();
      this._render();
    }

    /* -------------------- lifecycle -------------------- */
    _build() {
      this.container.classList.add('gt-vlist');
      // spacer + viewport
      this.container.innerHTML =
        '<div class="gt-vlist__spacer"><div class="gt-vlist__viewport"></div></div>';
      this.spacer = this.container.querySelector('.gt-vlist__spacer');
      this.viewport = this.container.querySelector('.gt-vlist__viewport');
      // hint to browser that internal changes won't affect layout outside
      this.container.style.contain = 'strict';
      this._updateSpacer();
    }

    _attach() {
      // scroll – use rAF to coalesce multiple events
      this._onScroll = () => {
        this._scrollTop = this.container.scrollTop;
        if (this._rafId) return;
        this._rafId = requestAnimationFrame(() => {
          this._rafId = null;
          this._render();
        });
      };
      this.container.addEventListener('scroll', this._onScroll, { passive: true });

      // resize – debounce via rAF
      this._onResize = () => {
        if (this._resizeRAFId) return;
        this._resizeRAFId = requestAnimationFrame(() => {
          this._resizeRAFId = null;
          this._updateContainerHeight();
          this._render();
        });
      };
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.container);
    }

    _detach() {
      this.container.removeEventListener('scroll', this._onScroll);
      if (this._ro) this._ro.disconnect();
      if (this._rafId) cancelAnimationFrame(this._rafId);
      if (this._resizeRAFId) cancelAnimationFrame(this._resizeRAFId);
    }

    /* -------------------- core -------------------- */
    _updateSpacer() {
      this.spacer.style.height = (this.items.length * this.itemHeight) + 'px';
    }

    _updateContainerHeight() {
      this._containerHeight = this.container.clientHeight || 600;
    }

    /**
     * Compute adaptive overscan: at least 3 extra rows, plus enough to cover
     * viewport height, plus a small buffer.
     */
    _computeOverscan() {
      const base = this._overscanBase;
      if (this._containerHeight === 0) this._updateContainerHeight();
      const viewportRows = Math.ceil(this._containerHeight / this.itemHeight);
      return Math.max(base, viewportRows + 2);
    }

    _render() {
      if (this._containerHeight === 0) this._updateContainerHeight();

      const containerHeight = this._containerHeight;
      const itemHeight = this.itemHeight;
      const overscan = this._computeOverscan();

      const start = Math.max(0, Math.floor(this._scrollTop / itemHeight) - overscan);
      const end = Math.min(
        this.items.length,
        Math.ceil((this._scrollTop + containerHeight) / itemHeight) + overscan
      );

      // --- unmount items that are out of view ---
      for (const [idx, entry] of this._mounted) {
        if (idx < start || idx >= end) {
          if (this.onUnmount) this.onUnmount(entry.el, this.items[idx], idx);
          // detach from DOM, clean, and pool
          entry.el.remove();
          entry.el.removeAttribute('style');
          entry.el.removeAttribute('data-vidx');
          entry.el.classList.remove('gt-vlist__item');
          this._pool.push(entry.el);
          this._mounted.delete(idx);
        }
      }

      // --- mount / recycle items that are needed ---
      const frag = document.createDocumentFragment();
      const needMount = [];
      for (let i = start; i < end; i++) {
        if (!this._mounted.has(i)) needMount.push(i);
      }
      for (const i of needMount) {
        let el;
        if (this._pool.length) {
          el = this._pool.pop();
        } else {
          el = this.renderItem(this.items[i], i);
          if (!el) continue;
        }
        // ensure element is ready for reuse
        el.classList.add('gt-vlist__item');
        el.dataset.vIdx = String(i);
        // GPU‑accelerated positioning
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.right = '0';
        el.style.height = itemHeight + 'px';
        el.style.transform = `translateY(${i * itemHeight}px)`;
        el.style.willChange = 'transform';
        frag.appendChild(el);
        this._mounted.set(i, { el });
        if (this.onMount) this.onMount(el, this.items[i], i);
      }
      if (frag.childNodes.length) this.viewport.appendChild(frag);
    }

    /* -------------------- public API -------------------- */
    /**
     * Replace the whole list.
     */
    setItems(items) {
      this.items = items || [];
      this._updateSpacer();
      // clear mounted & pool
      for (const [idx, entry] of this._mounted) {
        if (this.onUnmount) this.onUnmount(entry.el, null, idx);
        entry.el.remove();
      }
      this._mounted.clear();
      this._pool.forEach(el => el.remove());
      this._pool.length = 0;
      this._scrollTop = 0;
      this.container.scrollTop = 0;
      this._render();
    }

    /** Force a re‑render (useful after itemHeight change). */
    refresh() {
      this._render();
    }

    /** Scroll to a specific index (smooth if container supports it). */
    scrollToIndex(idx) {
      const target = Math.max(0, idx * this.itemHeight);
      // If you want smooth behavior, you could use scrollTo with options.
      this.container.scrollTop = target;
    }

    /** Clean up listeners and DOM. */
    destroy() {
      this._detach();
      // remove any remaining mounted elements
      for (const [idx, entry] of this._mounted) {
        if (this.onUnmount) this.onUnmount(entry.el, null, idx);
        entry.el.remove();
      }
      this._mounted.clear();
      // remove pooled elements
      this._pool.forEach(el => el.remove());
      this._pool.length = 0;
      this.container.classList.remove('gt-vlist');
      this.container.style.contain = '';
      this.container.innerHTML = '';
    }
  }

  global.GTVirtualList = GTVirtualList;
})(window);
