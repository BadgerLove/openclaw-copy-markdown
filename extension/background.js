/*
 * Copy as Markdown for OpenClaw - background service worker.
 *
 * The extension has no access to any site until the user enables one (popup or
 * options page). Each enabled site is an optional host permission; this worker
 * keeps the content-script registration and the context-menu item in step with
 * whatever is currently granted, and forwards the triggers that live outside
 * the page (menu item, keyboard shortcut) to the content script.
 */
'use strict';

const MENU_ID = 'oc-copy-selection-md';
const SCRIPT_ID = 'oc-copy-md';
const FILES = ['md.js', 'content.js'];
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn, fn));

async function grantedPatterns() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => /^https?:\/\//.test(o));
}

function createMenu(patterns) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(
      { id: MENU_ID, title: 'Copy selection as Markdown', contexts: ['selection'], documentUrlPatterns: patterns },
      () => resolve(!chrome.runtime.lastError),
    );
  });
}

// Make the registered content script and the menu item match the granted sites.
async function syncSites() {
  const patterns = await grantedPatterns();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
  if (!patterns.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } else if (existing.length) {
    await chrome.scripting.updateContentScripts([{ id: SCRIPT_ID, matches: patterns }]);
  } else {
    await chrome.scripting.registerContentScripts([
      { id: SCRIPT_ID, matches: patterns, js: FILES, runAt: 'document_idle', persistAcrossSessions: true },
    ]);
  }
  await chrome.contextMenus.removeAll();
  if (patterns.length) await createMenu(patterns);
  return patterns;
}

// Start working in tabs that are already open, so enabling needs no refresh.
async function injectOpenTabs(patterns) {
  if (!patterns.length) return 0;
  const tabs = await chrome.tabs.query({ url: patterns });
  let n = 0;
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
      n++;
    } catch (_) {
      /* tab is discarded, crashed or otherwise not scriptable */
    }
  }
  return n;
}

chrome.runtime.onInstalled.addListener((details) => {
  enqueue(async () => {
    await injectOpenTabs(await syncSites());
    // Nothing works until a site is enabled, so say how.
    if (details.reason === 'install') await chrome.runtime.openOptionsPage();
  });
});
chrome.runtime.onStartup.addListener(() => enqueue(syncSites));

chrome.permissions.onAdded.addListener((added) => {
  enqueue(async () => {
    await syncSites();
    await injectOpenTabs((added.origins || []).filter((o) => /^https?:\/\//.test(o)));
  });
});
chrome.permissions.onRemoved.addListener(() => enqueue(syncSites));

async function flash(tabId, text, title) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#b42318' });
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setTitle({ tabId, title });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId, title: 'Copy as Markdown for OpenClaw' }).catch(() => {});
    }, 2500);
  } catch (_) {
    /* tab went away */
  }
}

async function trigger(tab, frameId) {
  if (!tab || tab.id == null) return;
  try {
    const msg = { type: 'oc-copy-md' };
    if (typeof frameId === 'number') await chrome.tabs.sendMessage(tab.id, msg, { frameId });
    else await chrome.tabs.sendMessage(tab.id, msg);
  } catch (_) {
    await flash(tab.id, '!', 'Not enabled on this site: click the icon to enable it');
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) trigger(tab, info.frameId);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'copy-selection-md') trigger(tab);
});
