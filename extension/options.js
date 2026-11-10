'use strict';

const DEFAULTS = {
  flavor: 'discord',
  tables: 'auto',
  wrapLinks: false,
  nativeMenu: 'selection',
  ctrlC: false,
  pill: true,
  limit: 2000,
};

const $ = (id) => document.getElementById(id);
const radios = (name) => Array.from(document.querySelectorAll(`input[name="${name}"]`));

// ---- settings -------------------------------------------------------------

function render(v) {
  for (const name of ['flavor', 'nativeMenu']) {
    for (const r of radios(name)) r.checked = r.value === v[name];
  }
  $('tables').value = v.tables;
  $('ctrlC').checked = !!v.ctrlC;
  $('pill').checked = !!v.pill;
  $('wrapLinks').checked = !!v.wrapLinks;
  $('limit').value = String(v.limit);
}

function read() {
  const pick = (name) => (radios(name).find((r) => r.checked) || {}).value || DEFAULTS[name];
  return {
    flavor: pick('flavor'),
    nativeMenu: pick('nativeMenu'),
    tables: $('tables').value,
    ctrlC: $('ctrlC').checked,
    pill: $('pill').checked,
    wrapLinks: $('wrapLinks').checked,
    limit: Number($('limit').value) || 0,
  };
}

let timer = 0;
async function save() {
  await chrome.storage.sync.set(read());
  $('saved').classList.add('on');
  clearTimeout(timer);
  timer = setTimeout(() => $('saved').classList.remove('on'), 1200);
}

chrome.storage.sync.get(DEFAULTS).then(render);
document.addEventListener('change', (e) => {
  if (e.target && e.target.id !== 'site') save();
});

// ---- enabled sites --------------------------------------------------------

async function renderSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  const list = $('sites');
  list.textContent = '';
  const sites = origins.filter((o) => /^https?:\/\//.test(o)).sort();
  if (!sites.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No sites enabled yet.';
    list.appendChild(li);
    return;
  }
  for (const pattern of sites) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = pattern.replace(/\/\*$/, '');
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      await chrome.permissions.remove({ origins: [pattern] });
      renderSites();
    });
    li.append(code, btn);
    list.appendChild(li);
  }
}

// Everything before permissions.request stays synchronous: the request has to
// happen inside the click's user gesture.
function addSite() {
  $('siteError').textContent = '';
  let value = $('site').value.trim();
  if (!value) return;
  if (!/^[a-z]+:\/\//i.test(value)) value = 'https://' + value;
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname) {
    $('siteError').textContent = 'That does not look like a web address.';
    return;
  }
  chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] }).then(
    (granted) => {
      if (granted) $('site').value = '';
      renderSites();
    },
    (err) => {
      $('siteError').textContent = String((err && err.message) || err);
    },
  );
}

$('addSite').addEventListener('click', addSite);
$('site').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addSite();
});
chrome.permissions.onAdded.addListener(renderSites);
chrome.permissions.onRemoved.addListener(renderSites);
renderSites();
