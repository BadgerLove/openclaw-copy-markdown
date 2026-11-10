/*
 * Converter tests. Run: node test/run.js
 *
 * Uses linkedom (borrowed from the OpenClaw install) for a DOM. linkedom has no
 * Range.intersectsNode, so tests build a minimal Range with a spec-faithful
 * implementation; the converter code path is the same one the browser runs.
 * Fixtures mirror the HTML OpenClaw's markdown renderer emits (markdown-it
 * output plus its code-block / table wrappers).
 */
'use strict';
const path = require('path');
const { parseHTML } = require(process.env.LINKEDOM || '/usr/lib/node_modules/openclaw/node_modules/linkedom');
const { convert, convertNode } = require(path.join(__dirname, '..', 'extension', 'md.js'));

// ---- minimal Range -------------------------------------------------------

function indexOf(node) {
  let i = 0;
  for (let n = node.previousSibling; n; n = n.previousSibling) i++;
  return i;
}
// Position of boundary point A relative to B: -1 before, 0 equal, 1 after.
// Compared as index paths from the root (linkedom's compareDocumentPosition is
// not reliable enough to build on); a prefix sorts before its extensions.
function pointPath(node, offset) {
  const p = [offset];
  for (let n = node; n.parentNode; n = n.parentNode) p.unshift(indexOf(n));
  return p;
}
function cmp(nA, oA, nB, oB) {
  const a = pointPath(nA, oA);
  const b = pointPath(nB, oB);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
function makeRange(sc, so, ec, eo) {
  const anc = new Set();
  for (let n = sc; n; n = n.parentNode) anc.add(n);
  let common = ec;
  while (!anc.has(common)) common = common.parentNode;
  return {
    startContainer: sc,
    startOffset: so,
    endContainer: ec,
    endOffset: eo,
    commonAncestorContainer: common,
    intersectsNode(node) {
      const p = node.parentNode;
      if (!p) return true;
      const i = indexOf(node);
      return cmp(p, i, ec, eo) < 0 && cmp(p, i + 1, sc, so) > 0;
    },
  };
}

// Fixture HTML marks the selection with « and ». Returns {document, range}.
function load(html) {
  const { document } = parseHTML('<!doctype html><html><body><div id="root">' + html + '</div></body></html>');
  const root = document.getElementById('root');
  const found = {};
  const walk = (node) => {
    for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
      if (ch.nodeType === 3) {
        for (const [mark, key] of [['«', 'start'], ['»', 'end']]) {
          const i = ch.data.indexOf(mark);
          if (i !== -1) {
            ch.data = ch.data.slice(0, i) + ch.data.slice(i + 1);
            found[key] = [ch, i];
          }
        }
      } else walk(ch);
    }
  };
  walk(root);
  const range = found.start && found.end ? makeRange(found.start[0], found.start[1], found.end[0], found.end[1]) : null;
  return { document, root, range };
}

// Stand-in for getComputedStyle: fixtures use data-us / data-display.
const env = {
  origin: 'https://gw.example',
  getStyle: (el) => ({
    userSelect: el.getAttribute('data-us') || 'auto',
    display: el.getAttribute('data-display') || 'block',
  }),
};

let failed = 0;
let passed = 0;
function check(name, got, want) {
  if (got === want) {
    passed++;
    return;
  }
  failed++;
  console.log('\nFAIL ' + name + '\n--- want\n' + want + '\n--- got\n' + got + '\n---');
}
const sel = (html, opts) => {
  const { range } = load(html);
  if (!range) throw new Error('fixture has no «» markers');
  return convert([range], opts, env);
};
const whole = (html, opts) => convertNode(load(html).root, opts, env);

// ---- fixtures ------------------------------------------------------------

const codeBlock = (lang, code) =>
  '<div class="code-block-wrapper"><div class="code-block-header" data-markdown-key="header">' +
  '<span class="code-block-lang">' + (lang || 'text') + '</span><div class="code-block-actions">' +
  '<button type="button" class="code-block-wrap"><span class="code-block-wrap__icon" aria-hidden="true"></span></button>' +
  '<button type="button" class="code-block-copy" data-code="x"><span class="code-block-copy__idle" aria-hidden="true"></span></button>' +
  '</div></div><div class="code-block-viewport" data-markdown-key="viewport"><pre><code' +
  (lang ? ' class="hljs language-' + lang + '"' : '') + '>' + code + '</code></pre></div></div>';

