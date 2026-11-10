# Chrome Web Store listing

Paste these into the Developer Dashboard (https://chrome.google.com/webstore/devconsole).

## Package

Upload `dist/copy-as-markdown-for-openclaw-<version>-webstore.zip`
(built by `tools/package.sh`; manifest.json is at the top level of that zip).

## Store listing

**Name** (from the manifest): Copy as Markdown for OpenClaw (unofficial)

**Summary** (132 characters max):
Copy selected text from the OpenClaw Control UI as clean Markdown, ready to paste into Discord.

**Category:** Productivity → Workflow & Planning (or Developer Tools)

**Language:** English

**Description:**

Select part of a message in the OpenClaw Control UI, click the button that appears, and paste clean Markdown into Discord or anywhere else.

OpenClaw's chat view replaces the browser's right-click menu with its own, so general "copy as Markdown" extensions cannot show their menu item there. This extension is built for that page.

• Select text and a "Copy as Markdown" button appears under it
• Right-click the selection for "Copy selection as Markdown"
• Keyboard shortcut (Alt+Shift+C by default)
• Discord-ready output: tables become bullet lists, deep headings become bold, code blocks keep their language
• Warns when the copy is over Discord's 2,000-character limit
• Copies only message text when you drag across several messages, not names, timestamps or buttons
• Standard GitHub-flavoured Markdown is available in the options

Privacy: the extension has no access to any site until you enable it for your OpenClaw address, and it only runs there. It makes no network requests and collects nothing.

Unofficial. Not affiliated with or endorsed by the OpenClaw project. Open source (MIT): https://github.com/BadgerLove/openclaw-copy-markdown

**Screenshots:** at least one, 1280x800 or 640x400. Suggested: (1) text selected in a
message with the button showing, (2) the same text pasted into Discord, (3) the options page.
Use a conversation with nothing private in it.

**Icon:** `extension/icons/icon-128.png`

## Privacy tab

**Single purpose:**
Copy text the user selects on their OpenClaw page to the clipboard as Markdown.

**Permission justifications:**

- **Host permissions (optional, `http://*/*`, `https://*/*`):** OpenClaw is self-hosted, so every user reaches it at a different address (a domain, a LAN IP, a Tailscale name). The extension cannot list those addresses in advance. Nothing is granted at install; the user enables one site at a time from the popup, and the extension only runs on sites enabled that way.
- **scripting:** registers and injects the extension's own bundled content script on the sites the user enabled. No remote code.
- **activeTab:** when the user opens the popup, checks whether the current page is an OpenClaw page so the popup can say so before the user grants access.
- **contextMenus:** adds "Copy selection as Markdown" to the right-click menu on enabled sites.
- **clipboardWrite:** writes the converted Markdown to the clipboard when the user asks.
- **storage:** saves the user's options.

**Remote code:** No, I am not using remote code.

**Data usage:** does not collect or use any user data. Tick none of the data categories, and certify the three disclosures.

**Privacy policy URL:** https://github.com/BadgerLove/openclaw-copy-markdown/blob/main/PRIVACY.md
