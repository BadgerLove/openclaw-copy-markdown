'use strict';

const $ = (id) => document.getElementById(id);
const show = (id, on) => {
  $(id).hidden = !on;
};

let pattern = '';

function setStatus(text, hint) {
  $('status').textContent = text;
  $('hint').textContent = hint || '';
  show('hint', !!hint);
}

async function currentTab() {
  // ?tabId= lets the automated test point the popup at a specific tab.
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function looksLikeOpenClaw(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!document.querySelector('openclaw-app'),
    });
    return !!(res && res.result);
  } catch (_) {
    return false;
  }
}

async function render() {
  const tab = await currentTab().catch(() => null);
  let url = null;
  try {
    url = new URL(tab.url);
  } catch (_) {
    /* no readable URL */
  }
  if (!url || !/^https?:$/.test(url.protocol)) {
    setStatus('Open your OpenClaw page, then click this icon again to enable it there.');
    return;
  }
  // Host permissions ignore the port, so one grant covers the host on any port.
  pattern = `${url.protocol}//${url.hostname}/*`;
  const host = url.host;

  if (await chrome.permissions.contains({ origins: [pattern] })) {
    setStatus(`On for ${host}.`, 'Select text in a message and click the "Copy as Markdown" button that appears.');
    show('disable', true);
    show('enable', false);
    return;
  }
  show('disable', false);
  show('enable', true);
  if (await looksLikeOpenClaw(tab.id)) {
    setStatus(`OpenClaw found at ${host}.`, 'Enabling lets the extension read text you select on this site only.');
  } else {
    setStatus(
      `${host} does not look like an OpenClaw page.`,
      'You can still enable it here; it will work on any text you select on this site.',
    );
  }
}

// permissions.request must be the first thing the click does (user gesture).
// The browser's prompt may close this popup; the background worker reacts to
// the grant and switches the open tab on, so nothing depends on code here.
$('enable').addEventListener('click', () => {
  if (!pattern) return;
  chrome.permissions.request({ origins: [pattern] }).then(
    (granted) => {
      if (granted) window.close();
    },
    () => {},
  );
});

$('disable').addEventListener('click', async () => {
  if (!pattern) return;
  await chrome.permissions.remove({ origins: [pattern] });
  setStatus('Turned off for this site.', 'Reload the page to remove the button from tabs that are already open.');
  show('disable', false);
  show('enable', true);
});

$('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();
