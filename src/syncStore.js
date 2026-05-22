import { firebaseDatabaseUrl } from './firebaseConfig.js?v=2';
import { getFirebaseAuthToken } from './firebaseAuth.js?v=2';

const requestTimeoutMs = 10000;
const maxTextLengths = {
  personName: 120,
  passageText: 8000,
  normalizedPassage: 500,
  takeaway: 4000,
};

class SyncRequestError extends Error {
  constructor(message, { status = 0, detail = '' } = {}) {
    super(message);
    this.name = 'SyncRequestError';
    this.status = status;
    this.detail = detail;
  }
}

function cleanDatabaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function groupUrl(slug) {
  const base = cleanDatabaseUrl(firebaseDatabaseUrl);
  if (!base) return '';
  return `${base}/groups/${encodeURIComponent(slug)}.json`;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text.trim();
      try {
        detail = JSON.parse(text).error || detail;
      } catch {
        // Keep the raw response text when Firebase does not return JSON.
      }
      throw new SyncRequestError(`Sync failed (${response.status})`, { status: response.status, detail });
    }
    return text ? JSON.parse(text) : null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function itemStamp(item) {
  return Date.parse(item?.updatedAt || item?.createdAt || 0) || 0;
}

function reactionStamp(reaction) {
  return Date.parse(reaction?.updatedAt || 0) || 0;
}

function normalizeReactions(reactions) {
  if (!reactions) return [];
  return Array.isArray(reactions) ? reactions : Object.values(reactions);
}

function normalizeCollection(collection) {
  if (!collection) return [];
  return Array.isArray(collection) ? collection.filter(Boolean) : Object.values(collection).filter(Boolean);
}

function byId(items = []) {
  return Object.fromEntries(
    [...items]
      .filter((item) => item?.id)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((item) => [item.id, item]),
  );
}

