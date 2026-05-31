/**
 * GameTracker — Virtual List Module
 * Renders only visible items for huge lists (500+ games).
 */
(function (global) {
  'use strict';

  class GTVirtualList {
    constructor(opts) {
      this.container = opts.container;
      this.items = opts.items || [];
      this.itemHeight = opts.itemHeight || 60;
      this.overscan = opts.overscan != null ? opts.overscan : 5;
      this.renderItem = opts.renderItem;
      this.onMount = opts.onMount;
      this.onUnmount = opts.onUnmount;

      this._scrollTop = 0;
      this._mounted = new Map();
      this._rafId = null;

      this._build();
      this._attach();
      this._render();
    }

    _build() {
      this.container.classList.add('gt-vlist');
      this.container.innerHTML = '<div class="gt-vlist__spacer"><div class="gt-vlist__viewport"></div></div>';
      this.spacer = this.container.querySelector('.gt-vlist__spacer');
      this.viewport = this.container.querySelector('.gt-vlist__viewport');
      this._updateSpacer();
    }

    _attach() {
      this._onScroll = () => {
        this._scrollTop = this.container.scrollTop;
        if (this._rafId) return;
        this._rafId = requestAnimationFrame(() => {
          this._rafId = null;
          this._render();
        });
      };
      this.container.addEventListener('scroll', this._onScroll, { passive: true });

      this._onResize = () => this._render();
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.container);
    }

    _updateSpacer() {
      this.spacer.style.height = (this.items.length * this.itemHeight) + 'px';
    }

    _render() {
      const containerHeight = this.container.clientHeight || 600;
      const start = Math.max(0, Math.floor(this._scrollTop / this.itemHeight) - this.overscan);
      const end = Math.min(
        this.items.length,
        Math.ceil((this._scrollTop + containerHeight) / this.itemHeight) + this.overscan
      );

      for (const [idx, entry] of this._mounted) {
        if (idx < start || idx >= end) {
          if (this.onUnmount) this.onUnmount(entry.el, this.items[idx], idx);
          entry.el.remove();
          this._mounted.delete(idx);
        }
      }

      const frag = document.createDocumentFragment();
      const needMount = [];
      for (let i = start; i < end; i++) {
        if (!this._mounted.has(i)) needMount.push(i);
      }
      for (const i of needMount) {
        const el = this.renderItem(this.items[i], i);
        if (!el) continue;
        el.classList.add('gt-vlist__item');
        el.style.position = 'absolute';
        el.style.top = (i * this.itemHeight) + 'px';
        el.style.left = '0';
        el.style.right = '0';
        el.style.height = this.itemHeight + 'px';
        el.dataset.vIdx = String(i);
        this._mounted.set(i, { el });
        frag.appendChild(el);
        if (this.onMount) this.onMount(el, this.items[i], i);
      }
      if (frag.childNodes.length) this.viewport.appendChild(frag);
    }

    setItems(items) {
      this.items = items || [];
      this._updateSpacer();
      for (const [idx, entry] of this._mounted) {
        if (this.onUnmount) this.onUnmount(entry.el, null, idx);
        entry.el.remove();
      }
      this._mounted.clear();
      this._scrollTop = 0;
      this.container.scrollTop = 0;
      this._render();
    }

    refresh() { this._render(); }
    scrollToIndex(idx) { this.container.scrollTop = Math.max(0, idx * this.itemHeight); }

    destroy() {
      this.container.removeEventListener('scroll', this._onScroll);
      if (this._ro) this._ro.disconnect();
      if (this._rafId) cancelAnimationFrame(this._rafId);
      for (const [idx, entry] of this._mounted) {
        if (this.onUnmount) this.onUnmount(entry.el, null, idx);
        entry.el.remove();
      }
      this._mounted.clear();
      this.container.classList.remove('gt-vlist');
      this.container.innerHTML = '';
    }
  }

  global.GTVirtualList = GTVirtualList;
})(window);
