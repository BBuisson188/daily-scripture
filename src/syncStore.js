import { firebaseDatabaseUrl } from './firebaseConfig.js';

const pollMs = 7000;

function cleanDatabaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function groupUrl(slug) {
  const base = cleanDatabaseUrl(firebaseDatabaseUrl);
  if (!base) return '';
  return `${base}/groups/${encodeURIComponent(slug)}.json`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Sync failed (${response.status})`);
  return response.json();
}

export function createSyncStore({ getGroup, getPeople, getEntries, replaceGroupData, onStatus, onRemoteChange }) {
  const url = groupUrl(getGroup().slug);
  let remoteUpdatedAt = '';
  let pollId = 0;
  let saving = false;
  let ready = false;

  function status(value) {
    onStatus?.(value);
  }

  function snapshot() {
    const group = getGroup();
    return {
      name: group.name,
      slug: group.slug,
      updatedAt: new Date().toISOString(),
      people: getPeople().map((person) => ({ ...person })),
      entries: getEntries().map((entry) => ({ ...entry })),
    };
  }

  async function loadRemote({ render = true } = {}) {
    if (!url || saving) return;
    try {
      const remote = await requestJson(url);
      if (remote?.updatedAt && remote.updatedAt !== remoteUpdatedAt) {
        remoteUpdatedAt = remote.updatedAt;
        replaceGroupData(remote);
        status({ mode: 'online', message: 'Synced' });
        if (render) onRemoteChange?.();
      }
      if (!remote) {
        await save();
      }
      ready = true;
    } catch (error) {
      status({ mode: 'offline', message: 'Sync paused' });
    }
  }

  async function save() {
    if (!url) return;
    saving = true;
    status({ mode: 'saving', message: 'Saving online...' });
    try {
      const data = snapshot();
      await requestJson(url, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      remoteUpdatedAt = data.updatedAt;
      status({ mode: 'online', message: 'Synced' });
    } catch (error) {
      status({ mode: 'offline', message: 'Saved locally' });
    } finally {
      saving = false;
    }
  }

  async function start() {
    if (!url) {
      status({ mode: 'local', message: 'Local only' });
      return;
    }
    status({ mode: 'saving', message: 'Connecting...' });
    await loadRemote();
    pollId = window.setInterval(() => loadRemote(), pollMs);
  }

  function stop() {
    if (pollId) window.clearInterval(pollId);
  }

  return {
    enabled: Boolean(url),
    get ready() {
      return ready;
    },
    save,
    start,
    stop,
  };
}