const MESSAGE =
  '<h2>Plan for <code>nginx</code></h2>\n' +
  '<p>Here is <strong>the fix</strong>, with <em>one</em> caveat and a <a href="https://example.com/docs">link</a>.<br>Second line.</p>\n' +
  '<ul>\n<li>First item</li>\n<li>Second with <code>code</code>\n<ul>\n<li>Nested a</li>\n<li>Nested b</li>\n</ul>\n</li>\n</ul>\n' +
  '<ol start="3">\n<li>Three</li>\n<li>Four</li>\n</ol>\n' +
  codeBlock('bash', '<span class="hljs-built_in">cd</span> /etc/nginx\nnginx -t\n') +
  '<blockquote>\n<p>Quoted line</p>\n<p>More quote</p>\n</blockquote>\n' +
  '<hr>\n' +
  '<h4>Small heading</h4>\n' +
  '<ul class="contains-task-list">\n<li class="task-list-item"><input class="task-list-item-checkbox" checked="" disabled="" type="checkbox">Done thing</li>\n' +
  '<li class="task-list-item"><input class="task-list-item-checkbox" disabled="" type="checkbox">Open thing</li>\n</ul>';

// ---- whole message -------------------------------------------------------

check(
  'whole message, discord',
  whole(MESSAGE),
  [
    '## Plan for `nginx`',
    'Here is **the fix**, with *one* caveat and a [link](https://example.com/docs).\nSecond line.',
    '- First item\n- Second with `code`\n  - Nested a\n  - Nested b',
    '3. Three\n4. Four',
    '```bash\ncd /etc/nginx\nnginx -t\n```',
    '> Quoted line\n> \n> More quote',
    '**Small heading**',
    '- [x] Done thing\n- [ ] Open thing',
  ].join('\n\n'),
);

check(
  'whole message, gfm',
  whole(MESSAGE, { flavor: 'gfm' }),
  [
    '## Plan for `nginx`',
    'Here is **the fix**, with *one* caveat and a [link](https://example.com/docs).  \nSecond line.',
    '- First item\n- Second with `code`\n  - Nested a\n  - Nested b',
    '3. Three\n4. Four',
    '```bash\ncd /etc/nginx\nnginx -t\n```',
    '> Quoted line\n>\n> More quote',
    '---',
    '#### Small heading',
    '- [x] Done thing\n- [ ] Open thing',
  ].join('\n\n'),
);

// ---- partial selections --------------------------------------------------

check('inside one paragraph', sel('<p>Alpha «beta <strong>gamma</strong> del»ta</p>'), 'beta **gamma** del');
check('inside bold keeps bold', sel('<p>Alpha <strong>be«ta ga»mma</strong> delta</p>'), '**ta ga**');
check('inside a heading drops the #', sel('<h2>Big «title» here</h2><p>x</p>'), 'title');
check('inside one list item drops the bullet', sel('<ul><li>one</li><li>t«w»o</li></ul>'), 'w');
check('inside inline code', sel('<p>run <code>sys«temctl sta»tus</code> now</p>'), '`temctl sta`');
check(
  'part of a link keeps the link',
  sel('<p>see <a href="https://example.com/a">the «docs» page</a></p>'),
  '[docs](https://example.com/a)',
);

check(
  'across paragraphs',
  sel('<p>First «para</p><h3>Head</h3><p>Third» para</p>'),
  'para\n\n### Head\n\nThird',
);

check(
  'ordered list keeps real numbers',
  sel('<ol><li>one</li><li>«two</li><li>three»</li><li>four</li></ol>'),
  '2. two\n3. three',
);

check(
  'list item with nested list',
  sel('<ul><li>«parent<ul><li>kid a</li><li>kid» b</li></ul></li><li>other</li></ul>'),
  'parent\n- kid a\n- kid',
);

