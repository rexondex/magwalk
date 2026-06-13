(function () {
  const COLLECT_INTERVAL_MS = 3000;

  class LocationCollector {
    constructor({ onStatus, onLocation, onSaved, onError }) {
      this.onStatus = onStatus;
      this.onLocation = onLocation;
      this.onSaved = onSaved;
      this.onError = onError;
      this.collectTimerId = null;
      this.isCollecting = false;
      this.isReadingLocation = false;
      this.isSaving = false;
    }

    requestPermission() {
      if (!this.canUseGeolocation()) {
        return;
      }

      this.onStatus('Requesting browser location permission.');
      navigator.geolocation.getCurrentPosition(
        () => {
          this.onStatus('Location permission is available.');
        },
        (error) => this.handleError(error),
        this.positionOptions()
      );
    }

    start() {
      if (this.isCollecting) {
        this.onStatus('Location collection is already ON.');
        return;
      }

      if (!this.canUseGeolocation()) {
        return;
      }

      this.isCollecting = true;
      this.onStatus('Collecting and committing every 3s.');
      this.collect();
      this.collectTimerId = window.setInterval(() => this.collect(), COLLECT_INTERVAL_MS);
    }

    stop() {
      if (this.collectTimerId) {
        window.clearInterval(this.collectTimerId);
      }

      this.collectTimerId = null;
      this.isCollecting = false;
      this.onStatus('Location collection is OFF.');
    }

    collect() {
      if (!this.isCollecting || this.isReadingLocation) {
        return;
      }

      this.isReadingLocation = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = this.positionToPayload(position);
          this.onLocation(location);
          this.isReadingLocation = false;
          this.saveLocation(location);
        },
        (error) => {
          this.isReadingLocation = false;
          this.handleError(error);
        },
        this.positionOptions()
      );
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
      } catch (error) {
        this.onError(error.message);
      } finally {
        this.isSaving = false;
      }
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
        maximumAge: 0,
        timeout: 5000,
      };
    }

    positionToPayload(position) {
      return {
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
