(function () {
  const DEFAULT_CENTER = [127.0276, 37.4979];
  const DEFAULT_ZOOM = 11;
  const PATH_SOURCE_ID = 'magwalk-location-path-source';
  const PATH_LAYER_ID = 'magwalk-location-path-layer';
  const BASEMAP_STYLE = {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
          'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
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
  const signoutButton = document.querySelector('#signoutButton');
  const permissionStatus = document.querySelector('#permissionStatus');
  const accountName = document.querySelector('#accountName');
  const latitude = document.querySelector('#latitude');
  const longitude = document.querySelector('#longitude');
  const accuracy = document.querySelector('#accuracy');
  const collectedAt = document.querySelector('#collectedAt');
  const lastCommit = document.querySelector('#lastCommit');
  const locationLog = document.querySelector('#locationLog');
  const historyEmpty = document.querySelector('#historyEmpty');
  const pathCount = document.querySelector('#pathCount');

  const mapState = {
    map: null,
    marker: null,
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
          'line-color': '#16a34a',
          'line-opacity': 0.95,
          'line-width': 5,
        },
      });
    }
  }

  function updatePathLayer() {
    ensurePathLayer();
    const source = mapState.map?.getSource(PATH_SOURCE_ID);

    if (source) {
      source.setData(pathGeoJson());
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

    mapState.marker = new maplibregl.Marker({ color: '#ef4444' })
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
    const response = await fetch('/api/location');

    if (!response.ok) {
      return;
    }

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

  if ('ResizeObserver' in window) {
    new ResizeObserver(resizeMap).observe(document.querySelector('#locationMap'));
  }

  bootMapAfterLayout();
  loadCurrentUser().then((isSignedIn) => {
    if (isSignedIn) {
      loadLocationHistory();
    }
  });
})();
