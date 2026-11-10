# Copy as Markdown for OpenClaw (unofficial)

A small Chrome / Edge / Brave extension. Select part of a message in the
[OpenClaw](https://github.com/openclaw/openclaw) Control UI, click the button
that appears, and paste clean Markdown into Discord (or anywhere else).

Not affiliated with or endorsed by the OpenClaw project.

## Why it exists

OpenClaw's chat view replaces the browser's right-click menu with its own, so
general "copy as Markdown" extensions can never show their menu item there.
OpenClaw's own menu offers "Copy selection" (plain text) and "Copy as markdown"
(the whole message), but not "this part, as Markdown".

## What you get

- Select text in a message and a **Copy as Markdown** button appears under it.
- Right-click on the selection opens the browser menu with *Copy selection as
  Markdown* (Shift + right-click still gives OpenClaw's own menu).
- A keyboard shortcut (Alt+Shift+C by default).
- Output tuned for Discord by default:
  - tables become bullet lists (Discord has no tables),
  - `####` and deeper headings become bold lines,
  - code blocks keep their language, without the label or copy buttons,
  - links into the gateway itself become plain text,
  - a warning when the copy is over Discord's 2,000-character limit.
- Selecting inside one paragraph copies just the words; selecting across blocks
  keeps lists, numbering and quotes. Dragging across several messages copies
  only message text, not names, timestamps or buttons.
- Standard GitHub-flavoured Markdown output is one option away.

## Install (from source)

1. Download the [latest zip](https://github.com/BadgerLove/openclaw-copy-markdown/archive/refs/heads/main.zip)
   and unzip it somewhere permanent.
2. Open `chrome://extensions`, switch on **Developer mode** (top right), click
   **Load unpacked** and choose the `extension` folder.
3. Open your OpenClaw page, click the puzzle-piece icon at the top right of the
   browser, choose **Copy as Markdown for OpenClaw**, then **Enable on this
   site** and allow the prompt.

Repeat step 3 for each OpenClaw address you use.

## Permissions and privacy

The extension has **no access to any site until you enable it there**, and then
only on that site. It makes no network requests and collects nothing; see
[PRIVACY.md](PRIVACY.md).

| Permission | Why |
| --- | --- |
| Site access you grant per site | read the text you select on your OpenClaw page |
| `scripting` | run the extension's script on the sites you enabled |
| `activeTab` | let the popup check whether the current page is OpenClaw |
| `contextMenus` | the right-click menu item |
| `clipboardWrite` | put the Markdown on the clipboard |
| `storage` | remember your options |

## Options

Open the popup and click *Options and enabled sites*: Discord or standard
Markdown, how tables are converted, right-click behaviour, the button, Ctrl+C
copies Markdown, wrap links in `<>` (no Discord previews), length warning.

## How it works

`extension/md.js` walks the live DOM under the selection instead of cloning it,
so it can ask the page what is actually visible and selectable. That is how it
leaves out chat chrome without depending on OpenClaw's class names. The only
class-name dependencies are the code-block wrapper elements.

`extension/content.js` stops OpenClaw's `contextmenu` handler from seeing a
right-click on selected text, which lets the browser's own menu open.

## Development

- `node test/run.js` runs the converter tests (needs `linkedom`; set
  `LINKEDOM=/path/to/linkedom`, or it uses the copy inside a global OpenClaw
  install).
- `sh test/browser/run.sh` loads the extension in current Chromium inside a
  Playwright container and checks the whole path: nothing runs before a site is
  enabled, copy, clipboard contents, right-click, the button, popup and options.
- `node tools/make-icons.js` regenerates the icons.

Known gaps: the browser's permission prompt itself is not clicked by the
automated test, and the test stops at the Control UI login screen.

## Licence

MIT. The icon is drawn after the Markdown mark by Dustin Curtis (public domain, CC0).
