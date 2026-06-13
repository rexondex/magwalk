(function () {
  const permissionButton = document.querySelector('#permissionButton');
  const startButton = document.querySelector('#startButton');
  const stopButton = document.querySelector('#stopButton');
  const signoutButton = document.querySelector('#signoutButton');
  const permissionStatus = document.querySelector('#permissionStatus');
  const accountName = document.querySelector('#accountName');
  const latitude = document.querySelector('#latitude');
  const longitude = document.querySelector('#longitude');
  const accuracy = document.querySelector('#accuracy');
  const collectedAt = document.querySelector('#collectedAt');
  const lastCommit = document.querySelector('#lastCommit');
  const locationLog = document.querySelector('#locationLog');
  const pathCount = document.querySelector('#pathCount');

  const mapState = {
    map: null,
    marker: null,
    pathLine: null,
    coordinates: [],
  };

  function formatNumber(value) {
    return Number(value).toFixed(6);
  }

  function formatAccuracy(value) {
    return value === null || value === undefined ? '-' : `${Math.round(value)}m`;
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(value));
  }

  function appendLog(text, className) {
    const item = document.createElement('li');
    item.textContent = text;

    if (className) {
      item.classList.add(className);
    }

    locationLog.prepend(item);
  }

  function setStatus(message) {
    permissionStatus.textContent = message;
  }

  function initMap() {
    if (mapState.map || !window.L) {
      return;
    }

    const defaultCenter = [37.5665, 126.978];
    mapState.map = L.map('locationMap').setView(defaultCenter, 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapState.map);

    mapState.pathLine = L.polyline([], {
      color: '#16a34a',
      opacity: 0.9,
      weight: 5,
    }).addTo(mapState.map);

    mapState.marker = L.marker(defaultCenter).addTo(mapState.map);
  }

  function updatePathCount() {
    pathCount.textContent = `${mapState.coordinates.length} points`;
  }

  function addLocationToMap(location, shouldPan = true) {
    if (!mapState.map) {
      initMap();
    }

    if (!mapState.map) {
      return;
    }

    const latitudeValue = Number(location.latitude);
    const longitudeValue = Number(location.longitude);

    if (!Number.isFinite(latitudeValue) || !Number.isFinite(longitudeValue)) {
      return;
    }

    const latLng = [latitudeValue, longitudeValue];
    mapState.coordinates.push(latLng);
    mapState.pathLine.setLatLngs(mapState.coordinates);
    mapState.marker.setLatLng(latLng);
    updatePathCount();

    if (shouldPan) {
      mapState.map.panTo(latLng);
      return;
    }

    if (mapState.coordinates.length > 1) {
      mapState.map.fitBounds(mapState.pathLine.getBounds(), { padding: [24, 24] });
      return;
    }

    mapState.map.setView(latLng, 16);
  }

  async function loadLocationHistory() {
    const response = await fetch('/api/location');

    if (!response.ok) {
      return;
    }

    const logs = await response.json();
    logs.reverse().forEach((location) => addLocationToMap(location, false));
  }

  async function loadCurrentUser() {
    const response = await fetch('/api/me');

    if (!response.ok) {
      window.location.href = '/signin';
      return false;
    }

    const result = await response.json();
    accountName.textContent = result.user.username;
    return true;
  }

  function renderLocation(location) {
    latitude.textContent = formatNumber(location.latitude);
    longitude.textContent = formatNumber(location.longitude);
    accuracy.textContent = formatAccuracy(location.accuracy);
    collectedAt.textContent = formatTime(location.collectedAt);
  }

  function renderSaved(result) {
    const savedAt = result.collectedAt || new Date();
    lastCommit.textContent = formatTime(savedAt);
    addLocationToMap(result);
    appendLog(
      `${formatTime(savedAt)} | DB committed | lat ${formatNumber(result.latitude)}, lng ${formatNumber(
        result.longitude
      )}, accuracy ${formatAccuracy(result.accuracy)}`,
      'saved'
    );
    setStatus('DB committed.');
  }

  const collector = new window.LocationCollector({
    onStatus: setStatus,
    onLocation: renderLocation,
    onSaved: renderSaved,
    onError: setStatus,
  });

  permissionButton.addEventListener('click', () => {
    collector.requestPermission();
  });

  startButton.addEventListener('click', () => {
    collector.start();
    startButton.disabled = true;
    stopButton.disabled = false;
  });

  stopButton.addEventListener('click', () => {
    collector.stop();
    startButton.disabled = false;
    stopButton.disabled = true;
  });

  signoutButton.addEventListener('click', async () => {
    collector.stop();
    await fetch('/api/signout', { method: 'POST' });
    window.location.href = '/';
  });

  initMap();
  loadCurrentUser().then((isSignedIn) => {
    if (isSignedIn) {
      loadLocationHistory();
    }
  });
})();
