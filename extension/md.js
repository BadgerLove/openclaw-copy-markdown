/*
 * OpenClaw Copy as Markdown - selection -> Markdown converter.
 *
 * Walks the LIVE DOM under a Range (instead of cloning it) so it can ask the
 * page what is actually visible/selectable. That is what keeps avatars,
 * timestamps, buttons and code-block chrome out of the output without having
 * to know OpenClaw's class names.
 *
 * No dependencies. Exposes globalThis.OCMarkdown (and module.exports in Node).
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    flavor: 'discord', // 'discord' | 'gfm'
    tables: 'auto', // 'auto' | 'bullets' | 'code' | 'gfm'
    wrapLinks: false, // wrap URLs in <> so Discord does not embed them
  };

  const BLOCK = new Set(
    (
      'ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DETAILS DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM ' +
      'H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION SUMMARY TABLE TBODY TD TFOOT TH THEAD TR UL'
    ).split(' '),
  );
  const SKIP = new Set(
    'SCRIPT STYLE NOSCRIPT TEMPLATE BUTTON SVG CANVAS VIDEO AUDIO IFRAME SELECT TEXTAREA DIALOG OBJECT EMBED HEAD'.split(
      ' ',
    ),
  );
  // UI chrome the OpenClaw markdown renderer adds around real content.
  const SKIP_CLASS = [
    'sr-only',
    'code-block-header',
    'code-block-expand',
    'code-block-json-tree',
    'code-block-json-modes',
    'markdown-table__actions',
  ];

  const T = (el) => (el.tagName || '').toUpperCase();
  const isWord = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch);
  const flat = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);

  function create(options, env) {
    const o = Object.assign({}, DEFAULTS, options || {});
    env = env || {};
    const discord = o.flavor !== 'gfm';
    const tableMode = o.tables && o.tables !== 'auto' ? o.tables : discord ? 'bullets' : 'gfm';
    const getStyle = env.getStyle || (() => null);
    const origin = env.origin || '';
    const blockCache = new WeakMap();
    const selectCache = new WeakMap();
    let R = null; // active Range, or null for "everything"

    const hit = (n) => !R || R.intersectsNode(n);
    function unranged(fn) {
      const saved = R;
      R = null;
      try {
        return fn();
      } finally {
        R = saved;
      }
    }
    const withCtx = (c, extra) => Object.assign({}, c, extra);

    // ---- what counts as content -------------------------------------------

    function isBlockish(el) {
      if (BLOCK.has(T(el))) return true;
      if (blockCache.has(el)) return blockCache.get(el);
      let v = false;
      for (let ch = el.firstElementChild; ch; ch = ch.nextElementSibling) {
        if (isBlockish(ch)) {
          v = true;
          break;
        }
      }
      blockCache.set(el, v);
      return v;
    }

    function displayNone(el) {
      const st = getStyle(el);
      return !!st && st.display === 'none';
    }

    // Used value of user-select: "auto" defers to the parent.
    function selectable(el) {
      if (!el) return true;
      if (selectCache.has(el)) return selectCache.get(el);
      const st = getStyle(el);
      const v = (st && (st.userSelect || st.webkitUserSelect)) || 'auto';
      const res = v === 'none' ? false : v === 'auto' ? selectable(el.parentElement) : true;
      selectCache.set(el, res);
      return res;
    }

    function skipEl(el) {
      const tag = T(el);
      if (SKIP.has(tag)) return true;
      if (tag === 'INPUT') return (el.getAttribute('type') || '').toLowerCase() !== 'checkbox';
      if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
      const cl = el.classList;
      if (cl) for (const name of SKIP_CLASS) if (cl.contains(name)) return true;
      return displayNone(el);
    }

    function sameOrigin(url) {
      return !!origin && (url === origin || url.startsWith(origin + '/'));
    }

    // ---- escaping ---------------------------------------------------------

    function escPlain(s) {
      s = s
        .replace(/\\/g, '\\\\')
        .replace(/[*`]/g, '\\$&')
        .replace(/_/g, (m, i, str) => (isWord(str[i - 1]) && isWord(str[i + 1]) ? '_' : '\\_'))
        .replace(/~~/g, '\\~\\~');
      // GFM: every "<" is escaped (not just tag-like ones) because a tag can be
      // split across text nodes, where a lookahead would miss it.
      return discord ? s.replace(/\|\|/g, '\\|\\|') : s.replace(/</g, '\\<');
    }

    // Leave bare URLs alone: escaping inside them breaks auto-linking.
    function esc(s) {
      if (s.indexOf('http') === -1) return escPlain(s);
      return s
        .split(/(https?:\/\/[^\s<>]+)/)
        .map((part, i) => (i % 2 ? part : escPlain(part)))
        .join('');
    }

    // Literal text that would otherwise be read as a heading/list/quote marker.
    function escLineStarts(s) {
      return s
        .split('\n')
        .map((l) =>
          l
            .replace(/^(\s*)(#{1,6}\s)/, '$1\\$2')
            .replace(/^(\s*)>/, '$1\\>')
            .replace(/^(\s*)([-+])(\s|#\s)/, '$1\\$2$3')
            .replace(/^(\s*)(\d+)([.)]\s)/, '$1$2\\$3')
            .replace(/^(\s*)(-{3,}|={3,})\s*$/, '$1\\$2'),
        )
        .join('\n');
    }

    function para(s, raw) {
      s = s
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
      if (!s || raw) return s;
      s = escLineStarts(s);
      return discord ? s : s.replace(/\n/g, '  \n');
    }

    const oneLine = (s) => s.replace(/\s*\n\s*/g, ' ');
    const unbold = (s) => s.replace(/\*\*/g, '');

    // ---- inline -----------------------------------------------------------

    function textOf(node, c) {
      if (!c.force && !selectable(node.parentElement)) return '';
      let s = node.data || '';
      if (R) {
        let a = 0;
        let b = s.length;
        if (node === R.endContainer) b = Math.min(b, R.endOffset);
        if (node === R.startContainer) a = Math.min(R.startOffset, b);
        if (a > 0 || b < s.length) s = s.slice(a, b);
      }
      return s;
    }

    function glue(out, piece, c) {
      if (!c.pre && !c.code && piece[0] === ' ' && /[ \n]$/.test(out)) piece = piece.replace(/^ +/, '');
      return out + piece;
    }

    function kids(node, c) {
      let out = '';
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        let piece = inl(ch, c);
        if (!piece) continue;
        if (!c.pre && ch.nodeType === 1 && T(ch) !== 'BR' && isBlockish(ch)) piece = '\n' + piece + '\n';
        out = glue(out, piece, c);
      }
      return out;
    }

    function wrap(mark, node, key, c) {
      if (c[key]) return kids(node, c);
      const inner = kids(node, withCtx(c, { [key]: true }));
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
      return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner;
    }

    function inlineCode(text) {
      text = text.replace(/\n/g, ' ');
      let body = text.trim();
      if (!body) return text;
      const lead = /^\s*/.exec(text)[0];
      const trail = /\s*$/.exec(text)[0];
      const longest = Math.max(0, ...(body.match(/`+/g) || []).map((s) => s.length));
      const f = '`'.repeat(longest + 1);
      if (longest) body = ' ' + body + ' ';
      return lead + f + body + f + trail;
    }

    function absolute(el, attr) {
      let v = (el.getAttribute(attr) || '').trim();
      try {
        if (typeof el[attr] === 'string' && el[attr]) v = el[attr];
      } catch (_) {
        /* keep attribute value */
      }
      return v;
    }

    function link(a, c) {
      const label = kids(a, withCtx(c, { link: true })).trim();
      if (!label || c.link) return label;
      const url = absolute(a, 'href');
      // In-app links (files, sessions) mean nothing outside this gateway.
      if (!/^(https?:\/\/|mailto:)/i.test(url) || sameOrigin(url)) return label;
      const plain = kids(a, withCtx(c, { code: true, link: true })).trim();
      const bare = o.wrapLinks ? '<' + url + '>' : url;
      const strip = (u) => u.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      if (strip(plain) === strip(url)) return bare;
      // Discord refuses masked links whose label is itself a URL.
      if (discord && /^(https?:\/\/|www\.)\S+$/i.test(plain)) return bare;
      const target = url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
      return '[' + oneLine(label).replace(/([[\]])/g, '\\$1') + '](' + (o.wrapLinks ? '<' + target + '>' : target) + ')';
    }

    function image(img, c) {
      if (img.getAttribute('role') === 'presentation') return '';
      if (!c.force && !selectable(img)) return '';
      const alt = (img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
      if (/\bemoji\b/i.test(img.getAttribute('class') || '')) return alt;
      const src = absolute(img, 'src');
      const external = /^https?:\/\//i.test(src) && !sameOrigin(src);
      if (!external) return alt ? '[image: ' + esc(alt) + ']' : '';
      const label = esc(alt).replace(/([[\]])/g, '\\$1');
      if (discord) return alt ? '[' + label + '](' + src + ')' : src;
      return '![' + label + '](' + src + ')';
    }

    function isChecked(el) {
      return el.checked === true || (el.checked === undefined && el.hasAttribute('checked'));
    }

    function inl(node, c) {
      if (node.nodeType === 3) {
        if (!hit(node)) return '';
        const s = textOf(node, c);
        if (c.pre) return s;
        const t = s.replace(/\s+/g, ' ');
        return c.code ? t : esc(t);
      }
      if (node.nodeType !== 1 || !hit(node) || skipEl(node)) return '';
      const tag = T(node);
      if (tag === 'BR') return '\n';
      if (c.pre || c.code) return kids(node, c);
      switch (tag) {
        case 'IMG':
          return image(node, c);
        case 'INPUT':
          return isChecked(node) ? '[x] ' : '[ ] ';
        case 'STRONG':
        case 'B':
          return wrap('**', node, 'bold', c);
        case 'EM':
        case 'I':
          return wrap('*', node, 'em', c);
        case 'DEL':
        case 'S':
        case 'STRIKE':
          return wrap('~~', node, 'strike', c);
        case 'U':
        case 'INS':
          return discord ? wrap('__', node, 'under', c) : kids(node, c);
        case 'CODE':
        case 'KBD':
        case 'SAMP':
        case 'TT':
          return inlineCode(kids(node, withCtx(c, { code: true })));
        case 'A':
          return link(node, c);
        default:
          return kids(node, c);
      }
    }

    // ---- blocks -----------------------------------------------------------

    function blocks(parent, c) {
      const out = [];
      let run = '';
      const flush = () => {
        const t = para(run);
        run = '';
        if (t) out.push(t);
      };
      for (let ch = parent.firstChild; ch; ch = ch.nextSibling) {
        if (ch.nodeType === 1) {
          if (!hit(ch) || skipEl(ch)) continue;
          if (T(ch) === 'SUMMARY' && T(parent) === 'DETAILS') continue;
          if (T(ch) !== 'BR' && isBlockish(ch)) {
            flush();
            out.push(...flat(block(ch, c)));
            continue;
          }
        }
        const piece = inl(ch, c);
        if (piece) run = glue(run, piece, c);
      }
      flush();
      return out;
    }

    function heading(el, level, c) {
      const small = discord && level > 3; // Discord only renders #, ##, ###
      const text = oneLine(para(kids(el, small ? withCtx(c, { bold: true }) : c)));
      if (!text) return '';
      return small ? '**' + text + '**' : '#'.repeat(level) + ' ' + text;
    }

    function listItem(li, c) {
      const parts = blocks(li, c);
      if (!parts.length) return '';
      const loose = !discord && parts.slice(1).some((p) => !/^\s*([-*+]|\d+\.)\s/.test(p));
      return parts.join(loose ? '\n\n' : '\n');
    }

    function list(el, c) {
      const ordered = T(el) === 'OL';
      let n = parseInt(el.getAttribute('start'), 10);
      if (!Number.isFinite(n)) n = 1;
      const items = [];
      for (let li = el.firstElementChild; li; li = li.nextElementSibling) {
        if (T(li) !== 'LI') continue;
        const num = n++; // keep the real number even when earlier items are not selected
        if (!hit(li) || skipEl(li)) continue;
        const body = listItem(li, c);
        if (!body) continue;
        const marker = ordered ? num + '. ' : '- ';
        items.push(marker + body.replace(/\n(?=[^\n])/g, '\n' + ' '.repeat(marker.length)));
      }
      return items.join('\n');
    }

    function langOf(pre) {
      const code = pre.querySelector('code');
      const cls = (code || pre).getAttribute('class') || '';
      const m = /(?:^|\s)lang(?:uage)?-(\S+)/.exec(cls);
      return m ? m[1] : '';
    }

    function preText(pre, c) {
      return kids(pre, withCtx(c, { pre: true }))
        .replace(/\r/g, '')
        .replace(/^\n+/, '')
        .replace(/\s+$/, '');
    }

    function fence(text, lang) {
      const longest = Math.max(2, ...(text.match(/`+/g) || []).map((s) => s.length));
      const f = '`'.repeat(longest + 1);
      return f + (lang || '') + '\n' + text + '\n' + f;
    }

    function codeBlock(pre, c) {
      const t = preText(pre, c);
      return t.trim() ? fence(t, langOf(pre)) : '';
    }

    // OpenClaw wraps <pre> in header/viewport chrome; JSON blocks can show a
    // tree view with the raw <pre> hidden. Either way the <pre> is the source.
    function codeWrapper(el, c) {
      const pre = el.querySelector('pre');
      if (!pre) return blocks(el, c);
      for (let e = pre; e && e !== el; e = e.parentElement) {
        if (displayNone(e)) return unranged(() => codeBlock(pre, c));
      }
      return hit(pre) ? codeBlock(pre, c) : '';
    }

    function quote(el, c) {
      const inner = blocks(el, c).join('\n\n');
      if (!inner) return '';
      return inner
        .split('\n')
        .map((l) => (l ? '> ' + l : discord ? '> ' : '>'))
        .join('\n');
    }

    function details(el, c) {
      const out = [];
      let summary = null;
      for (let ch = el.firstElementChild; ch; ch = ch.nextElementSibling) {
        if (T(ch) === 'SUMMARY') {
          summary = ch;
          break;
        }
      }
      if (summary && hit(summary) && !skipEl(summary)) {
        const s = oneLine(para(kids(summary, withCtx(c, { bold: true, force: true }))));
        if (s) out.push('**' + s + '**');
      }
      const open = el.open === true || (el.open === undefined && el.hasAttribute('open'));
      if (open) out.push(...blocks(el, c)); // closed = the reader could not see it either
      return out;
    }

    function bulletRow(r, head) {
      const first = r[0] || '';
      const rest = [];
      for (let i = 1; i < r.length; i++) {
        if (!r[i]) continue;
        const label = head && head[i] && r.length > 2 ? unbold(head[i]) + ': ' : '';
        rest.push(label + r[i]);
      }
      if (!rest.length) return '- ' + first;
      if (!first) return '- ' + rest.join(' · ');
      return '- **' + unbold(first) + '**' + (r.length === 2 ? ': ' : ' — ') + rest.join(' · ');
    }

    function table(el, c) {
      const rows = Array.from(el.querySelectorAll('tr')).filter((tr) => tr.closest('table') === el);
      if (!rows.length) return '';
      const raw = tableMode === 'code';
      const cellCtx = raw ? withCtx(c, { code: true }) : c;
      // Rows are all-or-nothing: half a row is not a useful thing to paste.
      const cells = (tr) =>
        unranged(() =>
          Array.from(tr.children)
            .filter((x) => /^T[DH]$/.test(T(x)))
            .map((cell) => oneLine(para(kids(cell, cellCtx), raw))),
        );
      const touched = (tr) => hit(tr) && !skipEl(tr) && (!R || kids(tr, withCtx(c, { code: true })).trim() !== '');
      const headTr = rows.find((tr) => tr.querySelector('th') && !tr.querySelector('td')) || null;
      const head = headTr ? cells(headTr) : null;
      const body = rows
        .filter((tr) => tr !== headTr && touched(tr))
        .map(cells)
        .filter((r) => r.some(Boolean));
      if (!body.length) return head && touched(headTr) ? head.filter(Boolean).join(' | ') : '';

      const width = Math.max(head ? head.length : 0, ...body.map((r) => r.length));
      const pad = (r) => r.concat(Array(Math.max(0, width - r.length)).fill(''));

      if (tableMode === 'gfm') {
        const h = head || body[0];
        const rest = head ? body : body.slice(1);
        const line = (r) =>
          '| ' +
          pad(r)
            .map((x) => x.replace(/\|/g, '\\|'))
            .join(' | ') +
          ' |';
        return [line(h), '| ' + Array(width).fill('---').join(' | ') + ' |', ...rest.map(line)].join('\n');
      }

      if (tableMode === 'code') {
        const all = (head ? [head] : []).concat(body).map(pad);
        const w = Array.from({ length: width }, (_, i) => Math.max(...all.map((r) => r[i].length)));
        const lines = all.map((r) =>
          r
            .map((x, i) => x.padEnd(w[i]))
            .join(' | ')
            .replace(/\s+$/, ''),
        );
        if (head) lines.splice(1, 0, w.map((n) => '-'.repeat(n)).join('-+-'));
        return fence(lines.join('\n'), '');
      }

      return body.map((r) => bulletRow(r, head)).join('\n');
    }

    function block(el, c) {
      const tag = T(el);
      switch (tag) {
        case 'P':
          return para(kids(el, c));
        case 'H1':
        case 'H2':
        case 'H3':
        case 'H4':
        case 'H5':
        case 'H6':
          return heading(el, Number(tag[1]), c);
        case 'UL':
        case 'OL':
          return list(el, c);
        case 'LI':
          return listItem(el, c);
        case 'PRE':
          return codeBlock(el, c);
        case 'BLOCKQUOTE':
          return quote(el, c);
        case 'HR':
          return discord ? '' : '---'; // Discord prints --- literally
        case 'TABLE':
          return table(el, c);
        case 'DETAILS':
          return details(el, c);
        default:
          if (el.classList && el.classList.contains('code-block-wrapper')) return codeWrapper(el, c);
          return blocks(el, c);
      }
    }

    // ---- entry points -----------------------------------------------------

    function blockInRange(root) {
      for (let ch = root.firstElementChild; ch; ch = ch.nextElementSibling) {
        if (!hit(ch) || skipEl(ch)) continue;
        if (BLOCK.has(T(ch)) || blockInRange(ch)) return true;
      }
      return false;
    }

    function fromRange(range) {
      R = range;
      try {
        let root = range.commonAncestorContainer;
        if (root && root.nodeType !== 1) root = root.parentElement;
        if (!root) return '';

        // Selection entirely inside a code block.
        const pre = root.closest('pre');
        if (pre) {
          const t = preText(pre, {});
          if (!t.trim()) return '';
          const full = unranged(() => preText(pre, {}));
          return t.includes('\n') || t.trim() === full.trim() ? fence(t, langOf(pre)) : inlineCode(t.trim());
        }

        // Climb out of inline wrappers so bold/links/inline code keep their markup.
        while (root.parentElement && !isBlockish(root)) root = root.parentElement;

        // Selection inside one paragraph/heading/list item/cell: just the words.
        if (!blockInRange(root)) return para(kids(root, {}));

        let tag = T(root);
        if (/^(TR|TBODY|THEAD|TFOOT)$/.test(tag)) {
          const t = root.closest('table');
          if (t) {
            root = t;
            tag = 'TABLE';
          }
        }
        const res = /^(UL|OL|TABLE|BLOCKQUOTE|DETAILS|LI)$/.test(tag) ? block(root, {}) : blocks(root, {});
        return flat(res).join('\n\n');
      } finally {
        R = null;
      }
    }

    function fromNode(node) {
      R = null;
      return flat(BLOCK.has(T(node)) ? block(node, {}) : blocks(node, {})).join('\n\n');
    }

    return { fromRange, fromNode };
  }

  const clean = (s) => s.replace(/^\n+/, '').replace(/\s+$/, '');

  /** Convert one or more DOM Ranges (a Selection's ranges) to Markdown. */
  function convert(ranges, options, env) {
    const cv = create(options, env);
    const parts = [];
    for (const r of ranges) {
      const s = clean(cv.fromRange(r));
      if (s) parts.push(s);
    }
    return parts.join('\n\n');
  }

  /** Convert a whole element to Markdown. */
  function convertNode(node, options, env) {
    return clean(create(options, env).fromNode(node));
  }

  const api = { convert, convertNode, DEFAULTS };
  global.OCMarkdown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
