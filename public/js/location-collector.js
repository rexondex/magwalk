(function () {
  const COLLECT_INTERVAL_MS = 3000;
  const LOCATION_QUEUE_DB_NAME = 'magwalk-location-queue';
  const LOCATION_QUEUE_STORE_NAME = 'locations';
  const LOCATION_SYNC_TAG = 'magwalk-location-sync';
  const SAVE_TIMEOUT_MS = 20000;
  const QUEUE_FLUSH_TIMEOUT_MS = 30000;
  const STALE_FIX_MAX_AGE_MS = 30000;
  const MIN_COMMIT_DISTANCE_METERS = 2;
  const STATIONARY_HEARTBEAT_MS = 60000;
  const MAX_CLIENT_ACCURACY_METERS = 5000;
  const MAX_REASONABLE_SPEED_MPS = 15;
  const MAX_QUEUED_LOCATIONS = 20000;
  const SKIP_STATUS_INTERVAL_MS = 15000;

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
    constructor({
      onStatus,
      onLocation,
      onSaved,
      onQueued,
      onQueueUpdate,
      onError,
      onPermission,
      onAuthExpired,
    }) {
      this.onStatus = onStatus;
      this.onLocation = onLocation;
      this.onSaved = onSaved;
      this.onQueued = onQueued;
      this.onQueueUpdate = onQueueUpdate;
      this.onError = onError;
      this.onPermission = onPermission;
      this.onAuthExpired = onAuthExpired;
      this.collectTimerId = null;
      this.watchId = null;
      this.isCollecting = false;
      this.isSaving = false;
      this.isFlushingQueue = false;
      this.lastLocation = null;
      this.lastCommittedLocation = null;
      this.lastSkipStatusAt = 0;
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
      this.lastCommittedLocation = null;
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
      this.lastCommittedLocation = null;
      this.onStatus('Location collection is OFF.');
    }

    startWatching() {
      if (this.watchId !== null) {
        return;
      }

      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          const location = this.positionToPayload(position);

          if (!this.isUsableLocation(location)) {
            this.reportSkippedLocation('Ignored unstable GPS fix.');
            return;
          }

          if (this.isImpossibleJump(location)) {
            this.reportSkippedLocation('Ignored GPS jump that is too large for walking.');
            return;
          }

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

      if (this.isStaleFix(this.lastLocation)) {
        this.reportSkippedLocation('Waiting for a fresh GPS fix before DB commit.');
        return;
      }

      const nextLocation = {
        ...this.lastLocation,
        collectedAt: new Date().toISOString(),
      };

      if (this.shouldSkipStationaryCommit(nextLocation)) {
        this.reportSkippedLocation('Location unchanged; keeping DB writes sparse while stationary.');
        return;
      }

      this.saveLocation(nextLocation);
    }

    async saveLocation(location) {
      if (this.isSaving) {
        return;
      }

      this.isSaving = true;

      try {
        const response = await this.fetchWithTimeout('/api/location', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(location),
        }, SAVE_TIMEOUT_MS);

        if (response.status === 401) {
          this.onAuthExpired?.();
          return;
        }

        if (response.status === 400) {
          const result = await this.safeJson(response);
          this.onError(result.message || 'Invalid location ignored before DB save.');
          return;
        }

        if (response.status === 409) {
          this.markCommitted(location);
          this.onStatus('Duplicate location ignored.');
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to save location to DB.');
        }

        const result = await response.json();

        if (!this.isUsableLocation(result)) {
          throw new Error('DB returned an invalid location response.');
        }

        this.markCommitted(location);
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

      if (!this.isUsableLocation(location)) {
        throw new Error('Invalid location was not queued.');
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
      await this.trimQueueRecords(db);
      await this.reportQueueCount(db);
      await this.registerBackgroundSync();
      this.markCommitted(payload);
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

        const validRecords = records.filter((record) => this.isUsableLocation(record?.payload));
        const invalidRecordIds = records
          .filter((record) => !this.isUsableLocation(record?.payload))
          .map((record) => record.id)
          .filter(Boolean);

        if (invalidRecordIds.length) {
          await this.deleteQueueRecords(db, invalidRecordIds);
          this.onStatus(`Removed ${invalidRecordIds.length} invalid queued locations.`);
        }

        if (!validRecords.length) {
          await this.reportQueueCount(db);
          return;
        }

        this.onQueueUpdate?.(validRecords.length);

        const sentIds = [];
        const savedLocations = [];

        for (let index = 0; index < validRecords.length; index += 100) {
          const batch = validRecords.slice(index, index + 100);
          const response = await this.fetchWithTimeout('/api/location/bulk', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locations: batch.map((record) => record.payload) }),
          }, QUEUE_FLUSH_TIMEOUT_MS);

          if (response.status === 401) {
            this.onAuthExpired?.();
            return;
          }

          if (!response.ok) {
            throw new Error('Queued location sync failed.');
          }

          const result = await this.safeJson(response);
          const acceptedIds = Array.isArray(result.acceptedIds) ? result.acceptedIds : [];
          const rejectedIds = Array.isArray(result.rejectedIds) ? result.rejectedIds : [];
          const deletableIds = [...acceptedIds, ...rejectedIds].filter((id) =>
            batch.some((record) => record.id === id)
          );

          savedLocations.push(...(Array.isArray(result.saved) ? result.saved.filter((saved) => this.isUsableLocation(saved)) : []));
          sentIds.push(...(deletableIds.length ? deletableIds : batch.map((record) => record.id)));
        }

        await this.deleteQueueRecords(db, [...new Set(sentIds)]);
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

    async fetchWithTimeout(url, options, timeoutMs) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

      try {
        return await fetch(url, {
          ...options,
          signal: controller.signal,
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new Error('Network request timed out.');
        }

        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    async safeJson(response) {
      try {
        return await response.json();
      } catch (error) {
        return {};
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

    async trimQueueRecords(db) {
      const count = await this.countQueueRecords(db);

      if (count <= MAX_QUEUED_LOCATIONS) {
        return;
      }

      const records = await this.getAllQueueRecords(db);
      const removeCount = records.length - MAX_QUEUED_LOCATIONS;
      const idsToRemove = records
        .sort((left, right) => new Date(left.queuedAt).getTime() - new Date(right.queuedAt).getTime())
        .slice(0, removeCount)
        .map((record) => record.id);

      await this.deleteQueueRecords(db, idsToRemove);
      this.onStatus(`Offline queue trimmed: ${idsToRemove.length} oldest locations removed.`);
    }

    markCommitted(location) {
      this.lastCommittedLocation = {
        ...location,
        committedAt: Date.now(),
      };
    }

    reportSkippedLocation(message) {
      const now = Date.now();

      if (now - this.lastSkipStatusAt < SKIP_STATUS_INTERVAL_MS) {
        return;
      }

      this.lastSkipStatusAt = now;
      this.onStatus(message);
    }

    isUsableLocation(location) {
      if (!location) {
        return false;
      }

      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      const accuracy = location.accuracy === null || location.accuracy === undefined ? null : Number(location.accuracy);
      const collectedTime = new Date(location.collectedAt || Date.now()).getTime();

      return (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180 &&
        (accuracy === null || (Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= MAX_CLIENT_ACCURACY_METERS)) &&
        !Number.isNaN(collectedTime)
      );
    }

    isStaleFix(location) {
      const sourceTime = new Date(location.sourceAt || location.collectedAt).getTime();
      return Number.isNaN(sourceTime) || Date.now() - sourceTime > STALE_FIX_MAX_AGE_MS;
    }

    isImpossibleJump(location) {
      if (!this.lastLocation) {
        return false;
      }

      const currentTime = new Date(location.sourceAt || location.collectedAt).getTime();
      const previousTime = new Date(this.lastLocation.sourceAt || this.lastLocation.collectedAt).getTime();
      const elapsedSeconds = Math.max((currentTime - previousTime) / 1000, 1);
      const distance = this.distanceMeters(this.lastLocation, location);
      const accuracyBuffer = Number(this.lastLocation.accuracy || 0) + Number(location.accuracy || 0);
      const allowedDistance = Math.max(100, accuracyBuffer + MAX_REASONABLE_SPEED_MPS * elapsedSeconds);

      return distance > allowedDistance;
    }

    shouldSkipStationaryCommit(location) {
      if (!this.lastCommittedLocation) {
        return false;
      }

      const elapsedMs = Date.now() - this.lastCommittedLocation.committedAt;
      const distance = this.distanceMeters(this.lastCommittedLocation, location);

      return distance < MIN_COMMIT_DISTANCE_METERS && elapsedMs < STATIONARY_HEARTBEAT_MS;
    }

    distanceMeters(from, to) {
      const earthRadiusMeters = 6371000;
      const fromLatitude = Number(from.latitude) * Math.PI / 180;
      const toLatitude = Number(to.latitude) * Math.PI / 180;
      const deltaLatitude = (Number(to.latitude) - Number(from.latitude)) * Math.PI / 180;
      const deltaLongitude = (Number(to.longitude) - Number(from.longitude)) * Math.PI / 180;
      const halfChord =
        Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
        Math.cos(fromLatitude) * Math.cos(toLatitude) *
          Math.sin(deltaLongitude / 2) * Math.sin(deltaLongitude / 2);

      return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord));
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
        sourceAt: new Date(position.timestamp || Date.now()).toISOString(),
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
