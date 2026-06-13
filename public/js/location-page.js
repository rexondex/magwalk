(function () {
  const DEFAULT_CENTER = [127.0276, 37.4979];
  const DEFAULT_ZOOM = 11;
  const HEALTH_CHECK_INTERVAL_MS = 5000;
  const HEALTH_TIMEOUT_MS = 45000;
  const PATH_SOURCE_ID = 'magwalk-location-path-source';
  const PATH_LAYER_ID = 'magwalk-location-path-layer';
  const START_POINT_SOURCE_ID = 'magwalk-location-start-point-source';
  const START_POINT_LAYER_ID = 'magwalk-location-start-point-layer';
  const END_POINT_SOURCE_ID = 'magwalk-location-end-point-source';
  const END_POINT_LAYER_ID = 'magwalk-location-end-point-layer';
  const BASEMAP_STYLE = {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        ],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      },
    },
    layers: [
      {
        id: 'carto-basemap',
        type: 'raster',
        source: 'carto',
        minzoom: 0,
        maxzoom: 20,
      },
    ],
  };

  const permissionButton = document.querySelector('#permissionButton');
  const startButton = document.querySelector('#startButton');
  const stopButton = document.querySelector('#stopButton');
  const touchGuardButton = document.querySelector('#touchGuardButton');
  const signoutButton = document.querySelector('#signoutButton');
  const permissionStatus = document.querySelector('#permissionStatus');
  const accountName = document.querySelector('#accountName');
  const latitude = document.querySelector('#latitude');
  const longitude = document.querySelector('#longitude');
  const accuracy = document.querySelector('#accuracy');
  const collectedAt = document.querySelector('#collectedAt');
  const lastCommit = document.querySelector('#lastCommit');
  const filterFromDate = document.querySelector('#filterFromDate');
  const filterFromHour = document.querySelector('#filterFromHour');
  const filterToDate = document.querySelector('#filterToDate');
  const filterToHour = document.querySelector('#filterToHour');
  const applyFilterButton = document.querySelector('#applyFilterButton');
  const clearFilterButton = document.querySelector('#clearFilterButton');
  const presetButtons = Array.from(document.querySelectorAll('[data-range-preset]'));
  const locationLog = document.querySelector('#locationLog');
  const historyEmpty = document.querySelector('#historyEmpty');
  const pathCount = document.querySelector('#pathCount');
  const permissionIndicator = document.querySelector('#permissionIndicator');
  const runningIndicator = document.querySelector('#runningIndicator');
  const touchGuard = document.querySelector('#touchGuard');
  const unlockStepButtons = Array.from(document.querySelectorAll('[data-unlock-step]'));

  const mapState = {
    map: null,
    marker: null,
    coordinates: [],
  };

  const wakeLockReasons = new Set();
  let wakeLockSentinel = null;
  let unlockExpectedStep = 1;
  let healthTimerId = null;
  let lastHealthyAt = 0;
  let geolocationPermissionStatus = null;
  let activeFilter = {
    from: null,
    to: null,
    preset: null,
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
    if (historyEmpty) {
      historyEmpty.hidden = true;
    }

    const item = document.createElement('li');
    item.textContent = text;
    item.classList.add('list-group-item');

    if (className) {
      item.classList.add(...className.split(' ').filter(Boolean));
    }

    locationLog.prepend(item);
  }

  function setStatus(message) {
    permissionStatus.textContent = message;
  }

  function setRunningIndicator(isRunning) {
    runningIndicator.hidden = !isRunning;
  }

  function setPermitHighlight(isPermitted) {
    permissionIndicator.hidden = !isPermitted;
  }

  async function refreshPermissionState() {
    if (!navigator.permissions?.query) {
      return;
    }

    try {
      geolocationPermissionStatus =
        geolocationPermissionStatus ||
        (await navigator.permissions.query({ name: 'geolocation' }));
      setPermitHighlight(geolocationPermissionStatus.state === 'granted');
      geolocationPermissionStatus.onchange = () => {
        setPermitHighlight(geolocationPermissionStatus.state === 'granted');
      };
    } catch (error) {
      setPermitHighlight(false);
    }
  }

  function markCollectorHealthy() {
    lastHealthyAt = Date.now();
  }

  function stopCollectorUi(message) {
    collector.stop();
    releaseWakeLock('collect');
    stopHealthWatchdog();
    setRunningIndicator(false);
    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus(message);
  }

  function startHealthWatchdog() {
    markCollectorHealthy();
    stopHealthWatchdog();
    healthTimerId = window.setInterval(() => {
      if (Date.now() - lastHealthyAt <= HEALTH_TIMEOUT_MS) {
        return;
      }

      stopCollectorUi('Collection stopped automatically: no recent location or DB activity.');
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  function stopHealthWatchdog() {
    if (!healthTimerId) {
      return;
    }

    window.clearInterval(healthTimerId);
    healthTimerId = null;
  }

  function toDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function toHourValue(date) {
    return String(date.getHours()).padStart(2, '0');
  }

  function fromDateHourValues(dateValue, hourValue, minute = 0, second = 0, millisecond = 0) {
    if (!dateValue) {
      return null;
    }

    const [year, month, day] = dateValue.split('-').map(Number);
    const hour = Number(hourValue || 0);
    const date = new Date(year, month - 1, day, hour, minute, second, millisecond);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function populateHourSelects() {
    [filterFromHour, filterToHour].forEach((select) => {
      select.replaceChildren();

      for (let hour = 0; hour < 24; hour += 1) {
        const value = String(hour).padStart(2, '0');
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `${value}:00`;
        select.appendChild(option);
      }
    });

    filterFromHour.value = '00';
    filterToHour.value = '23';
  }

  function setFilterInputs(from, to) {
    filterFromDate.value = from ? toDateInputValue(from) : '';
    filterFromHour.value = from ? toHourValue(from) : '00';
    filterToDate.value = to ? toDateInputValue(to) : '';
    filterToHour.value = to ? toHourValue(to) : '23';
  }

  function presetStartDate(preset) {
    const presetMs = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() - presetMs[preset]);
  }

  function updatePresetButtons() {
    presetButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.rangePreset === activeFilter.preset);
    });
  }

  function buildLocationQuery() {
    const params = new URLSearchParams();
    params.set('limit', '2000');

    if (activeFilter.from) {
      params.set('from', activeFilter.from.toISOString());
    }

    if (activeFilter.to) {
      params.set('to', activeFilter.to.toISOString());
    }

    return params.toString();
  }

  function locationMatchesActiveFilter(location) {
    const collectedTime = new Date(location.collectedAt).getTime();

    if (activeFilter.from && collectedTime < activeFilter.from.getTime()) {
      return false;
    }

    if (activeFilter.to && collectedTime > activeFilter.to.getTime()) {
      return false;
    }

    return true;
  }

  async function requestWakeLock(reason) {
    wakeLockReasons.add(reason);

    if (!('wakeLock' in navigator)) {
      setStatus('Screen wake lock is not supported in this browser.');
      return;
    }

    if (wakeLockSentinel || document.visibilityState !== 'visible') {
      return;
    }

    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
      setStatus('Screen wake lock is active.');
    } catch (error) {
      setStatus(`Screen wake lock failed: ${error.message}`);
    }
  }

  async function releaseWakeLock(reason) {
    wakeLockReasons.delete(reason);

    if (wakeLockReasons.size || !wakeLockSentinel) {
      return;
    }

    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;

    try {
      await sentinel.release();
    } catch (error) {
      setStatus(`Screen wake lock release failed: ${error.message}`);
    }
  }

  function refreshUnlockSteps() {
    unlockStepButtons.forEach((button) => {
      button.classList.toggle('is-next', Number(button.dataset.unlockStep) === unlockExpectedStep);
    });
  }

  function openTouchGuard() {
    unlockExpectedStep = 1;
    refreshUnlockSteps();
    document.body.classList.add('touch-guard-active');
    touchGuard.hidden = false;
    touchGuard.setAttribute('aria-hidden', 'false');
    requestWakeLock('touch-guard');
    setStatus('Touch prevention mode is ON.');
  }

  function closeTouchGuard() {
    touchGuard.hidden = true;
    touchGuard.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('touch-guard-active');
    unlockExpectedStep = 1;
    refreshUnlockSteps();
    releaseWakeLock('touch-guard');
    setStatus('Touch prevention mode is OFF.');
  }

  function handleUnlockStep(step) {
    if (step !== unlockExpectedStep) {
      unlockExpectedStep = 1;
      refreshUnlockSteps();
      return;
    }

    if (unlockExpectedStep === 3) {
      closeTouchGuard();
      return;
    }

    unlockExpectedStep += 1;
    refreshUnlockSteps();
  }

  function pathGeoJson() {
    if (mapState.coordinates.length < 2) {
      return {
        type: 'FeatureCollection',
        features: [],
      };
    }

    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: mapState.coordinates,
      },
    };
  }

  function pointGeoJson(coordinate) {
    if (!coordinate) {
      return {
        type: 'FeatureCollection',
        features: [],
      };
    }

    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: coordinate,
      },
    };
  }

  function resizeMap() {
    if (!mapState.map) {
      return;
    }

    mapState.map.resize();
    mapState.map.triggerRepaint();
    window.requestAnimationFrame(() => mapState.map?.resize());
    window.setTimeout(() => mapState.map?.resize(), 100);
    window.setTimeout(() => mapState.map?.resize(), 300);
  }

  function mapSizeText() {
    const container = document.querySelector('#locationMap');
    const canvas = container?.querySelector('canvas');

    if (!container) {
      return 'map container missing';
    }

    return `container ${container.clientWidth}x${container.clientHeight}, canvas ${
      canvas?.clientWidth || 0
    }x${canvas?.clientHeight || 0}`;
  }

  function ensurePathLayer() {
    if (!mapState.map || !mapState.map.isStyleLoaded()) {
      return;
    }

    if (!mapState.map.getSource(PATH_SOURCE_ID)) {
      mapState.map.addSource(PATH_SOURCE_ID, {
        type: 'geojson',
        data: pathGeoJson(),
      });
    }

    if (!mapState.map.getLayer(PATH_LAYER_ID)) {
      mapState.map.addLayer({
        id: PATH_LAYER_ID,
        type: 'line',
        source: PATH_SOURCE_ID,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#f8fafc',
          'line-opacity': 0.95,
          'line-width': 5,
        },
      });
    }

    if (!mapState.map.getSource(START_POINT_SOURCE_ID)) {
      mapState.map.addSource(START_POINT_SOURCE_ID, {
        type: 'geojson',
        data: pointGeoJson(mapState.coordinates[0]),
      });
    }

    if (!mapState.map.getLayer(START_POINT_LAYER_ID)) {
      mapState.map.addLayer({
        id: START_POINT_LAYER_ID,
        type: 'circle',
        source: START_POINT_SOURCE_ID,
        paint: {
          'circle-color': '#22d3ee',
          'circle-radius': 8,
          'circle-stroke-color': '#05070b',
          'circle-stroke-width': 3,
        },
      });
    }

    if (!mapState.map.getSource(END_POINT_SOURCE_ID)) {
      mapState.map.addSource(END_POINT_SOURCE_ID, {
        type: 'geojson',
        data: pointGeoJson(
          mapState.coordinates.length > 1 ? mapState.coordinates[mapState.coordinates.length - 1] : null
        ),
      });
    }

    if (!mapState.map.getLayer(END_POINT_LAYER_ID)) {
      mapState.map.addLayer({
        id: END_POINT_LAYER_ID,
        type: 'circle',
        source: END_POINT_SOURCE_ID,
        paint: {
          'circle-color': '#d946ef',
          'circle-radius': 8,
          'circle-stroke-color': '#05070b',
          'circle-stroke-width': 3,
        },
      });
    }
  }

  function updatePathLayer() {
    ensurePathLayer();
    const source = mapState.map?.getSource(PATH_SOURCE_ID);
    const startSource = mapState.map?.getSource(START_POINT_SOURCE_ID);
    const endSource = mapState.map?.getSource(END_POINT_SOURCE_ID);

    if (source) {
      source.setData(pathGeoJson());
    }

    if (startSource) {
      startSource.setData(pointGeoJson(mapState.coordinates[0]));
    }

    if (endSource) {
      endSource.setData(
        pointGeoJson(
          mapState.coordinates.length > 1 ? mapState.coordinates[mapState.coordinates.length - 1] : null
        )
      );
    }
  }

  function clearRenderedHistory() {
    mapState.coordinates = [];
    updatePathLayer();
    updatePathCount();
    locationLog.replaceChildren();

    if (historyEmpty) {
      historyEmpty.hidden = false;
    }
  }

  function initMap(center = DEFAULT_CENTER) {
    if (mapState.map) {
      resizeMap();
      return;
    }

    if (!window.maplibregl) {
      setStatus('MapLibre GL JS is not loaded.');
      return;
    }

    mapState.map = new maplibregl.Map({
      container: 'locationMap',
      style: BASEMAP_STYLE,
      center,
      zoom: DEFAULT_ZOOM,
      attributionControl: true,
    });

    mapState.map.on('error', (event) => {
      const message = event?.error?.message || 'MapLibre map failed to load.';
      setStatus(`Map error: ${message}`);
    });

    mapState.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    mapState.marker = new maplibregl.Marker({ color: '#f8fafc' })
      .setLngLat(center)
      .setPopup(new maplibregl.Popup().setHTML('<strong>Current location</strong>'))
      .addTo(mapState.map);

    mapState.map.on('load', () => {
      ensurePathLayer();
      resizeMap();
      window.setTimeout(() => {
        resizeMap();
        setStatus(`Map loaded. ${mapSizeText()}`);
      }, 100);
    });

    resizeMap();
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

    const lngLat = [longitudeValue, latitudeValue];
    mapState.coordinates.push(lngLat);
    mapState.marker.setLngLat(lngLat);
    updatePathLayer();
    updatePathCount();
    resizeMap();

    if (shouldPan) {
      mapState.map.easeTo({ center: lngLat, duration: 700 });
      return;
    }

    if (mapState.coordinates.length > 1) {
      const bounds = mapState.coordinates.reduce(
        (nextBounds, coordinate) => nextBounds.extend(coordinate),
        new maplibregl.LngLatBounds(mapState.coordinates[0], mapState.coordinates[0])
      );
      mapState.map.fitBounds(bounds, { padding: 32, duration: 0 });
      return;
    }

    mapState.map.setCenter(lngLat);
  }

  async function loadLocationHistory() {
    const response = await fetch(`/api/location?${buildLocationQuery()}`);

    if (!response.ok) {
      setStatus('Failed to load filtered location history.');
      return;
    }

    clearRenderedHistory();
    const logs = await response.json();
    logs.reverse().forEach((location) => {
      addLocationToMap(location, false);
      appendLog(
        `${formatTime(location.collectedAt)} | history | lat ${formatNumber(
          location.latitude
        )}, lng ${formatNumber(location.longitude)}, accuracy ${formatAccuracy(location.accuracy)}`,
        'history'
      );
    });
    setStatus(`History loaded: ${logs.length} records.`);
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
    markCollectorHealthy();
    latitude.textContent = formatNumber(location.latitude);
    longitude.textContent = formatNumber(location.longitude);
    accuracy.textContent = formatAccuracy(location.accuracy);
    collectedAt.textContent = formatTime(location.collectedAt);
  }

  function renderSaved(result) {
    markCollectorHealthy();
    const savedAt = result.collectedAt || new Date();
    const matchesFilter = locationMatchesActiveFilter(result);
    lastCommit.textContent = formatTime(savedAt);

    if (matchesFilter) {
      addLocationToMap(result);
      appendLog(
        `${formatTime(savedAt)} | DB committed | lat ${formatNumber(result.latitude)}, lng ${formatNumber(
          result.longitude
        )}, accuracy ${formatAccuracy(result.accuracy)}`,
        'saved'
      );
    }

    setStatus('DB committed.');
  }

  const collector = new window.LocationCollector({
    onStatus: setStatus,
    onLocation: renderLocation,
    onSaved: renderSaved,
    onError: setStatus,
    onPermission: setPermitHighlight,
  });

  permissionButton.addEventListener('click', () => {
    collector.requestPermission();
    window.setTimeout(refreshPermissionState, 500);
  });

  startButton.addEventListener('click', () => {
    const didStart = collector.start();

    if (!didStart) {
      return;
    }

    requestWakeLock('collect');
    startHealthWatchdog();
    setRunningIndicator(true);
    startButton.disabled = true;
    stopButton.disabled = false;
  });

  stopButton.addEventListener('click', () => {
    stopCollectorUi('Location collection is OFF.');
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const preset = button.dataset.rangePreset;
      activeFilter = {
        from: presetStartDate(preset),
        to: null,
        preset,
      };
      setFilterInputs(activeFilter.from, null);
      updatePresetButtons();
      loadLocationHistory();
    });
  });

  applyFilterButton.addEventListener('click', () => {
    const from = fromDateHourValues(filterFromDate.value, filterFromHour.value);
    const to = fromDateHourValues(filterToDate.value, filterToHour.value, 59, 59, 999);

    if (from && to && from > to) {
      setStatus('Filter start time must be before end time.');
      return;
    }

    activeFilter = {
      from,
      to,
      preset: null,
    };
    updatePresetButtons();
    loadLocationHistory();
  });

  clearFilterButton.addEventListener('click', () => {
    activeFilter = {
      from: null,
      to: null,
      preset: null,
    };
    setFilterInputs(null, null);
    updatePresetButtons();
    loadLocationHistory();
  });

  touchGuardButton.addEventListener('click', openTouchGuard);

  unlockStepButtons.forEach((button) => {
    button.addEventListener('click', () => {
      handleUnlockStep(Number(button.dataset.unlockStep));
    });
  });

  touchGuard.addEventListener(
    'touchmove',
    (event) => {
      event.preventDefault();
    },
    { passive: false }
  );

  signoutButton.addEventListener('click', async () => {
    collector.stop();
    stopHealthWatchdog();
    setRunningIndicator(false);
    await releaseWakeLock('collect');
    await releaseWakeLock('touch-guard');
    await fetch('/api/signout', { method: 'POST' });
    window.location.href = '/';
  });

  function bootMapAfterLayout() {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        initMap();
        resizeMap();
      }, 100);
    });
  }

  window.addEventListener('load', resizeMap);
  window.addEventListener('resize', resizeMap);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLockReasons.size) {
      requestWakeLock(wakeLockReasons.values().next().value);
    }
  });

  if ('ResizeObserver' in window) {
    new ResizeObserver(resizeMap).observe(document.querySelector('#locationMap'));
  }

  bootMapAfterLayout();
  refreshUnlockSteps();
  populateHourSelects();
  updatePresetButtons();
  refreshPermissionState();
  loadCurrentUser().then((isSignedIn) => {
    if (isSignedIn) {
      loadLocationHistory();
    }
  });
})();
