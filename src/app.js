import { createSyncStore } from './syncStore.js?v=4';
import { bibleGatewayUrl, getPassageSuggestions, parsePassage } from './passageParser.js?v=4';

const localKey = 'daily-scripture-local-v1';
const defaultGroupSlug = 'main';
const app = document.getElementById('root');
const dateFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const state = {
  data: readLocal(),
  activeDate: isoDate(new Date()),
  selectedPersonId: '',
  readerName: '',
  passageText: '',
  takeaway: '',
  error: '',
  activeTab: 'today',
  syncStatus: { mode: 'local', message: 'Local only' },
};

const newPersonValue = '__new_person__';
let syncStore = null;

function readLocal() {
  const raw = localStorage.getItem(localKey);
  if (raw) return JSON.parse(raw);
  const data = {
    groups: [{ id: 'local-main', slug: defaultGroupSlug, name: 'Small Group' }],
    people: [],
    entries: [],
  };
  writeLocal(data);
  return data;
}

function writeLocal(data) {
  localStorage.setItem(localKey, JSON.stringify(data));
}

function saveData({ remote = true } = {}) {
  writeLocal(state.data);
  if (remote) syncStore?.save();
}

function groupSlug() {
  return window.location.pathname.match(/\/g\/([^/]+)/)?.[1] || defaultGroupSlug;
}

function currentGroup() {
  const slug = groupSlug();
  let group = state.data.groups.find((item) => item.slug === slug);
  if (!group) {
    group = { id: `group-${crypto.randomUUID()}`, slug, name: titleFromSlug(slug) };
    state.data.groups.push(group);
    saveData();
  }
  return group;
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ') || 'Small Group';
}

