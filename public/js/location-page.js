(function () {
  const DEFAULT_CENTER = [127.0276, 37.4979];
  const DEFAULT_ZOOM = 17;
  const MAX_FIT_BOUNDS_ZOOM = 17;
  const MAP_HISTORY_LIMIT = 50000;
  const HISTORY_PAGE_SIZE = 300;
  const HEALTH_CHECK_INTERVAL_MS = 5000;
  const HEALTH_TIMEOUT_MS = 45000;
  const ROUTE_GAP_LIMIT_MS = 10 * 60 * 1000;
  const MAX_ROUTE_SEGMENT_SPEED_MPS = 15;
  const ESTIMATED_STEP_LENGTH_METERS = 0.74;
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
  const installAppButton = document.querySelector('#installAppButton');
  const signoutButton = document.querySelector('#signoutButton');
  const noticeLog = document.querySelector('#noticeLog');
  const noticeLogEmpty = document.querySelector('#noticeLogEmpty');
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
  const loadMoreHistoryButton = document.querySelector('#loadMoreHistoryButton');
  const distanceStat = document.querySelector('#distanceStat');
  const averageSpeedStat = document.querySelector('#averageSpeedStat');
  const stepCountStat = document.querySelector('#stepCountStat');
  const pathCount = document.querySelector('#pathCount');
  const permissionIndicator = document.querySelector('#permissionIndicator');
  const runningIndicator = document.querySelector('#runningIndicator');
  const queueIndicator = document.querySelector('#queueIndicator');
  const queueCount = document.querySelector('#queueCount');
  const touchGuard = document.querySelector('#touchGuard');
  const unlockStepButtons = Array.from(document.querySelectorAll('[data-unlock-step]'));

  const mapState = {
    map: null,
    marker: null,
    coordinates: [],
    locations: [],
  };

  const wakeLockReasons = new Set();
  const noticeMessages = [];
  let wakeLockSentinel = null;
  let unlockExpectedStep = 1;
  let healthTimerId = null;
  let lastHealthyAt = 0;
  let geolocationPermissionStatus = null;
  let loadedHistoryLogs = [];
  let renderedHistoryCount = 0;
  let historyRequestId = 0;
  let historyAbortController = null;
  let pendingPreset = null;
  let activeFilter = {
    from: null,
    to: null,
    preset: null,
  };

  function isValidLocation(location) {
    if (!location) {
      return false;
    }

    const latitudeValue = Number(location.latitude);
    const longitudeValue = Number(location.longitude);
    const collectedTime = new Date(location.collectedAt).getTime();

    return (
      Number.isFinite(latitudeValue) &&
      Number.isFinite(longitudeValue) &&
      latitudeValue >= -90 &&
      latitudeValue <= 90 &&
      longitudeValue >= -180 &&
      longitudeValue <= 180 &&
      !Number.isNaN(collectedTime)
    );
  }

  function formatNumber(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue.toFixed(6) : '-';
  }

  function formatAccuracy(value) {
    const numberValue = Number(value);
    return value === null || value === undefined || !Number.isFinite(numberValue)
      ? '-'
      : `${Math.round(numberValue)}m`;
  }

  function formatTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '-';
    }

    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(date);
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters) || meters <= 0) {
      return '0 m';
    }

    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }

    return `${(meters / 1000).toFixed(meters >= 10000 ? 1 : 2)} km`;
  }

  function formatSpeed(kilometersPerHour) {
    if (!Number.isFinite(kilometersPerHour) || kilometersPerHour <= 0) {
      return '-';
    }

    return `${kilometersPerHour.toFixed(kilometersPerHour >= 10 ? 1 : 2)} km/h`;
  }

  function formatInteger(value) {
    return new Intl.NumberFormat('ko-KR').format(Math.max(Math.round(value) || 0, 0));
  }

  function distanceMeters(from, to) {
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

  function routeStatsFromLocations(locations) {
    const validLocations = locations.filter(isValidLocation);
    let distanceMetersTotal = 0;
    let durationMsTotal = 0;

    for (let index = 1; index < validLocations.length; index += 1) {
      const previous = validLocations[index - 1];
      const current = validLocations[index];
      const previousTime = new Date(previous.collectedAt).getTime();
      const currentTime = new Date(current.collectedAt).getTime();
      const durationMs = currentTime - previousTime;

      if (durationMs <= 0 || durationMs > ROUTE_GAP_LIMIT_MS) {
        continue;
      }

      const segmentDistance = distanceMeters(previous, current);
      const segmentSpeedMps = segmentDistance / (durationMs / 1000);

      if (!Number.isFinite(segmentDistance) || segmentSpeedMps > MAX_ROUTE_SEGMENT_SPEED_MPS) {
        continue;
      }

      distanceMetersTotal += segmentDistance;
      durationMsTotal += durationMs;
    }

    const averageSpeedKmh =
      durationMsTotal > 0 ? (distanceMetersTotal / (durationMsTotal / 1000)) * 3.6 : 0;
    const estimatedSteps = distanceMetersTotal / ESTIMATED_STEP_LENGTH_METERS;

    return {
      averageSpeedKmh,
      distanceMeters: distanceMetersTotal,
      estimatedSteps,
    };
  }

  function appendLog(text, className, placement = 'prepend') {
    if (historyEmpty) {
      historyEmpty.hidden = true;
    }

    const item = document.createElement('li');
    item.textContent = text;
    item.classList.add('list-group-item');

    if (className) {
      item.classList.add(...className.split(' ').filter(Boolean));
    }

    if (placement === 'append') {
      locationLog.append(item);
      return;
    }

    locationLog.prepend(item);
  }

  function appendNotice(message) {
    if (!message) {
      return;
    }

    noticeMessages.unshift({
      message,
      createdAt: new Date(),
    });

    if (noticeMessages.length > 300) {
      noticeMessages.pop();
    }

    if (noticeLogEmpty) {
      noticeLogEmpty.hidden = noticeMessages.length > 0;
    }

    if (!noticeLog) {
      return;
    }

    const item = document.createElement('li');
    item.classList.add('list-group-item');
    item.textContent = `${formatTime(noticeMessages[0].createdAt)} | ${message}`;
    noticeLog.prepend(item);

    while (noticeLog.children.length > 300) {
      noticeLog.lastElementChild?.remove();
    }
  }

  function setStatus(message) {
    appendNotice(message);
  }

  function refreshInstallButton() {
    if (!installAppButton) {
      return;
    }

    const pwa = window.MagwalkPWA;
    const isInstalled = pwa?.isStandalone?.() || false;
    installAppButton.hidden = isInstalled;
    installAppButton.classList.toggle('is-ready', pwa?.canPromptInstall?.() || false);
    installAppButton.disabled = isInstalled;
  }

  async function handleInstallClick() {
    const pwa = window.MagwalkPWA;

    if (!pwa) {
      setStatus('PWA install is not ready in this browser yet.');
      return;
    }

    let result;

    try {
      result = await pwa.promptInstall();
    } catch (error) {
      setStatus(`Install prompt failed: ${error.message}`);
      return;
    }

    if (result.outcome === 'accepted') {
      setStatus('Magwalk app installation accepted.');
      return;
    }

    if (result.outcome === 'installed') {
      setStatus('Magwalk is already running as an installed app.');
      return;
    }

    if (result.outcome === 'manual') {
      setStatus('Install prompt is unavailable here. Use the browser menu or share menu to add Magwalk to the home screen.');
      return;
    }

    setStatus('Magwalk app installation was dismissed.');
  }

  function setRunningIndicator(isRunning) {
    runningIndicator.hidden = !isRunning;
  }

  function setQueueIndicator(count) {
    if (!queueIndicator || !queueCount) {
      return;
    }

    const queuedCount = Number(count) || 0;
    queueIndicator.hidden = queuedCount === 0;
    queueCount.textContent = `${queuedCount} queued`;
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
      button.classList.toggle('is-active', button.dataset.rangePreset === pendingPreset);
    });
  }

  function clearPendingPreset() {
    pendingPreset = null;
    updatePresetButtons();
  }

  function setFilterControlsLoading(isLoading) {
    [...presetButtons, applyFilterButton, clearFilterButton].forEach((button) => {
      button.disabled = isLoading;
      button.classList.toggle('is-loading', isLoading);
    });
  }

  function buildLocationQuery() {
    const params = new URLSearchParams();
    params.set('limit', String(MAP_HISTORY_LIMIT));

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

    if (Number.isNaN(collectedTime)) {
      return false;
    }

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

    return `container ${container.clientWidth}x${container.clientHeight}, canvas ${canvas?.clientWidth || 0
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
          'circle-radius': 9,
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
          'circle-radius': 9,
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
    mapState.locations = [];
    loadedHistoryLogs = [];
    renderedHistoryCount = 0;
    updatePathLayer();
    updatePathCount();
    updateRouteStats();
    locationLog.replaceChildren();

    if (historyEmpty) {
      historyEmpty.hidden = false;
    }

    if (loadMoreHistoryButton) {
      loadMoreHistoryButton.hidden = true;
      loadMoreHistoryButton.disabled = false;
    }
  }

  function fitMapToPath() {
    if (!mapState.map || !mapState.coordinates.length) {
      return;
    }

    resizeMap();

    if (mapState.coordinates.length === 1) {
      mapState.map.setCenter(mapState.coordinates[0]);
      return;
    }

    const bounds = mapState.coordinates.reduce(
      (nextBounds, coordinate) => nextBounds.extend(coordinate),
      new maplibregl.LngLatBounds(mapState.coordinates[0], mapState.coordinates[0])
    );
    mapState.map.fitBounds(bounds, { padding: 32, duration: 0, maxZoom: MAX_FIT_BOUNDS_ZOOM });
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

  function updateRouteStats() {
    if (!distanceStat || !averageSpeedStat || !stepCountStat) {
      return;
    }

    const stats = routeStatsFromLocations(mapState.locations);
    distanceStat.textContent = formatDistance(stats.distanceMeters);
    averageSpeedStat.textContent = formatSpeed(stats.averageSpeedKmh);
    stepCountStat.textContent = formatInteger(stats.estimatedSteps);
  }

  function addLocationToMap(location, shouldPan = true) {
    if (!mapState.map) {
      initMap();
    }

    if (!mapState.map) {
      return;
    }

    if (!isValidLocation(location)) {
      return;
    }

    const latitudeValue = Number(location.latitude);
    const longitudeValue = Number(location.longitude);
    const lngLat = [longitudeValue, latitudeValue];
    mapState.coordinates.push(lngLat);
    mapState.locations.push(location);
    mapState.marker.setLngLat(lngLat);
    updatePathLayer();
    updatePathCount();
    updateRouteStats();

    if (shouldPan) {
      resizeMap();
      mapState.map.easeTo({ center: lngLat, duration: 700 });
      return;
    }

    resizeMap();
  }

  function setMapLocations(locations) {
    if (!mapState.map) {
      initMap();
    }

    if (!mapState.map) {
      return;
    }

    mapState.coordinates = locations
      .filter(isValidLocation)
      .map((location) => {
        const latitudeValue = Number(location.latitude);
        const longitudeValue = Number(location.longitude);

        if (!Number.isFinite(latitudeValue) || !Number.isFinite(longitudeValue)) {
          return null;
        }

        return [longitudeValue, latitudeValue];
      })
      .filter(Boolean);
    mapState.locations = locations.filter(isValidLocation);

    const lastCoordinate = mapState.coordinates[mapState.coordinates.length - 1];

    if (lastCoordinate) {
      mapState.marker.setLngLat(lastCoordinate);
    }

    updatePathLayer();
    updatePathCount();
    updateRouteStats();
    fitMapToPath();
  }

  function formatHistoryLog(location, label) {
    return `${formatTime(location.collectedAt)} | ${label} | lat ${formatNumber(
      location.latitude
    )}, lng ${formatNumber(location.longitude)}, accuracy ${formatAccuracy(location.accuracy)}`;
  }

  function refreshLoadMoreHistoryButton() {
    if (!loadMoreHistoryButton) {
      return;
    }

    const remainingCount = Math.max(loadedHistoryLogs.length - renderedHistoryCount, 0);
    loadMoreHistoryButton.hidden = remainingCount === 0;
    loadMoreHistoryButton.disabled = remainingCount === 0;
    loadMoreHistoryButton.querySelector('span').textContent = `Show ${Math.min(
      HISTORY_PAGE_SIZE,
      remainingCount
    )} more`;
  }

  function renderNextHistoryPage() {
    const nextLogs = loadedHistoryLogs.slice(
      renderedHistoryCount,
      renderedHistoryCount + HISTORY_PAGE_SIZE
    );

    nextLogs.forEach((location) => {
      appendLog(formatHistoryLog(location, 'history'), 'history', 'append');
    });

    renderedHistoryCount += nextLogs.length;

    if (historyEmpty) {
      historyEmpty.hidden = renderedHistoryCount > 0;
    }

    refreshLoadMoreHistoryButton();
  }

  async function loadLocationHistory() {
    const requestId = historyRequestId + 1;
    historyRequestId = requestId;

    if (historyAbortController) {
      historyAbortController.abort();
    }

    historyAbortController = new AbortController();
    setFilterControlsLoading(true);

    try {
      const response = await fetch(`/api/location?${buildLocationQuery()}`, {
        signal: historyAbortController.signal,
      });

      if (requestId !== historyRequestId) {
        return;
      }

      if (response.status === 401) {
        handleAuthExpired();
        return;
      }

      if (!response.ok) {
        setStatus('Failed to load filtered location history.');
        return;
      }

      clearRenderedHistory();
      const logs = await response.json();

      if (requestId !== historyRequestId) {
        return;
      }

      if (!Array.isArray(logs)) {
        setStatus('Location history response was invalid.');
        return;
      }

      loadedHistoryLogs = logs.filter(isValidLocation);
      setMapLocations(loadedHistoryLogs.slice().reverse());

      renderNextHistoryPage();
      setStatus(
        `Map path loaded: ${loadedHistoryLogs.length} records. History displays ${Math.min(
          renderedHistoryCount,
          loadedHistoryLogs.length
        )} records.`
      );
    } catch (error) {
      if (error.name !== 'AbortError') {
        setStatus(`Failed to load filtered location history: ${error.message}`);
      }
    } finally {
      if (requestId === historyRequestId) {
        setFilterControlsLoading(false);
        historyAbortController = null;
      }
    }
  }

  async function loadCurrentUser() {
    let response;

    try {
      response = await fetch('/api/me');
    } catch (error) {
      setStatus(`Unable to verify sign-in: ${error.message}`);
      return false;
    }

    if (!response.ok) {
      window.location.href = '/signin';
      return false;
    }

    const result = await response.json();
    accountName.textContent = result.user.username;
    return true;
  }

  function renderLocation(location) {
    if (!isValidLocation(location)) {
      setStatus('Ignored invalid location update.');
      return;
    }

    markCollectorHealthy();
    latitude.textContent = formatNumber(location.latitude);
    longitude.textContent = formatNumber(location.longitude);
    accuracy.textContent = formatAccuracy(location.accuracy);
    collectedAt.textContent = formatTime(location.collectedAt);
  }

  function renderSaved(result) {
    if (!isValidLocation(result)) {
      setStatus('Ignored invalid DB commit response.');
      return;
    }

    markCollectorHealthy();
    const savedAt = result.collectedAt || new Date();
    const matchesFilter = locationMatchesActiveFilter(result);
    lastCommit.textContent = formatTime(savedAt);

    if (matchesFilter) {
      addLocationToMap(result);
      loadedHistoryLogs.unshift(result);
      renderedHistoryCount += 1;
      appendLog(formatHistoryLog(result, 'DB committed'), 'saved');
      refreshLoadMoreHistoryButton();
    }

    setStatus('DB committed.');
  }

  function renderQueued(location) {
    if (!isValidLocation(location)) {
      return;
    }

    markCollectorHealthy();
    lastCommit.textContent = `Queued ${formatTime(location.collectedAt)}`;
  }

  function handleAuthExpired() {
    collector.stop();
    stopHealthWatchdog();
    setRunningIndicator(false);
    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus('Sign-in expired. Please sign in again to continue location collection.');
    window.setTimeout(() => {
      window.location.href = '/signin';
    }, 1200);
  }

  const collector = new window.LocationCollector({
    onStatus: setStatus,
    onLocation: renderLocation,
    onSaved: renderSaved,
    onQueued: renderQueued,
    onQueueUpdate: setQueueIndicator,
    onError: setStatus,
    onPermission: setPermitHighlight,
    onAuthExpired: handleAuthExpired,
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
      pendingPreset = preset;
      setFilterInputs(presetStartDate(preset), null);
      updatePresetButtons();
      setStatus('Filter range selected. Press Apply to update the map path.');
    });
  });

  [filterFromDate, filterFromHour, filterToDate, filterToHour].forEach((control) => {
    control.addEventListener('change', () => {
      clearPendingPreset();
      setStatus('Custom filter changed. Press Apply to update the map path.');
    });
  });

  applyFilterButton.addEventListener('click', () => {
    let from = fromDateHourValues(filterFromDate.value, filterFromHour.value);
    let to = fromDateHourValues(filterToDate.value, filterToHour.value, 59, 59, 999);

    if (pendingPreset) {
      from = presetStartDate(pendingPreset);
      to = null;
      setFilterInputs(from, null);
    }

    if (from && to && from > to) {
      setStatus('Filter start time must be before end time.');
      return;
    }

    activeFilter = {
      from,
      to,
      preset: pendingPreset,
    };
    loadLocationHistory();
  });

  clearFilterButton.addEventListener('click', () => {
    pendingPreset = null;
    setFilterInputs(null, null);
    updatePresetButtons();
    setStatus('Filter cleared. Press Apply to show the full map path.');
  });

  touchGuardButton.addEventListener('click', openTouchGuard);

  installAppButton?.addEventListener('click', () => {
    handleInstallClick().finally(refreshInstallButton);
  });

  loadMoreHistoryButton?.addEventListener('click', renderNextHistoryPage);

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
    window.MagwalkPWA?.clearPrivateCache?.();
    try {
      await fetch('/api/signout', { method: 'POST' });
    } catch (error) {
      setStatus(`Sign out request failed: ${error.message}`);
    } finally {
      window.location.href = '/';
    }
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
  window.addEventListener('magwalk:pwa-install-ready', refreshInstallButton);
  window.addEventListener('magwalk:pwa-install-changed', refreshInstallButton);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLockReasons.size) {
      requestWakeLock(wakeLockReasons.values().next().value);
    }
  });

  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type !== 'MAGWALK_LOCATION_QUEUE_FLUSHED') {
      return;
    }

    setQueueIndicator(0);
    setStatus(`Background sync saved ${event.data.count} queued locations.`);
    loadLocationHistory();
  });

  if ('ResizeObserver' in window) {
    new ResizeObserver(resizeMap).observe(document.querySelector('#locationMap'));
  }

  bootMapAfterLayout();
  appendNotice('Waiting for browser location permission.');
  refreshInstallButton();
  refreshUnlockSteps();
  populateHourSelects();
  updatePresetButtons();
  refreshPermissionState();
  loadCurrentUser().then((isSignedIn) => {
    if (isSignedIn) {
      collector.flushQueuedLocations();
      loadLocationHistory();
    }
  });
})();
