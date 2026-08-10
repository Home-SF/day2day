import { firebaseConfig, COLLECTION_PREFIX, STORAGE_PREFIX } from './firebase-config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, collectionGroup, doc, getDoc, getDocs, setDoc, addDoc,
  query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

const DAYS_COLLECTION = `${COLLECTION_PREFIX}_days`;

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

const WEATHER_CODES = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"], 48: ["Fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Dense drizzle", "🌧️"],
  61: ["Light rain", "🌧️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"],
  80: ["Rain showers", "🌦️"], 81: ["Rain showers", "🌦️"], 82: ["Violent showers", "⛈️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"]
};

const main = document.getElementById('main');
const breadcrumb = document.getElementById('breadcrumb');
const toastEl = document.getElementById('toast');
const signinScreen = document.getElementById('signin-screen');
const appShell = document.getElementById('app-shell');
const signinError = document.getElementById('signin-error');

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function friendlyError(e) {
  if (e && e.code === 'permission-denied') {
    return `Access denied — signed in as ${auth.currentUser?.email || 'unknown'}, which isn't authorized for this log.`;
  }
  return 'Something went wrong — please try again.';
}

function pad(n) { return String(n).padStart(2, '0'); }

function todayId() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function fmtTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---------------- Data helpers ----------------

async function fetchAllDayIds() {
  const snap = await getDocs(collection(db, DAYS_COLLECTION));
  return snap.docs.map(d => d.id).sort();
}

async function getDayDoc(dayId) {
  const snap = await getDoc(doc(db, DAYS_COLLECTION, dayId));
  return snap.exists() ? snap.data() : null;
}

async function ensureDayDoc(dayId) {
  // Normally today's (and future) day docs are pre-created by the
  // scheduled Cloud Function at midnight (see functions/index.js).
  // This is a fallback for the very first day ever, or any day the
  // scheduled function missed — it only creates a doc if one isn't
  // already there, and never overwrites existing data.
  const existing = await getDayDoc(dayId);
  if (existing) return existing;
  const fresh = { createdAt: new Date().toISOString() };
  await setDoc(doc(db, DAYS_COLLECTION, dayId), fresh);
  return fresh;
}

async function fetchEntries(dayId) {
  const q = query(collection(db, DAYS_COLLECTION, dayId, 'entries'), orderBy('timestamp', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addEntry(dayId, entry) {
  await addDoc(collection(db, DAYS_COLLECTION, dayId, 'entries'), {
    ...entry,
    timestamp: new Date().toISOString()
  });
}

// Pulls every tag ever used on a text entry, across all days, so the
// tag step can offer past tags as suggestions. Sorted ascending,
// alphabetically, case-insensitively.
async function fetchAllTags() {
  try {
    const q = query(collectionGroup(db, 'entries'), where('type', '==', 'text'));
    const snap = await getDocs(q);
    const tagSet = new Set();
    snap.docs.forEach(d => {
      const tags = d.data().tags;
      if (Array.isArray(tags)) tags.forEach(t => { if (t) tagSet.add(t); });
    });
    return [...tagSet].sort((a, b) => a.localeCompare(b));
  } catch (e) {
    console.error('Fetching past tags failed', e);
    return [];
  }
}

// ---------------- Weather ----------------

async function captureNoonWeather(dayId, lat, lng) {
  const isPast = dayId < todayId();
  const base = isPast
    ? "https://archive-api.open-meteo.com/v1/archive"
    : "https://api.open-meteo.com/v1/forecast";
  const url = `${base}?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weathercode&start_date=${dayId}&end_date=${dayId}&timezone=auto&temperature_unit=fahrenheit`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const times = data.hourly.time;
    let idx = times.findIndex(t => t.endsWith('T12:00'));
    if (idx === -1) idx = Math.floor(times.length / 2);
    const temp = data.hourly.temperature_2m[idx];
    const code = data.hourly.weathercode[idx];
    const [label, icon] = WEATHER_CODES[code] || ["Unknown", "🌡️"];
    const weather = { tempF: Math.round(temp), condition: label, icon, capturedAt: 'noon' };
    await setDoc(doc(db, DAYS_COLLECTION, dayId), { weather }, { merge: true });
    return weather;
  } catch (e) {
    console.error('Weather capture failed', e);
    return null;
  }
}

// ---------------- Geolocation / reverse geocode ----------------

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation unsupported'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  });
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
    const data = await res.json();
    return data.city || data.locality || data.principalSubdivision || 'Unknown location';
  } catch (e) {
    console.error('Reverse geocode failed', e);
    return 'Unknown location';
  }
}

