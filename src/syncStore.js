import { firebaseDatabaseUrl } from './firebaseConfig.js';

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

function itemStamp(item) {
  return Date.parse(item?.updatedAt || item?.createdAt || 0) || 0;
}

function mergeList(remoteItems = [], localItems = []) {
  const merged = new Map();

  for (const item of [...remoteItems, ...localItems]) {
    if (!item?.id) continue;
    const existing = merged.get(item.id);
    if (!existing || itemStamp(item) >= itemStamp(existing)) {
      merged.set(item.id, { ...existing, ...item });
    }
  }

  return [...merged.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function mergeSnapshots(remote, local) {
  if (!remote) return local;
  if (!local) return remote;

  return {
    name: local.name || remote.name,
    slug: local.slug || remote.slug,
    updatedAt: new Date(Math.max(itemStamp(remote), itemStamp(local), Date.now())).toISOString(),
    people: mergeList(remote.people, local.people),
    entries: mergeList(remote.entries, local.entries),
  };
}

function sameSnapshot(a, b) {
  if (!a || !b) return a === b;
  return JSON.stringify({
    name: a.name || '',
    slug: a.slug || '',
    people: a.people || [],
    entries: a.entries || [],
  }) === JSON.stringify({
    name: b.name || '',
    slug: b.slug || '',
    people: b.people || [],
    entries: b.entries || [],
  });
}

export function createSyncStore({ getGroup, getPeople, getEntries, replaceGroupData, onStatus, onRemoteChange }) {
  const url = groupUrl(getGroup().slug);
  let remoteUpdatedAt = '';
  let saving = false;
  let ready = false;

  function status(value) {
    onStatus?.(value);
  }

  function snapshot() {
    const group = getGroup();
    const people = getPeople().map((person) => ({ ...person })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const entries = getEntries().map((entry) => ({ ...entry })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return {
      name: group.name,
      slug: group.slug,
      updatedAt: new Date(
        Math.max(
          Date.now(),
          ...people.map(itemStamp),
          ...entries.map(itemStamp),
        ),
      ).toISOString(),
      people,
      entries,
    };
  }

  async function loadRemote({ render = true } = {}) {
    if (!url || saving) return;
    try {
      const local = snapshot();
      const remote = await requestJson(url);
      if (!remote) {
        await save();
        ready = true;
        return;
      }

      const merged = mergeSnapshots(remote, local);
      if (!sameSnapshot(merged, local)) {
        replaceGroupData(merged);
        status({ mode: 'online', message: 'Synced' });
        if (render) onRemoteChange?.();
      }
      if (!sameSnapshot(merged, remote)) {
        await requestJson(url, {
          method: 'PUT',
          body: JSON.stringify(merged),
        });
      }
      remoteUpdatedAt = merged.updatedAt;
      ready = true;
    } catch (error) {
      status({ mode: 'offline', message: 'Sync paused' });
    }
  }

  async function save({ merge = true } = {}) {
    if (!url) return;
    saving = true;
    status({ mode: 'saving', message: 'Saving online...' });
    try {
      const local = snapshot();
      const remote = merge ? await requestJson(url).catch(() => null) : null;
      const data = merge ? mergeSnapshots(remote, local) : local;
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
    ready = true;
    status({ mode: 'online', message: 'Online' });
  }

  function stop() {
    ready = false;
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