// Triple-click selects up to offset 0 of the next block: no empty trailing item.
(() => {
  const { root, range: _ } = load('<ul><li>one</li><li>two</li><li>three</li></ul>');
  const lis = root.querySelectorAll('li');
  const r = makeRange(lis[1].firstChild, 0, lis[2], 0);
  check('triple-click list item', convert([r], {}, env), '- two');
  const { root: root2 } = load('<h2>Title</h2><p>Body text</p>');
  const r2 = makeRange(root2.querySelector('h2').firstChild, 0, root2.querySelector('p'), 0);
  check('triple-click heading', convert([r2], {}, env), '## Title');
})();

// ---- code blocks ---------------------------------------------------------

const CODE = codeBlock('js', 'const a = 1;\n<span class="hljs-keyword">const</span> b = `x`;\nreturn a + b;\n');
check('one line of a code block', sel(CODE.replace('const a = 1;', 'const «a = 1»;')), '`a = 1`');
check(
  'several lines of a code block',
  sel(CODE.replace('const a', '«const a').replace('b = `x`;', 'b = `x`;»')),
  '```js\nconst a = 1;\nconst b = `x`;\n```',
);
check(
  'code block chrome (lang label, buttons) is not copied',
  sel('<p>«Before</p>' + CODE + '<p>After»</p>'),
  'Before\n\n```js\nconst a = 1;\nconst b = `x`;\nreturn a + b;\n```\n\nAfter',
);
check(
  'fence grows past backticks in the code',
  whole('<pre><code>a\n```\nb</code></pre>'),
  '````\na\n```\nb\n````',
);
check(
  'whole one-line code block stays a block',
  sel(codeBlock('bash', '«docker ps»\n')),
  '```bash\ndocker ps\n```',
);
check(
  'json block with hidden raw view still yields the source',
  sel(
    '<p>«Result</p><div class="code-block-wrapper code-block-wrapper--json"><div class="code-block-header"><span class="code-block-lang">json</span></div>' +
      '<div class="code-block-json-tree"><details open><summary>{</summary><div>"a": 1</div></details></div>' +
      '<div class="code-block-viewport" data-display="none"><pre><code class="hljs language-json">{"a": 1}</code></pre></div></div><p>end»</p>',
  ),
  'Result\n\n```json\n{"a": 1}\n```\n\nend',
);

// ---- tables --------------------------------------------------------------

const TABLE =
  '<div class="markdown-table"><div class="markdown-table__actions"><button>Copy</button></div><div class="markdown-table__viewport"><table>' +
  '<thead><tr><th>Service</th><th>Port</th><th>Status</th></tr></thead>' +
  '<tbody><tr><td>plex</td><td>32400</td><td><strong>up</strong></td></tr>' +
  '<tr><td>sonarr</td><td>8989</td><td>down | flaky</td></tr>' +
  '<tr><td>radarr</td><td>7878</td><td>up</td></tr></tbody></table></div></div>';

check(
  'table -> bullets (discord default)',
  whole(TABLE),
  '- **plex** — Port: 32400 · Status: **up**\n- **sonarr** — Port: 8989 · Status: down | flaky\n- **radarr** — Port: 7878 · Status: up',
);
check(
  'table -> gfm',
  whole(TABLE, { flavor: 'gfm' }),
  '| Service | Port | Status |\n| --- | --- | --- |\n| plex | 32400 | **up** |\n| sonarr | 8989 | down \\| flaky |\n| radarr | 7878 | up |',
);
check(
  'table -> code block',
  whole(TABLE, { tables: 'code' }),
  '```\nService | Port  | Status\n--------+-------+-------------\nplex    | 32400 | up\nsonarr  | 8989  | down | flaky\nradarr  | 7878  | up\n```',
);
check(
  'two rows of a table keep header labels',
  sel(TABLE.replace('<td>sonarr', '<td>«sonarr').replace('7878</td>', '78»78</td>')),
  '- **sonarr** — Port: 8989 · Status: down | flaky\n- **radarr** — Port: 7878 · Status: up',
);
check('inside one table cell', sel(TABLE.replace('down | flaky', 'down | «flaky»')), 'flaky');
check(
  'two-column table',
  whole('<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody><tr><td>host</td><td>nas</td></tr></tbody></table>'),
  '- **host**: nas',
);