async function tagCityIfMissing(dayId, existingDoc) {
  if (existingDoc && existingDoc.city) return existingDoc.city;
  try {
    const { lat, lng } = await getPosition();
    const city = await reverseGeocode(lat, lng);
    await setDoc(doc(db, DAYS_COLLECTION, dayId), { city }, { merge: true });
    return city;
  } catch (e) {
    console.warn('City tagging skipped:', e.message);
    return null;
  }
}

async function captureWeatherIfMissing(dayId, existingDoc) {
  if (existingDoc && existingDoc.weather) return existingDoc.weather;
  try {
    const { lat, lng } = await getPosition();
    return await captureNoonWeather(dayId, lat, lng);
  } catch (e) {
    console.warn('Weather capture skipped:', e.message);
    return null;
  }
}

// ---------------- Routing ----------------

function setBreadcrumb(parts) {
  breadcrumb.innerHTML = '';
  const home = document.createElement('a');
  home.href = '#/';
  home.textContent = 'Field Log';
  breadcrumb.appendChild(home);
  parts.forEach(p => {
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '/';
    breadcrumb.appendChild(sep);
    if (p.href) {
      const a = document.createElement('a');
      a.href = p.href;
      a.textContent = p.label;
      breadcrumb.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.className = 'current';
      span.textContent = p.label;
      breadcrumb.appendChild(span);
    }
  });
}

async function route() {
  try {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    if (parts.length === 0) return await renderYears();
    if (parts.length === 1) return await renderMonths(parseInt(parts[0], 10));
    if (parts.length === 2) return await renderDays(parseInt(parts[0], 10), parseInt(parts[1], 10));
    if (parts.length === 3) return await renderDayPage(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10));
    return await renderYears();
  } catch (e) {
    console.error('Route failed', e);
    showToast(friendlyError(e));
  }
}

// ---------------- Views ----------------

async function renderYears() {
  setBreadcrumb([]);
  main.innerHTML = `<h1 class="list-title">Years</h1><div class="entry-grid" id="grid">Loading…</div>`;
  const ids = await fetchAllDayIds();
  const years = new Set(ids.map(id => id.slice(0, 4)));
  const currentYear = new Date().getFullYear();
  years.add(String(currentYear));
  const sorted = [...years].sort().reverse();

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  sorted.forEach(year => {
    const count = ids.filter(id => id.startsWith(year)).length;
    const a = document.createElement('a');
    a.className = 'grid-card' + (year === String(currentYear) ? ' today' : '');
    a.href = `#/${year}`;
    a.innerHTML = `<span class="primary">${year}</span><span class="secondary">${count} ${count === 1 ? 'entry day' : 'entry days'}</span>`;
    grid.appendChild(a);
  });
}

async function renderMonths(year) {
  setBreadcrumb([{ label: String(year) }]);
  main.innerHTML = `<h1 class="list-title">${year}</h1><div class="entry-grid" id="grid">Loading…</div>`;
  const ids = await fetchAllDayIds();
  const now = new Date();
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (let m = 1; m <= 12; m++) {
    const prefix = `${year}-${pad(m)}`;
    const count = ids.filter(id => id.startsWith(prefix)).length;
    const isCurrent = year === now.getFullYear() && m === now.getMonth() + 1;
    const a = document.createElement('a');
    a.className = 'grid-card' + (isCurrent ? ' today' : '') + (count === 0 ? ' empty' : '');
    a.href = `#/${year}/${m}`;
    a.innerHTML = `<span class="primary">${MONTH_NAMES[m - 1]}</span><span class="secondary">${count ? count + (count === 1 ? ' entry day' : ' entry days') : 'no entries yet'}</span>`;
    grid.appendChild(a);
  }
}

