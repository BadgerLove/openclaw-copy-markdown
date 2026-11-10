/*
 * Copy as Markdown for OpenClaw - content script.
 *
 * Only ever injected into sites the user has enabled (see background.js), so
 * there is no page sniffing here: if this runs, the user asked for it.
 */
(() => {
  'use strict';
  if (window.__ocCopyMarkdown) return; // injected twice (enable + reload race)
  window.__ocCopyMarkdown = true;

  const DEFAULTS = {
    flavor: 'discord',
    tables: 'auto',
    wrapLinks: false,
    nativeMenu: 'selection', // 'selection' | 'shift' | 'off'
    ctrlC: false,
    pill: true, // floating button next to the selection
    limit: 2000,
  };
  let opts = Object.assign({}, DEFAULTS);
  let writing = false;

  chrome.storage.sync.get(DEFAULTS).then(
    (v) => {
      opts = Object.assign({}, DEFAULTS, v);
    },
    () => {},
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(changes)) if (k in DEFAULTS) opts[k] = changes[k].newValue ?? DEFAULTS[k];
  });

  // ---- selection -> markdown ----------------------------------------------

  function selectionMarkdown() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
    const ranges = [];
    for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i));
    return OCMarkdown.convert(ranges, opts, {
      getStyle: (el) => getComputedStyle(el),
      origin: location.origin,
    });
  }

  // execCommand works on plain-http LAN addresses where navigator.clipboard
  // does not exist, and it leaves the visible selection untouched.
  async function writeClipboard(text) {
    let ok = false;
    const onCopy = (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
      ok = true;
    };
    writing = true;
    document.addEventListener('copy', onCopy, true);
    try {
      document.execCommand('copy');
    } catch (_) {
      /* fall through to the async API */
    } finally {
      document.removeEventListener('copy', onCopy, true);
      writing = false;
    }
    if (ok) return true;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      return false;
    }
  }

  function describe(md) {
    const n = md.length;
    const count = n.toLocaleString() + ' chars';
    if (opts.limit && n > opts.limit) {
      return {
        text: `Copied as Markdown · ${count} (over Discord's ${Number(opts.limit).toLocaleString()} limit)`,
        kind: 'warn',
      };
    }
    return { text: `Copied as Markdown · ${count}`, kind: 'ok' };
  }

  async function copySelection() {
    let md = '';
    try {
      md = selectionMarkdown();
    } catch (err) {
      console.error('[OpenClaw Copy as Markdown]', err);
      toast('Could not convert the selection (see console)', 'error');
      return { ok: false, reason: 'convert-failed' };
    }
    if (!md) {
      toast('Select some text first', 'error');
      return { ok: false, reason: 'no-selection' };
    }
    if (!(await writeClipboard(md))) {
      toast('Clipboard write was blocked', 'error');
      return { ok: false, reason: 'clipboard-blocked' };
    }
    const d = describe(md);
    toast(d.text, d.kind);
    return { ok: true, chars: md.length };
  }

  // ---- triggers -----------------------------------------------------------

  // Toolbar button, keyboard shortcut and context-menu item all arrive here.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'oc-copy-md') return undefined;
    copySelection().then(sendResponse);
    return true;
  });

  function pointInSelection(e) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    if (e.target instanceof Node && sel.containsNode(e.target, false)) return true;
    const pad = 3;
    for (let i = 0; i < sel.rangeCount; i++) {
      for (const r of sel.getRangeAt(i).getClientRects()) {
        if (
          e.clientX >= r.left - pad &&
          e.clientX <= r.right + pad &&
          e.clientY >= r.top - pad &&
          e.clientY <= r.bottom + pad
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // OpenClaw replaces the browser's right-click menu with its own, which is
  // why extension menu items never appear. Stopping the event here (before the
  // app sees it, without cancelling it) lets the browser menu open instead.
  //
  // macOS selects the word under the pointer on right-click, so "was the click
  // on a selection" has to be answered at mousedown, before that happens.
  let rightDown = null;
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button === 2) rightDown = { t: e.timeStamp, inSelection: pointInSelection(e) };
    },
    true,
  );
  window.addEventListener(
    'contextmenu',
    (e) => {
      const mode = opts.nativeMenu;
      const down = rightDown && e.timeStamp - rightDown.t < 1500 ? rightDown : null;
      rightDown = null;
      if (mode === 'off') return;
      const onSelection = () => (down ? down.inSelection : pointInSelection(e));
      const wantNative = mode === 'shift' ? e.shiftKey : !e.shiftKey && onSelection();
      if (wantNative) e.stopImmediatePropagation();
    },
    true,
  );

  // Optional: make plain Ctrl+C / Cmd+C copy Markdown.
  window.addEventListener(
    'copy',
    (e) => {
      if (writing || !opts.ctrlC || !e.clipboardData) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      let md = '';
      try {
        md = selectionMarkdown();
      } catch (_) {
        return; // let the normal copy happen
      }
      if (!md) return;
      e.clipboardData.setData('text/plain', md);
      e.preventDefault();
      e.stopImmediatePropagation();
      const d = describe(md);
      toast(d.text, d.kind);
    },
    true,
  );

  // ---- floating button next to the selection --------------------------------
  // The obvious way in: select text, click the button. Does not depend on any
  // menu or shortcut.

  let pill = null;
  function hidePill() {
    if (pill) pill.style.display = 'none';
  }
  function ensurePill() {
    if (pill) return pill;
    pill = document.createElement('button');
    pill.type = 'button';
    pill.textContent = 'Copy as Markdown';
    pill.title = 'Copy the selected text as Markdown';
    pill.style.cssText = [
      'position:fixed',
      'display:none',
      'z-index:2147483646',
      'margin:0',
      'padding:5px 11px',
      'border:1px solid rgba(255,255,255,.18)',
      'border-radius:999px',
      'background:#1f2328',
      'color:#fff',
      'font:600 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif',
      'cursor:pointer',
      'box-shadow:0 4px 16px rgba(0,0,0,.35)',
      'user-select:none',
      '-webkit-user-select:none',
      'white-space:nowrap',
    ].join(';');
    // Keep the selection alive while the button is pressed.
    for (const type of ['mousedown', 'pointerdown', 'mouseup', 'pointerup']) {
      pill.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copySelection().then(hidePill);
    });
    return pill;
  }
  function showPill() {
    if (!opts.pill) return hidePill();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return hidePill();
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return hidePill();
    const rects = Array.from(sel.getRangeAt(sel.rangeCount - 1).getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return hidePill();
    const last = rects[rects.length - 1];
    const el = ensurePill();
    if (!el.isConnected) document.documentElement.appendChild(el);
    el.style.display = 'block';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = last.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, last.top - h - 8);
    const left = Math.min(Math.max(8, last.right - w / 2), window.innerWidth - w - 8);
    el.style.top = Math.round(top) + 'px';
    el.style.left = Math.round(left) + 'px';
    return undefined;
  }
  document.addEventListener(
    'mouseup',
    (e) => {
      if (pill && e.target === pill) return;
      setTimeout(showPill, 30);
    },
    true,
  );
  document.addEventListener(
    'keyup',
    (e) => {
      if (e.shiftKey || e.key === 'Shift') setTimeout(showPill, 30);
    },
    true,
  );
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hidePill();
  });
  window.addEventListener('scroll', hidePill, true);
  window.addEventListener('resize', hidePill);

  // ---- toast --------------------------------------------------------------

  let toastEl = null;
  let toastTimer = 0;
  function toast(text, kind) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute('role', 'status');
      toastEl.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:32px',
        'transform:translateX(-50%)',
        'z-index:2147483647',
        'max-width:min(90vw,560px)',
        'padding:9px 14px',
        'border-radius:9px',
        'font:500 13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif',
        'color:#fff',
        'box-shadow:0 6px 24px rgba(0,0,0,.35)',
        'pointer-events:none',
        'transition:opacity .18s ease',
        'opacity:0',
      ].join(';');
    }
    toastEl.style.background = kind === 'error' ? '#b42318' : kind === 'warn' ? '#b54708' : '#1f2328';
    toastEl.textContent = text;
    if (!toastEl.isConnected) document.documentElement.appendChild(toastEl);
    requestAnimationFrame(() => {
      toastEl.style.opacity = '1';
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        toastEl.style.opacity = '0';
        toastTimer = setTimeout(() => toastEl.remove(), 220);
      },
      kind === 'ok' ? 1800 : 4200,
    );
  }

  // First few page loads: say so, so it is obvious the extension is running here.
  chrome.storage.local.get({ readyShown: 0 }).then(
    ({ readyShown }) => {
      if (readyShown >= 5) return;
      chrome.storage.local.set({ readyShown: readyShown + 1 });
      setTimeout(() => toast('Copy as Markdown is on for this site: select text, then click the button that appears', 'info'), 1200);
    },
    () => {},
  );
})();
