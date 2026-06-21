const CACHE_VERSION = 'magwalk-pwa-v1';
const APP_CACHE = `${CACHE_VERSION}-app`;
const LOCATION_SYNC_TAG = 'magwalk-location-sync';
const LOCATION_DB_NAME = 'magwalk-location-queue';
const LOCATION_STORE_NAME = 'locations';
const STATIC_ASSETS = [
  '/html/index.html',
  '/html/signin.html',
  '/html/signup.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/magwalk-icon.svg',
  '/icons/magwalk-maskable.svg',
  '/vendor/bootstrap/bootstrap.min.css',
  '/vendor/bootstrap/bootstrap.bundle.min.js',
  '/vendor/maplibre-gl/maplibre-gl.css?v=local',
  '/vendor/maplibre-gl/maplibre-gl.js?v=local',
  '/css/base.css',
  '/css/auth.css',
  '/css/landing.css',
  '/css/location.css',
  '/js/pwa.js',
  '/js/signin.js',
  '/js/signup.js',
  '/js/landing.js',
  '/js/location-collector.js',
  '/js/location-page.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (isStaticRequest(request, url)) {
    event.respondWith(handleStaticRequest(request));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === LOCATION_SYNC_TAG) {
    event.waitUntil(flushQueuedLocations());
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'MAGWALK_FLUSH_LOCATION_QUEUE') {
    event.waitUntil(flushQueuedLocations());
    return;
  }

  if (event.data?.type === 'MAGWALK_CLEAR_PRIVATE_CACHE') {
    event.waitUntil(clearPrivateNavigationCache());
  }
});

async function handleNavigationRequest(request) {
  const cache = await caches.open(APP_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok && response.type === 'basic' && !response.redirected) {
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    return (await cache.match(request)) || (await cache.match('/main')) || (await cache.match('/html/index.html'));
  }
}

async function handleStaticRequest(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }

      return response;
    })
    .catch(() => null);

  return cached || (await networkPromise) || Response.error();
}

function isStaticRequest(request, url) {
  return (
    ['style', 'script', 'image', 'font', 'manifest'].includes(request.destination) ||
    /\.(?:css|js|png|svg|webmanifest|ico)$/i.test(url.pathname)
  );
}

async function clearPrivateNavigationCache() {
  const cache = await caches.open(APP_CACHE);
  await cache.delete('/main');
}

async function flushQueuedLocations() {
  const db = await openLocationDb();
  const records = await getAllQueuedLocations(db);

  if (!records.length) {
    return;
  }

  const sentIds = [];

  for (let index = 0; index < records.length; index += 100) {
    const batch = records.slice(index, index + 100);
    const response = await fetch('/api/location/bulk', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: batch.map((record) => record.payload) })
    });

    if (!response.ok) {
      throw new Error('Location queue sync failed.');
    }

    sentIds.push(...batch.map((record) => record.id));
  }

  await deleteQueuedLocations(db, sentIds);
  await notifyClients({
    type: 'MAGWALK_LOCATION_QUEUE_FLUSHED',
    count: sentIds.length
  });
}

function openLocationDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCATION_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(LOCATION_STORE_NAME)) {
        db.createObjectStore(LOCATION_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllQueuedLocations(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LOCATION_STORE_NAME, 'readonly');
    const request = transaction.objectStore(LOCATION_STORE_NAME).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function deleteQueuedLocations(db, ids) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LOCATION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(LOCATION_STORE_NAME);

    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  clients.forEach((client) => client.postMessage(message));
}