async function renderDays(year, month) {
  setBreadcrumb([
    { label: String(year), href: `#/${year}` },
    { label: MONTH_NAMES[month - 1] }
  ]);
  main.innerHTML = `<h1 class="list-title">${MONTH_NAMES[month - 1]} ${year}</h1><div class="entry-grid" id="grid">Loading…</div>`;
  const ids = await fetchAllDayIds();
  const prefix = `${year}-${pad(month)}`;
  const dayDocs = new Map(ids.filter(id => id.startsWith(prefix)).map(id => [id, true]));
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = todayId();

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const dayId = `${year}-${pad(month)}-${pad(d)}`;
    const date = new Date(year, month - 1, d);
    const has = dayDocs.has(dayId);
    const a = document.createElement('a');
    a.className = 'grid-card' + (dayId === todayStr ? ' today' : '') + (has ? '' : ' empty');
    a.href = `#/${year}/${month}/${d}`;
    a.innerHTML = `<span class="primary">${DAY_NAMES[date.getDay()].slice(0,3)} ${d}</span><span class="secondary">${has ? 'logged' : '—'}</span>`;
    grid.appendChild(a);
  }
}

async function renderDayPage(year, month, day) {
  const dayId = `${year}-${pad(month)}-${pad(day)}`;
  const date = new Date(year, month - 1, day);

  setBreadcrumb([
    { label: String(year), href: `#/${year}` },
    { label: MONTH_NAMES[month - 1], href: `#/${year}/${month}` },
    { label: String(day) }
  ]);

  main.innerHTML = `
    <div class="day-header">
      <h1 class="day-title">${MONTH_NAMES[month - 1]} ${day}, ${year}</h1>
      <div class="day-subtitle">${DAY_NAMES[date.getDay()]} · Week ${weekNumber(date)}</div>
      <div class="day-meta" id="day-meta">
        <span class="meta-badge city"><span class="icon">📍</span> locating…</span>
        <span class="meta-badge weather"><span class="icon">🌡️</span> checking weather…</span>
      </div>
    </div>

    <div class="composer">
      <textarea id="entry-text" placeholder="What happened…"></textarea>
      <div class="composer-actions" id="composer-actions">
        <div class="action-buttons">
          <button class="btn checkin" id="btn-checkin"><span>📌</span> Check in</button>
          <label class="btn photo" for="photo-input"><span>🖼️</span> Add photo</label>
          <input type="file" id="photo-input" accept="image/*" capture="environment">
        </div>
        <button class="btn save" id="btn-save">Save entry</button>
      </div>

      <div class="tag-step" id="tag-step" hidden>
        <div class="tag-step-label">Tag this entry <span class="tag-step-hint">(optional — press Enter or comma to add)</span></div>
        <div class="tag-chips" id="tag-chips"></div>
        <input type="text" id="tag-input" list="tag-suggestions" placeholder="e.g. work, hike, family">
        <datalist id="tag-suggestions"></datalist>
        <div class="tag-step-actions">
          <button class="btn" id="btn-tag-cancel" type="button">Cancel</button>
          <button class="btn save" id="btn-tag-confirm" type="button">Save entry</button>
        </div>
      </div>
    </div>

    <div class="timeline" id="timeline">Loading…</div>

    <div class="day-nav">
      <a href="#${prevDayHash(year, month, day)}">← Previous day</a>
      <a href="#${nextDayHash(year, month, day)}">Next day →</a>
    </div>
  `;

  const dayDoc = await ensureDayDoc(dayId);
  renderMeta(dayDoc);
  await loadTimeline(dayId);

  // Lazily tag city + capture weather if not already set (fires geolocation prompt once)
  tagCityIfMissing(dayId, dayDoc).then(city => {
    if (city) updateMetaBadge('city', '📍', city);
    else updateMetaBadge('city', '📍', 'location unavailable');
  });
  captureWeatherIfMissing(dayId, dayDoc).then(weather => {
    if (weather) updateMetaBadge('weather', weather.icon, `${weather.tempF}°F · ${weather.condition} (noon)`);
    else updateMetaBadge('weather', '🌡️', 'weather unavailable');
  });

  // ---- Text entry + tag step ----
  const composerActions = document.getElementById('composer-actions');
  const tagStep = document.getElementById('tag-step');
  const tagChipsEl = document.getElementById('tag-chips');
  const tagInput = document.getElementById('tag-input');
  const tagSuggestions = document.getElementById('tag-suggestions');

  let pendingTags = [];
  let tagCache = null; // past tags, fetched once and reused/updated for this page view

  function renderTagChips() {
    tagChipsEl.innerHTML = '';
    pendingTags.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      const label = document.createElement('span');
      label.textContent = tag;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
      removeBtn.dataset.i = String(i);
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      tagChipsEl.appendChild(chip);
    });
  }

  function addPendingTag(raw) {
    const tag = raw.trim().toLowerCase();
    if (!tag) return;
    if (!pendingTags.includes(tag)) pendingTags.push(tag);
    renderTagChips();
  }

  function refreshSuggestions() {
    tagSuggestions.innerHTML = (tagCache || []).map(t => `<option value="${t}"></option>`).join('');
  }

  function openTagStep() {
    pendingTags = [];
    renderTagChips();
    tagInput.value = '';
    composerActions.hidden = true;
    tagStep.hidden = false;
    tagInput.focus();
  }

  function closeTagStep() {
    tagStep.hidden = true;
    composerActions.hidden = false;
  }

  document.getElementById('btn-save').addEventListener('click', async () => {
    const textEl = document.getElementById('entry-text');
    const text = textEl.value.trim();
    if (!text) return;
    openTagStep();
    if (!tagCache) {
      tagCache = await fetchAllTags();
      refreshSuggestions();
    }
  });

  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addPendingTag(tagInput.value);
      tagInput.value = '';
    }
  });

  tagChipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    pendingTags.splice(Number(btn.dataset.i), 1);
    renderTagChips();
  });

  document.getElementById('btn-tag-cancel').addEventListener('click', () => {
    closeTagStep();
  });

  document.getElementById('btn-tag-confirm').addEventListener('click', async () => {
    if (tagInput.value.trim()) addPendingTag(tagInput.value);
    const textEl = document.getElementById('entry-text');
    const text = textEl.value.trim();
    if (!text) { closeTagStep(); return; }
    try {
      await addEntry(dayId, { type: 'text', text, tags: pendingTags });
      textEl.value = '';
      if (tagCache) {
        pendingTags.forEach(t => { if (!tagCache.includes(t)) tagCache.push(t); });
        tagCache.sort((a, b) => a.localeCompare(b));
        refreshSuggestions();
      }
      pendingTags = [];
      closeTagStep();
      showToast('Entry saved');
      loadTimeline(dayId);
    } catch (err) {
      console.error(err);
      showToast(friendlyError(err));
    }
  });

  document.getElementById('btn-checkin').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Checking in…';
    try {
      const { lat, lng } = await getPosition();
      const place = await reverseGeocode(lat, lng);
      await addEntry(dayId, { type: 'checkin', location: { lat, lng, label: place } });
      showToast('Checked in at ' + place);
      loadTimeline(dayId);
    } catch (err) {
      showToast(friendlyError(err));
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>📌</span> Check in';
    }
  });

  document.getElementById('photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast('Uploading photo…');
    try {
      const path = `${STORAGE_PREFIX}/${dayId}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await addEntry(dayId, { type: 'photo', photoURL: url });
      showToast('Photo added');
      loadTimeline(dayId);
    } catch (err) {
      console.error(err);
      showToast(friendlyError(err));
    }
    e.target.value = '';
  });
}

function renderMeta(dayDoc) {
  if (dayDoc.city) updateMetaBadge('city', '📍', dayDoc.city);
  if (dayDoc.weather) updateMetaBadge('weather', dayDoc.weather.icon, `${dayDoc.weather.tempF}°F · ${dayDoc.weather.condition} (noon)`);
}

function updateMetaBadge(kind, icon, text) {
  const el = document.querySelector(`.meta-badge.${kind}`);
  if (el) el.innerHTML = `<span class="icon">${icon}</span> ${text}`;
}

async function loadTimeline(dayId) {
  const timeline = document.getElementById('timeline');
  const entries = await fetchEntries(dayId);
  if (entries.length === 0) {
    timeline.innerHTML = `<div class="empty-state">Nothing logged yet — add a note, check in, or drop a photo above.</div>`;
    return;
  }
  timeline.innerHTML = '';
  entries.forEach(entry => {
    const item = document.createElement('div');
    item.className = `timeline-item ${entry.type}`;
    const time = document.createElement('div');
    time.className = 'timeline-time';
    time.textContent = fmtTime(entry.timestamp);
    item.appendChild(time);

    const body = document.createElement('div');
    body.className = 'timeline-body';

    if (entry.type === 'text') {
      body.classList.add('text-entry');
      const p = document.createElement('p');
      p.textContent = entry.text;
      body.appendChild(p);
      if (Array.isArray(entry.tags) && entry.tags.length) {
        const tagsWrap = document.createElement('div');
        tagsWrap.className = 'entry-tags';
        entry.tags.forEach(t => {
          const span = document.createElement('span');
          span.className = 'entry-tag';
          span.textContent = `#${t}`;
          tagsWrap.appendChild(span);
        });
        body.appendChild(tagsWrap);
      }
    } else if (entry.type === 'checkin') {
      body.innerHTML = `
        <div class="stamp">
          <div class="stamp-ring">📌</div>
          <div class="stamp-text">
            <div class="label">Check-in</div>
            <div class="place">${entry.location?.label || 'Unknown location'}</div>
          </div>
        </div>`;
    } else if (entry.type === 'photo') {
      body.classList.add('photo-entry');
      const img = document.createElement('img');
      img.src = entry.photoURL;
      img.alt = 'Logged photo';
      body.appendChild(img);
    }
    item.appendChild(body);
    timeline.appendChild(item);
  });
}