function mergeReactions(...reactionSets) {
  const merged = new Map();

  for (const reaction of reactionSets.flatMap(normalizeReactions)) {
    if (!reaction?.personId) continue;
    const existing = merged.get(reaction.personId);
    if (!existing || reactionStamp(reaction) >= reactionStamp(existing)) {
      merged.set(reaction.personId, { ...existing, ...reaction });
    }
  }

  return Object.fromEntries([...merged.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
}

function mergeItem(existing, item) {
  if (!existing) return item;

  const newer = itemStamp(item) >= itemStamp(existing) ? item : existing;
  const older = newer === item ? existing : item;
  const merged = { ...older, ...newer };
  const reactions = mergeReactions(existing.reactions, item.reactions);
  if (Object.keys(reactions).length) merged.reactions = reactions;
  else delete merged.reactions;
  return merged;
}

function mergeList(remoteItems = [], localItems = []) {
  const merged = new Map();

  for (const item of [...remoteItems, ...localItems]) {
    if (!item?.id) continue;
    const existing = merged.get(item.id);
    merged.set(item.id, mergeItem(existing, item));
  }

  return [...merged.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function normalizeSnapshot(data) {
  if (!data) return null;
  return {
    name: data.name,
    slug: data.slug,
    updatedAt: data.updatedAt,
    schemaVersion: data.schemaVersion,
    hasLegacyCollections: Boolean(data.people || data.entries),
    people: mergeList(normalizeCollection(data.people), normalizeCollection(data.peopleById)),
    entries: mergeList(normalizeCollection(data.entries), normalizeCollection(data.entriesById)),
  };
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

function serializableSnapshot(snapshotData) {
  return {
    name: snapshotData.name || '',
    slug: snapshotData.slug || '',
    people: snapshotData.people || [],
    entries: snapshotData.entries || [],
  };
}

function sameSnapshot(a, b) {
  if (!a || !b) return a === b;
  return JSON.stringify(serializableSnapshot(a)) === JSON.stringify(serializableSnapshot(b));
}

function sameItem(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

function groupPayload(data) {
  return {
    name: data.name,
    slug: data.slug,
    updatedAt: data.updatedAt,
    schemaVersion: 2,
    peopleById: byId(data.people),
    entriesById: byId(data.entries),
  };
}

function changedItems(remoteItems = [], mergedItems = [], force = false) {
  if (force) return mergedItems;
  const remoteById = byId(remoteItems);
  return mergedItems.filter((item) => !sameItem(item, remoteById[item.id]));
}

function patchPayload(remote, merged) {
  const forceKeyedWrite = remote?.schemaVersion !== 2 || remote?.hasLegacyCollections;
  const patch = {
    name: merged.name,
    slug: merged.slug,
    updatedAt: merged.updatedAt,
    schemaVersion: 2,
    people: null,
    entries: null,
  };

  for (const person of changedItems(remote?.people, merged.people, forceKeyedWrite)) {
    patch[`peopleById/${person.id}`] = person;
  }
  for (const entry of changedItems(remote?.entries, merged.entries, forceKeyedWrite)) {
    patch[`entriesById/${entry.id}`] = entry;
  }

  return patch;
}

function needsSchemaWrite(remote, merged) {
  return remote?.schemaVersion !== 2 || remote?.hasLegacyCollections || !sameSnapshot(merged, remote);
}

function firstValidationIssue(data) {
  for (const person of data?.people || []) {
    if (String(person.name || '').length > maxTextLengths.personName) {
      return `${person.name || 'A reader'} has a name over ${maxTextLengths.personName} characters.`;
    }
  }

  for (const entry of data?.entries || []) {
    const owner = entry.personName || 'One entry';
    if (String(entry.personName || '').length > maxTextLengths.personName) {
      return `${owner} has a reader name over ${maxTextLengths.personName} characters.`;
    }
    if (String(entry.passageText || '').length > maxTextLengths.passageText) {
      return `${owner}'s scripture text is over ${maxTextLengths.passageText} characters.`;
    }
    if (String(entry.normalizedPassage || '').length > maxTextLengths.normalizedPassage) {
      return `${owner}'s entry has older reference data. Edit and save it again.`;
    }
    if (String(entry.takeaway || '').length > maxTextLengths.takeaway) {
      return `${owner}'s takeaway is over ${maxTextLengths.takeaway} characters.`;
    }
  }

  return '';
}

function assertValidForSync(data) {
  const issue = firstValidationIssue(data);
  if (issue) throw new SyncRequestError(issue, { status: 0, detail: issue });
}

function syncErrorMessage(error, fallback) {
  console.error('Daily Scripture sync error', error);
  if (error?.message === 'Firebase API key is missing') return 'Auth setup needed';
  if (error?.name === 'AbortError') return 'Sync timed out. Check connection.';
  if (error?.status === 400) return `Sync blocked: ${error.detail || 'entry data rejected'}`;
  if (error?.status === 401 || error?.status === 403) return 'Sync blocked: refresh app or sign-in failed.';
  if (error?.detail) return `Sync blocked: ${error.detail}`;
  return fallback;
}

export function createSyncStore({ getGroup, getPeople, getEntries, replaceGroupData, onStatus, onRemoteChange }) {
  const url = groupUrl(getGroup().slug);
  let ready = false;
  let queue = Promise.resolve();

  function status(value) {
    onStatus?.(value);
  }

  function enqueue(operation) {
    queue = queue.then(operation, operation);
    return queue;
  }

  async function syncUrl() {
    const token = await getFirebaseAuthToken();
    return `${url}?auth=${encodeURIComponent(token)}`;
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

  function applyMergedData(data, { render = true } = {}) {
    const local = snapshot();
    if (sameSnapshot(data, local)) return false;
    replaceGroupData(data);
    if (render) onRemoteChange?.();
    return true;
  }

  async function loadRemoteNow({ render = true } = {}) {
    if (!url) return;
    status({ mode: 'saving', message: 'Syncing...' });
    try {
      const local = snapshot();
      const remote = normalizeSnapshot(await requestJson(await syncUrl()));
      if (!remote) {
        await requestJson(await syncUrl(), {
          method: 'PUT',
          body: JSON.stringify(groupPayload(local)),
        });
        status({ mode: 'online', message: 'Synced' });
        ready = true;
        return;
      }

      const merged = mergeSnapshots(remote, local);
      let changed = false;
      if (applyMergedData(merged, { render })) {
        status({ mode: 'online', message: 'Synced' });
        changed = true;
      }
      if (needsSchemaWrite(remote, merged)) {
        assertValidForSync(merged);
        await requestJson(await syncUrl(), {
          method: 'PATCH',
          body: JSON.stringify(patchPayload(remote, merged)),
        });
        changed = true;
      }
      if (!changed) status({ mode: 'online', message: 'Online' });
      ready = true;
    } catch (error) {
      status({ mode: 'offline', message: syncErrorMessage(error, 'Sync paused') });
    }
  }

  async function saveNow({ merge = true } = {}) {
    if (!url) return;
    status({ mode: 'saving', message: 'Saving online...' });
    try {
      const local = snapshot();
      assertValidForSync(local);
      const remote = merge ? normalizeSnapshot(await requestJson(await syncUrl()).catch(() => null)) : null;
      const data = merge ? mergeSnapshots(remote, local) : local;
      assertValidForSync(data);
      await requestJson(await syncUrl(), {
        method: remote ? 'PATCH' : 'PUT',
        body: JSON.stringify(remote ? patchPayload(remote, data) : groupPayload(data)),
      });

      const latest = merge ? normalizeSnapshot(await requestJson(await syncUrl()).catch(() => data)) : data;
      applyMergedData(latest || data, { render: false });
      status({ mode: 'online', message: 'Synced' });
    } catch (error) {
      status({ mode: 'offline', message: syncErrorMessage(error, 'Saved locally') });
    }
  }

  function loadRemote(options) {
    return enqueue(() => loadRemoteNow(options));
  }

  function save(options) {
    return enqueue(() => saveNow(options));
  }

  async function start() {
    if (!url) {
      status({ mode: 'local', message: 'Local only' });
      return;
    }
    await loadRemote();
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
    syncNow: loadRemote,
    start,
    stop,
  };
}
