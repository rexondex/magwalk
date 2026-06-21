(function () {
  const COLLECT_INTERVAL_MS = 3000;
  const LOCATION_QUEUE_DB_NAME = 'magwalk-location-queue';
  const LOCATION_QUEUE_STORE_NAME = 'locations';
  const LOCATION_SYNC_TAG = 'magwalk-location-sync';

  function createLocationId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (char) => {
      const random = Math.floor(Math.random() * 16);
      return (Number(char) ^ (random >> (Number(char) / 4))).toString(16);
    });
  }

  class LocationCollector {
    constructor({ onStatus, onLocation, onSaved, onQueued, onQueueUpdate, onError, onPermission }) {
      this.onStatus = onStatus;
      this.onLocation = onLocation;
      this.onSaved = onSaved;
      this.onQueued = onQueued;
      this.onQueueUpdate = onQueueUpdate;
      this.onError = onError;
      this.onPermission = onPermission;
      this.collectTimerId = null;
      this.watchId = null;
      this.isCollecting = false;
      this.isSaving = false;
      this.isFlushingQueue = false;
      this.lastLocation = null;
      this.bindQueueRecoveryEvents();
    }

    requestPermission() {
      if (!this.canUseGeolocation()) {
        return;
      }

      this.onStatus('Requesting browser location permission.');
      navigator.geolocation.getCurrentPosition(
        () => {
          this.onPermission?.(true);
          this.onStatus('Location permission is available.');
        },
        (error) => {
          this.onPermission?.(false);
          this.handleError(error);
        },
        this.positionOptions()
      );
    }

    start() {
      if (this.isCollecting) {
        this.onStatus('Location collection is already ON.');
        return true;
      }

      if (!this.canUseGeolocation()) {
        return false;
      }

      this.isCollecting = true;
      this.lastLocation = null;
      this.onStatus('Watching location. Waiting for first GPS fix.');
      this.startWatching();
      this.collectTimerId = window.setInterval(() => this.commitLatestLocation(), COLLECT_INTERVAL_MS);
      this.flushQueuedLocations();
      return true;
    }

    stop() {
      if (this.collectTimerId) {
        window.clearInterval(this.collectTimerId);
      }

      if (this.watchId !== null) {
        navigator.geolocation.clearWatch(this.watchId);
      }

      this.collectTimerId = null;
      this.watchId = null;
      this.isCollecting = false;
      this.lastLocation = null;
      this.onStatus('Location collection is OFF.');
    }

    startWatching() {
      if (this.watchId !== null) {
        return;
      }

      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          const location = this.positionToPayload(position);
          this.lastLocation = location;
          this.onLocation(location);
          this.onStatus('Location watch is active. Committing latest fix every 3s.');
        },
        (error) => {
          this.handleError(error);
        },
        this.positionOptions()
      );
    }

    commitLatestLocation() {
      if (!this.isCollecting) {
        return;
      }

      if (!this.lastLocation) {
        this.onStatus('Waiting for mobile GPS fix before first DB commit.');
        return;
      }

      this.saveLocation({
        ...this.lastLocation,
        collectedAt: new Date().toISOString(),
      });
    }

    async saveLocation(location) {
      if (this.isSaving) {
        return;
      }

      this.isSaving = true;

      try {
        const response = await fetch('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(location),
        });

        if (!response.ok) {
          throw new Error('Failed to save location to DB.');
        }

        const result = await response.json();
        this.onSaved(result);
        this.flushQueuedLocations();
      } catch (error) {
        try {
          await this.queueLocation(location);
          this.onQueued?.(location);
          this.onError(`${error.message} Location queued for background sync.`);
        } catch (queueError) {
          this.onError(`${error.message} Offline queue failed: ${queueError.message}`);
        }
      } finally {
        this.isSaving = false;
      }
    }

    async queueLocation(location) {
      if (!('indexedDB' in window)) {
        throw new Error('IndexedDB is unavailable. Offline location queue cannot be used.');
      }

      const payload = {
        ...location,
        id: location.id || createLocationId(),
      };
      const db = await this.openQueueDb();
      const record = {
        id: payload.id,
        payload,
        queuedAt: new Date().toISOString(),
      };

      await this.putQueueRecord(db, record);
      await this.reportQueueCount(db);
      await this.registerBackgroundSync();
    }

    async flushQueuedLocations() {
      if (this.isFlushingQueue || !('indexedDB' in window)) {
        return;
      }

      this.isFlushingQueue = true;

      try {
        const db = await this.openQueueDb();
        const records = await this.getAllQueueRecords(db);

        if (!records.length) {
          this.onQueueUpdate?.(0);
          return;
        }

        this.onQueueUpdate?.(records.length);

        const sentIds = [];
        const savedLocations = [];

        for (let index = 0; index < records.length; index += 100) {
          const batch = records.slice(index, index + 100);
          const response = await fetch('/api/location/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locations: batch.map((record) => record.payload) }),
          });

          if (!response.ok) {
            throw new Error('Queued location sync failed.');
          }

          const result = await response.json();
          savedLocations.push(...(result.saved || []));
          sentIds.push(...batch.map((record) => record.id));
        }

        await this.deleteQueueRecords(db, sentIds);
        await this.reportQueueCount(db);

        savedLocations.forEach((location) => this.onSaved(location));

        if (sentIds.length) {
          this.onStatus(`Queued location sync completed: ${sentIds.length} records.`);
        }
      } catch (error) {
        await this.registerBackgroundSync();
        this.onStatus(`Queued location sync is waiting: ${error.message}`);
      } finally {
        this.isFlushingQueue = false;
      }
    }

    bindQueueRecoveryEvents() {
      window.addEventListener('online', () => {
        this.onStatus('Network is online. Syncing queued locations.');
        this.flushQueuedLocations();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.flushQueuedLocations();
        }
      });
    }

    async registerBackgroundSync() {
      if (!('serviceWorker' in navigator)) {
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;

        if ('sync' in registration) {
          await registration.sync.register(LOCATION_SYNC_TAG);
          return;
        }

        navigator.serviceWorker.controller?.postMessage({ type: 'MAGWALK_FLUSH_LOCATION_QUEUE' });
      } catch (error) {
        this.onStatus(`Background sync registration failed: ${error.message}`);
      }
    }

    openQueueDb() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(LOCATION_QUEUE_DB_NAME, 1);

        request.onupgradeneeded = () => {
          const db = request.result;

          if (!db.objectStoreNames.contains(LOCATION_QUEUE_STORE_NAME)) {
            db.createObjectStore(LOCATION_QUEUE_STORE_NAME, { keyPath: 'id' });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    putQueueRecord(db, record) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(LOCATION_QUEUE_STORE_NAME, 'readwrite');
        transaction.objectStore(LOCATION_QUEUE_STORE_NAME).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }

    getAllQueueRecords(db) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(LOCATION_QUEUE_STORE_NAME, 'readonly');
        const request = transaction.objectStore(LOCATION_QUEUE_STORE_NAME).getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    }

    deleteQueueRecords(db, ids) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(LOCATION_QUEUE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(LOCATION_QUEUE_STORE_NAME);

        ids.forEach((id) => store.delete(id));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }

    countQueueRecords(db) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(LOCATION_QUEUE_STORE_NAME, 'readonly');
        const request = transaction.objectStore(LOCATION_QUEUE_STORE_NAME).count();

        request.onsuccess = () => resolve(request.result || 0);
        request.onerror = () => reject(request.error);
      });
    }

    async reportQueueCount(db) {
      const count = await this.countQueueRecords(db);
      this.onQueueUpdate?.(count);
    }

    canUseGeolocation() {
      if ('geolocation' in navigator) {
        return true;
      }

      this.onError('This browser does not support location data.');
      return false;
    }

    positionOptions() {
      return {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000,
      };
    }

    positionToPayload(position) {
      return {
        id: createLocationId(),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        collectedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
      };
    }

    handleError(error) {
      const messageByCode = {
        1: 'Location permission was denied. Check browser site settings.',
        2: 'Current location is unavailable.',
        3: 'Location request timed out.',
      };

      this.onError(messageByCode[error.code] || 'Location collection failed.');
    }
  }

  window.LocationCollector = LocationCollector;
})();