function savedPersonKey(groupId) {
  return `daily-scripture-person-${groupId}`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function displayDate(value) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function weekKey(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return isoDate(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function people() {
  const group = currentGroup();
  return state.data.people.filter((person) => person.groupId === group.id && person.active !== false);
}

function entries() {
  const group = currentGroup();
  return state.data.entries.filter((entry) => entry.groupId === group.id);
}

function replaceGroupData(remote) {
  const group = currentGroup();
  const peopleForGroup = Array.isArray(remote?.people) ? remote.people : [];
  const entriesForGroup = Array.isArray(remote?.entries) ? remote.entries : [];

  state.data.people = [
    ...state.data.people.filter((person) => person.groupId !== group.id),
    ...peopleForGroup.map((person) => ({ ...person, groupId: group.id })),
  ];
  state.data.entries = [
    ...state.data.entries.filter((entry) => entry.groupId !== group.id),
    ...entriesForGroup.map((entry) => ({ ...entry, groupId: group.id })),
  ];
  if (state.selectedPersonId && !state.data.people.some((person) => person.id === state.selectedPersonId)) {
    state.selectedPersonId = '';
  }
  saveData({ remote: false });
}

function selectedPerson() {
  return people().find((person) => person.id === state.selectedPersonId);
}

function selectedEntry() {
  return entries().find((entry) => entry.personId === state.selectedPersonId && entry.entryDate === state.activeDate);
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
}

function dailyStreak(personId) {
  const dates = new Set(entries().filter((entry) => entry.personId === personId).map((entry) => entry.entryDate));
  const today = isoDate(new Date());
  const yesterday = shiftDate(today, -1);
  let cursor = dates.has(today) ? today : dates.has(yesterday) ? yesterday : '';
  if (!cursor) return 0;
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

function formatStreak(value, unit) {
  if (!value) return '';
  return `${value} ${unit}${value === 1 ? '' : 's'} streak`;
}

function weeklyStreak(personId) {
  const weeks = new Set(entries().filter((entry) => entry.personId === personId).map((entry) => weekKey(entry.entryDate)));
  let cursor = weekKey(isoDate(new Date()));
  let streak = 0;
  while (weeks.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -7);
  }
  return streak;
}

function syncFormFromSelection() {
  const entry = selectedEntry();
  const person = selectedPerson();
  state.readerName = person?.name || state.readerName;
  state.passageText = entry?.passageText || '';
  state.takeaway = entry?.takeaway || '';
}

function resolveReader() {
  const existing = selectedPerson();
  if (existing && state.selectedPersonId !== newPersonValue) return existing;

  const name = state.readerName.trim();
  if (!name) return null;
  const group = currentGroup();
  let person = people().find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!person) {
    person = { id: `person-${crypto.randomUUID()}`, groupId: group.id, name, active: true };
    state.data.people.push(person);
  }
  state.selectedPersonId = person.id;
  state.readerName = person.name;
  localStorage.setItem(savedPersonKey(group.id), person.id);
  return person;
}

function renderEntry(entry) {
  const firstRange = entry.parsedRanges?.[0];
  const url = firstRange ? bibleGatewayUrl(firstRange) : '';
  return `
    <article class="entry-card">
      <div class="entry-header">
        <div>
          <strong>${escapeHtml(entry.personName)}</strong>
          <p>${escapeHtml(entry.normalizedPassage || entry.passageText)}</p>
        </div>
        <span>${entry.verseCount ?? '?'} verses</span>
      </div>
      <p class="takeaway">${escapeHtml(entry.takeaway)}</p>
      ${
        url
          ? `<a class="scripture-link" href="${url}" target="_blank" rel="noreferrer">Open passage</a>`
          : ''
      }
    </article>
  `;
}

function renderPassageFeedback(passage, suggestions = getPassageSuggestions(state.passageText)) {
  if (passage.status === 'parsed') {
    return `${escapeHtml(passage.normalized)} &bull; ${passage.verseCount} verses`;
  }
  if (suggestions.length) {
    return `
      <span>${escapeHtml(passage.message || 'Did you mean one of these?')}</span>
      <div class="suggestion-list">
        ${suggestions.map((suggestion) => `<button type="button" data-passage-suggestion="${escapeHtml(suggestion.value)}">${escapeHtml(suggestion.label)}</button>`).join('')}
      </div>
    `;
  }
  return escapeHtml(passage.message || 'Verse count will appear here');
}

function updatePassageFeedback() {
  const passage = parsePassage(state.passageText);
  const note = app.querySelector('[data-passage-feedback]');
  if (!note) return;
  note.className = passage.status === 'unknown' ? 'parse-note warning' : 'parse-note';
  note.innerHTML = renderPassageFeedback(passage);
  bindPassageSuggestions();
}

function updateTakeawayCount() {
  const counter = app.querySelector('[data-takeaway-count]');
  if (counter) counter.textContent = `${state.takeaway.trim().length} characters`;
}

function renderToday() {
  const passage = parsePassage(state.passageText);
  const knownPeople = people();
  const isNewPerson = state.selectedPersonId === newPersonValue || !selectedPerson();
  const selectValue = isNewPerson ? newPersonValue : state.selectedPersonId;
  return `
    <section class="entry-shell">
      <form class="entry-card-form" data-entry-form>
        <label>
          <span>Name</span>
          <div class="field-wrap">
            <select name="readerSelect">
              ${knownPeople.map((person) => `<option value="${escapeHtml(person.id)}" ${person.id === selectValue ? 'selected' : ''}>${escapeHtml(person.name)}</option>`).join('')}
              <option value="${newPersonValue}" ${selectValue === newPersonValue ? 'selected' : ''}>New person</option>
            </select>
          </div>
        </label>

        ${
          isNewPerson
            ? `<label class="new-person-field">
                <span>Your Name (for future tracking)</span>
                <div class="field-wrap">
                  <input name="readerName" value="${escapeHtml(state.readerName)}" placeholder="e.g., Tom B." autocomplete="off" />
                </div>
              </label>`
            : ''
        }

        <label>
          <span>Scripture</span>
          <div class="field-wrap tall">
            <textarea name="passage" rows="3" placeholder="Enter a scripture...">${escapeHtml(state.passageText)}</textarea>
            <small>e.g., John 3:16-4:5</small>
          </div>
        </label>

        <div class="${passage.status === 'unknown' ? 'parse-note warning' : 'parse-note'}" data-passage-feedback>
          ${renderPassageFeedback(passage)}
        </div>

        <label>
          <span>Takeaway</span>
          <div class="field-wrap">
            <textarea name="takeaway" rows="3" placeholder="What is God teaching you?">${escapeHtml(state.takeaway)}</textarea>
          </div>
        </label>

        <div class="form-meta">
          <span data-takeaway-count>${state.takeaway.trim().length} characters</span>
          <span>${selectedEntry() ? 'Editing today' : 'New entry'}</span>
        </div>

        <button class="save-button" type="submit">${selectedEntry() ? 'Update Entry' : 'Save Entry'}</button>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}
      </form>
    </section>
  `;
}

function renderEntriesTab() {
  const dayEntries = entries()
    .filter((entry) => entry.entryDate === state.activeDate)
    .sort((a, b) => a.personName.localeCompare(b.personName));

  return `
    <section class="entries-view">
      <div class="date-pill">
        <button class="round-nav" type="button" title="Previous day" data-day="-1">&lt;</button>
        <strong>${displayDate(state.activeDate)}</strong>
        <button class="round-nav" type="button" title="Next day" data-day="1">&gt;</button>
      </div>
      <div class="section-heading">
        <p class="eyebrow">Group Entries</p>
        <h2>Readings for ${displayDate(state.activeDate)}</h2>
      </div>
      <div class="entry-list">
        ${dayEntries.length ? dayEntries.map(renderEntry).join('') : '<p class="empty">No readings entered for this day yet.</p>'}
      </div>
    </section>
  `;
}

function renderScoreboard() {
  const allEntries = entries();
  const rows = people()
    .map((person) => {
      const personEntries = allEntries.filter((entry) => entry.personId === person.id);
      return {
        ...person,
        daily: dailyStreak(person.id),
        weekly: weeklyStreak(person.id),
        avgVerses: average(personEntries.map((entry) => entry.verseCount)),
        avgTakeaway: average(personEntries.map((entry) => entry.takeawayChars)),
        total: personEntries.length,
      };
    })
    .sort((a, b) => b.daily - a.daily || b.weekly - a.weekly || a.name.localeCompare(b.name));

  return `
    <section class="scoreboard" id="scoreboard">
      <div class="section-heading">
        <p class="eyebrow">Scoreboard</p>
        <h2>Iron Sharpens Iron</h2>
      </div>
      <div class="stats-strip">
        <div><span>${average(allEntries.map((entry) => entry.verseCount)).toFixed(1)}</span><p>Avg verses / day</p></div>
        <div><span>${average(allEntries.map((entry) => entry.takeawayChars)).toFixed(0)}</span><p>Avg character length of Takeaway</p></div>
        <div><span>${allEntries.length}</span><p>Total readings</p></div>
      </div>
      <div class="score-list">
        ${
          rows.length
            ? rows
                .map(
                  (row) => `
                    <article class="score-row">
                      <strong>${escapeHtml(row.name)}</strong>
                      ${formatStreak(row.daily, 'day') ? `<span>${formatStreak(row.daily, 'day')}</span>` : ''}
                      ${formatStreak(row.weekly, 'week') ? `<span>${formatStreak(row.weekly, 'week')}</span>` : ''}
                      <span>${row.avgVerses.toFixed(1)} verses / day</span>
                      <span>${row.avgTakeaway.toFixed(0)} avg takeaway length</span>
                    </article>
                  `,
                )
                .join('')
            : '<p class="empty">Add readers to start the scoreboard.</p>'
        }
      </div>
    </section>
  `;
}

function render() {
  const group = currentGroup();
  if (!state.selectedPersonId) {
    const saved = localStorage.getItem(savedPersonKey(group.id));
    if (saved && people().some((person) => person.id === saved)) state.selectedPersonId = saved;
    state.readerName = selectedPerson()?.name || state.readerName;
  }

  app.innerHTML = `
    <main class="app-frame">
      <section class="hero">
      </section>

      <section class="content-panel">
        <div class="sync-status ${escapeHtml(state.syncStatus.mode)}">${escapeHtml(state.syncStatus.message)}</div>
        ${state.activeTab === 'today' ? renderToday() : ''}
        ${state.activeTab === 'entries' ? renderEntriesTab() : ''}
        ${state.activeTab === 'scoreboard' ? renderScoreboard() : ''}
      </section>

      <nav class="bottom-nav" aria-label="Primary">
        <button class="${state.activeTab === 'today' ? 'active' : ''}" type="button" data-tab="today"><img class="nav-icon" src="src/assets/icons/today.svg?v=3" alt="" aria-hidden="true" /><span>Today</span></button>
        <button class="${state.activeTab === 'entries' ? 'active' : ''}" type="button" data-tab="entries"><img class="nav-icon" src="src/assets/icons/entries.svg?v=3" alt="" aria-hidden="true" /><span>Entries</span></button>
        <button class="${state.activeTab === 'scoreboard' ? 'active' : ''}" type="button" data-tab="scoreboard"><img class="nav-icon" src="src/assets/icons/scoreboard.svg?v=3" alt="" aria-hidden="true" /><span>Scoreboard</span></button>
      </nav>
    </main>
  `;

  bindEvents();
}

function bindPassageSuggestions() {
  app.querySelectorAll('[data-passage-suggestion]').forEach((button) => {
    button.addEventListener('click', () => {
      state.passageText = button.dataset.passageSuggestion || '';
      const input = app.querySelector('[name="passage"]');
      if (input) {
        input.value = state.passageText;
        input.focus();
      }
      updatePassageFeedback();
    });
  });
}

function bindEvents() {
  app.querySelector('[data-refresh]')?.addEventListener('click', () => {
    state.data = readLocal();
    render();
  });

  app.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      state.error = '';
      render();
    });
  });

  app.querySelector('[data-add-person]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name').trim();
    if (!name) return;
    const group = currentGroup();
    const person = { id: `person-${crypto.randomUUID()}`, groupId: group.id, name, active: true };
    state.data.people.push(person);
    state.selectedPersonId = person.id;
    localStorage.setItem(savedPersonKey(group.id), person.id);
    saveData();
    syncFormFromSelection();
    render();
  });

  app.querySelectorAll('[data-day]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeDate = shiftDate(state.activeDate, Number(button.dataset.day));
      syncFormFromSelection();
      render();
    });
  });

  app.querySelector('[name="passage"]')?.addEventListener('input', (event) => {
    state.passageText = event.target.value;
    updatePassageFeedback();
  });

  app.querySelector('[name="readerSelect"]')?.addEventListener('change', (event) => {
    const value = event.target.value;
    state.selectedPersonId = value;
    if (value === newPersonValue) {
      state.readerName = '';
    } else {
      const person = people().find((item) => item.id === value);
      state.readerName = person?.name || '';
      if (person) localStorage.setItem(savedPersonKey(currentGroup().id), person.id);
      syncFormFromSelection();
    }
    render();
  });

  app.querySelector('[name="readerName"]')?.addEventListener('input', (event) => {
    state.readerName = event.target.value;
    const matched = people().find((person) => person.name.toLowerCase() === state.readerName.trim().toLowerCase());
    state.selectedPersonId = matched?.id || newPersonValue;
    if (matched) localStorage.setItem(savedPersonKey(currentGroup().id), matched.id);
  });

  app.querySelector('[name="takeaway"]')?.addEventListener('input', (event) => {
    state.takeaway = event.target.value;
    updateTakeawayCount();
  });

  app.querySelector('[data-entry-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const person = resolveReader();
    const passage = parsePassage(state.passageText);
    if (!person) {
      state.error = 'Add your name first.';
      render();
      return;
    }
    if (!state.passageText.trim() || !state.takeaway.trim()) {
      state.error = 'Add both a passage and a takeaway.';
      render();
      return;
    }

    const group = currentGroup();
    const payload = {
      id: `${state.activeDate}_${person.id}`,
      groupId: group.id,
      personId: person.id,
      personName: person.name,
      entryDate: state.activeDate,
      passageText: state.passageText.trim(),
      normalizedPassage: passage.normalized,
      parsedRanges: passage.ranges,
      verseCount: passage.verseCount,
      takeaway: state.takeaway.trim(),
      takeawayChars: state.takeaway.trim().length,
      updatedAt: new Date().toISOString(),
    };
    const existing = state.data.entries.find((entry) => entry.groupId === group.id && entry.id === payload.id);
    if (existing) Object.assign(existing, payload);
    else state.data.entries.push({ ...payload, createdAt: new Date().toISOString() });

    state.error = '';
    saveData();
    render();
  });

  bindPassageSuggestions();
}

function startSync() {
  syncStore = createSyncStore({
    getGroup: currentGroup,
    getPeople: people,
    getEntries: entries,
    replaceGroupData,
    onStatus: (syncStatus) => {
      state.syncStatus = syncStatus;
      app.querySelector('.sync-status')?.replaceChildren(document.createTextNode(syncStatus.message));
      const status = app.querySelector('.sync-status');
      if (status) status.className = `sync-status ${syncStatus.mode}`;
    },
    onRemoteChange: render,
  });
  syncStore.start();
}

render();
startSync();
