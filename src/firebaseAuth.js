import { firebaseApiKey } from './firebaseConfig.js?v=2';

const authKey = 'daily-scripture-firebase-auth-v1';
const expiryBufferMs = 60 * 1000;
const requestTimeoutMs = 10000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function cleanApiKey() {
  return String(firebaseApiKey || '').trim();
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(authKey) || 'null');
  } catch {
    return null;
  }
}

function writeSession(data) {
  localStorage.setItem(authKey, JSON.stringify(data));
}

function sessionFromResponse(data) {
  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 0) * 1000 - expiryBufferMs,
  };
}

async function requestAuthJson(url, body) {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Firebase Auth failed (${response.status})`);
  return response.json();
}

async function createAnonymousSession(apiKey) {
  const data = await requestAuthJson(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    returnSecureToken: true,
  });
  return sessionFromResponse(data);
}

async function refreshSession(apiKey, refreshToken) {
  const response = await fetchWithTimeout(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) throw new Error(`Firebase Auth refresh failed (${response.status})`);
  const data = await response.json();
  return sessionFromResponse({
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  });
}

export async function getFirebaseAuthToken() {
  const apiKey = cleanApiKey();
  if (!apiKey) throw new Error('Firebase API key is missing');

  const saved = readSession();
  if (saved?.idToken && saved.expiresAt > Date.now()) return saved.idToken;

  let session = null;
  if (saved?.refreshToken) {
    try {
      session = await refreshSession(apiKey, saved.refreshToken);
    } catch {
      session = null;
    }
  }

  if (!session) session = await createAnonymousSession(apiKey);
  writeSession(session);
  return session.idToken;
}