function prevDayHash(year, month, day) {
  const d = new Date(year, month - 1, day - 1);
  return `/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function nextDayHash(year, month, day) {
  const d = new Date(year, month - 1, day + 1);
  return `/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------------- Auth gate ----------------

// signInWithPopup is used instead of signInWithRedirect because Safari's
// tracking prevention partitions storage across a full-page redirect to
// accounts.google.com and back, silently losing the auth handshake (no
// error thrown — onAuthStateChanged just never fires with a user). A
// popup keeps everything in the same tab context and talks back via
// postMessage, which Safari handles reliably.
document.getElementById('btn-google-signin').addEventListener('click', async () => {
  signinError.textContent = '';
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    // onAuthStateChanged below picks up the signed-in user from here.
  } catch (e) {
    console.error('Sign-in popup failed', e);
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      // Fall back to redirect only if the popup itself couldn't open
      // (e.g. a strict popup blocker) — better than a dead button.
      try {
        await signInWithRedirect(auth, new GoogleAuthProvider());
      } catch (e2) {
        console.error('Sign-in redirect fallback failed', e2);
        signinError.textContent = 'Sign-in failed — please try again.';
      }
    } else if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
      // User closed the picker themselves — not a real error, stay quiet.
    } else {
      signinError.textContent = `Sign-in failed: ${e.code || 'please try again.'}`;
    }
  }
});

// Still handled in case the redirect fallback above was used.
getRedirectResult(auth).catch((e) => {
  console.error('Sign-in failed on return from redirect', e);
  signinError.textContent = `Sign-in failed: ${e.code || 'please try again.'}`;
});

document.getElementById('btn-signout').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    signinScreen.hidden = true;
    appShell.hidden = false;
    route();
  } else {
    signinScreen.hidden = false;
    appShell.hidden = true;
  }
});

window.addEventListener('hashchange', () => {
  if (!appShell.hidden) route();
});
