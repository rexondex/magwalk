(function () {
  const DEFAULT_CENTER = [37.5665, 126.978];
  const DEFAULT_ZOOM = 16;
  const COLLECT_INTERVAL_MS = 1000;
  const HIGHLIGHT_INTERVAL = 10;

  const elements = {
    permissionButton: document.querySelector('#btn-permission'),
    onButton: document.querySelector('#btn-on'),
    offButton: document.querySelector('#btn-off'),
    logBoard: document.querySelector('#log-board'),
    latitude: document.querySelector('#latitude'),
    longitude: document.querySelector('#longitude'),
    accuracy: document.querySelector('#accuracy'),
    count: document.querySelector('#location-count'),
  };

  const state = {
    map: null,
    marker: null,
    pathLine: null,
    pathCoordinates: [],
    collectTimerId: null,
    isCollecting: false,
    isReadingLocation: false,
    locationCount: 0,
  };

  function initMap(center = DEFAULT_CENTER) {
    if (state.map) {
      state.map.invalidateSize();
      return;
    }

    state.map = L.map('map').setView(center, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(state.map);

    state.pathLine = L.polyline([], {
      color: '#16a34a',
      weight: 5,
      opacity: 0.9,
    }).addTo(state.map);

    state.marker = L.marker(center).addTo(state.map);
  }

  function addLog(message, isHighlight = false) {
    const row = document.createElement('p');
    row.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;

    if (isHighlight) {
      row.className = 'highlight-db';
    }

    elements.logBoard.appendChild(row);
    elements.logBoard.scrollTop = elements.logBoard.scrollHeight;
  }

  function updateMetrics(location) {
    elements.latitude.textContent = location.lat.toFixed(6);
    elements.longitude.textContent = location.lng.toFixed(6);
    elements.accuracy.textContent = `${Math.round(location.accuracy)}m`;
    elements.count.textContent = String(state.locationCount);
  }

  function toLocation(position) {
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
  }

  function applyLocation(location) {
    const currentLatLng = [location.lat, location.lng];
    state.locationCount += 1;
    state.pathCoordinates.push(currentLatLng);

    state.pathLine.setLatLngs(state.pathCoordinates);
    state.marker.setLatLng(currentLatLng);
    state.map.panTo(currentLatLng);
    updateMetrics(location);

    const message = `Location collected | Lat: ${location.lat.toFixed(5)}, Lng: ${location.lng.toFixed(
      5
    )}`;

    if (state.locationCount % HIGHLIGHT_INTERVAL === 0) {
      addLog(`${message} | DB saved highlight`, true);
      return;
    }

    addLog(message);
  }

  function readCurrentPosition(onSuccess, onFailure = () => {}) {
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (error) => {
        addLog(`Location error: ${error.message}`);
        onFailure(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      }
    );
  }

  function requestPermission() {
    if (!navigator.geolocation) {
      addLog('This browser does not support Geolocation.');
      return;
    }

    readCurrentPosition((position) => {
      const location = toLocation(position);
      initMap([location.lat, location.lng]);
      state.marker.setLatLng([location.lat, location.lng]);
      state.map.panTo([location.lat, location.lng]);
      updateMetrics(location);
      addLog('Location permission is available.');
      elements.onButton.disabled = false;
    });
  }

  function collectOnce() {
    if (!state.isCollecting || state.isReadingLocation) {
      return;
    }

    state.isReadingLocation = true;
    readCurrentPosition((position) => {
      state.isReadingLocation = false;
      applyLocation(toLocation(position));
    }, () => {
      state.isReadingLocation = false;
    });
  }

  function startCollecting() {
    if (state.isCollecting) {
      return;
    }

    if (!state.map) {
      initMap();
    }

    state.isCollecting = true;
    elements.onButton.disabled = true;
    elements.offButton.disabled = false;
    addLog('Location collection started.');
    collectOnce();
    state.collectTimerId = window.setInterval(collectOnce, COLLECT_INTERVAL_MS);
  }

  function stopCollecting() {
    if (state.collectTimerId) {
      window.clearInterval(state.collectTimerId);
    }

    state.collectTimerId = null;
    state.isCollecting = false;
    state.isReadingLocation = false;
    elements.onButton.disabled = false;
    elements.offButton.disabled = true;
    addLog('Location collection stopped.');
  }

  elements.permissionButton.addEventListener('click', requestPermission);
  elements.onButton.addEventListener('click', startCollecting);
  elements.offButton.addEventListener('click', stopCollecting);

  initMap();

  window.MagwalkLeafletLocationView = {
    start: startCollecting,
    stop: stopCollecting,
    requestPermission,
  };
})();