// ---- escaping ------------------------------------------------------------

check('literal asterisks and underscores', whole('<p>2 * 3 and _private and snake_case_name</p>'), '2 \\* 3 and \\_private and snake_case_name');
check('line-start markers', whole('<p># not a heading<br>- not a list<br>1. not numbered<br>&gt; not quote</p>'), '\\# not a heading\n\\- not a list\n1\\. not numbered\n\\> not quote');
check('urls are not escaped', whole('<p>see https://example.com/a_b_/_c*d ok</p>'), 'see https://example.com/a_b_/_c*d ok');
check('discord spoiler bars', whole('<p>a || b</p>'), 'a \\|\\| b');
check('gfm escapes html-ish text', whole('<p>use &lt;div&gt; here</p>', { flavor: 'gfm' }), 'use \\<div> here');
check('inline code with backticks', whole('<p><code>a`b</code></p>'), '`` a`b ``');
check('bold with inner spaces', whole('<p>x<strong> padded </strong>y</p>'), 'x **padded** y');

// ---- links & images ------------------------------------------------------

check('bare url link', whole('<p><a class="markdown-bare-url" href="https://example.com/x">https://example.com/x</a></p>'), 'https://example.com/x');
check('wrapLinks', whole('<p><a href="https://example.com/x">site</a> <a href="https://e.com/">https://e.com/</a></p>', { wrapLinks: true }), '[site](<https://example.com/x>) <https://e.com/>');
check('in-app link becomes text', whole('<p>open <a class="markdown-file-link" href="https://gw.example/files/a.md">a.md</a></p>'), 'open a.md');
check('relative link becomes text', whole('<p><a href="/sessions/1">session</a></p>'), 'session');
check('favicon is dropped', whole('<p><a href="https://example.com/"><img class="markdown-link-favicon" alt="" role="presentation">Example</a></p>'), '[Example](https://example.com/)');
check('url with parens', whole('<p><a href="https://en.wikipedia.org/wiki/A_(b)">wiki</a></p>'), '[wiki](https://en.wikipedia.org/wiki/A_%28b%29)');
check('external image, discord', whole('<p><img src="https://img.example/a.png" alt="chart"></p>'), '[chart](https://img.example/a.png)');
check('external image, gfm', whole('<p><img src="https://img.example/a.png" alt="chart"></p>', { flavor: 'gfm' }), '![chart](https://img.example/a.png)');
check('hex colour swatch', whole('<p>use <span class="markdown-hex-color"><img class="markdown-hex-color__swatch" src="data:image/svg+xml,x" alt="" aria-hidden="true">#ff0000</span></p>'), 'use #ff0000');

// ---- chat chrome ---------------------------------------------------------

// .chat-thread is user-select:none; only .chat-text re-enables it. A selection
// dragged across two messages must not pick up names, times or buttons.
check(
  'non-selectable chrome between messages is skipped',
  sel(
    '<div class="chat-thread" data-us="none">' +
      '<div class="chat-group"><div class="chat-avatar"><img src="https://gw.example/a.png" alt="Agent"></div><span class="chat-sender">Agent</span>' +
      '<div class="chat-bubble"><div class="chat-text" data-us="text"><p>First «message</p></div><div class="chat-actions"><button>Copy</button></div><time>12:01</time></div></div>' +
      '<div class="chat-group"><span class="chat-sender">Agent</span>' +
      '<div class="chat-bubble"><div class="chat-text" data-us="text"><p>Second» message</p></div></div></div></div>',
  ),
  'message\n\nSecond',
);

check(
  'details: open shows body, closed shows summary only',
  whole('<details open><summary data-us="none">Logs</summary><p>line one</p></details><details><summary>Hidden</summary><p>secret</p></details>'),
  '**Logs**\n\nline one\n\n**Hidden**',
);

check('display:none is skipped', whole('<p>shown</p><p data-display="none">hidden</p>'), 'shown');
check('nothing selected', sel('<p>ab«»cd</p>'), '');

// ---- result --------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
