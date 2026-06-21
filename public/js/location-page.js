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
  const DAILY_HISTORY_LIMIT = 50000;
  const DAILY_IMAGE_SIZE = 1080;
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
  const dailySummaryModal = document.querySelector('#dailySummaryModal');
  const dailyDateInput = document.querySelector('#dailyDateInput');
  const dailyTodayButton = document.querySelector('#dailyTodayButton');
  const dailyPreviousMonthButton = document.querySelector('#dailyPreviousMonthButton');
  const dailyNextMonthButton = document.querySelector('#dailyNextMonthButton');
  const dailyMonthTitle = document.querySelector('#dailyMonthTitle');
  const dailyCalendarGrid = document.querySelector('#dailyCalendarGrid');
  const dailyShareButton = document.querySelector('#dailyShareButton');
  const dailyDownloadButton = document.querySelector('#dailyDownloadButton');
  const dailyDetailGrid = document.querySelector('#dailyDetailGrid');
  const dailySummaryStatus = document.querySelector('#dailySummaryStatus');
  const dailyAchievementCard = document.querySelector('#dailyAchievementCard');
  const dailyCardDate = document.querySelector('#dailyCardDate');
  const dailyCardKicker = document.querySelector('#dailyCardKicker');
  const dailyCardTitle = document.querySelector('#dailyCardTitle');
  const dailyCardSubtitle = document.querySelector('#dailyCardSubtitle');
  const dailyRoutePath = document.querySelector('#dailyRoutePath');
  const dailyRouteStart = document.querySelector('#dailyRouteStart');
  const dailyRouteEnd = document.querySelector('#dailyRouteEnd');
  const dailyCardDistance = document.querySelector('#dailyCardDistance');
  const dailyCardSteps = document.querySelector('#dailyCardSteps');
  const dailyCardPace = document.querySelector('#dailyCardPace');
  const dailyCardMoving = document.querySelector('#dailyCardMoving');
  const dailyCardTimeRange = document.querySelector('#dailyCardTimeRange');
  const dailyCardPointCount = document.querySelector('#dailyCardPointCount');

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
  let dailyAbortController = null;
  let dailyCalendarAbortController = null;
  let dailyRequestId = 0;
  let dailyCalendarRequestId = 0;
  const dailyState = {
    selectedDate: '',
    visibleMonth: null,
    dayCounts: new Map(),
    locations: [],
    stats: null,
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
      return '0m';
    }

    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }

    return `${(meters / 1000).toFixed(meters >= 10000 ? 1 : 2)}km`;
  }

  function formatSpeed(kilometersPerHour) {
    if (!Number.isFinite(kilometersPerHour) || kilometersPerHour <= 0) {
      return '-';
    }

    return kilometersPerHour.toFixed(kilometersPerHour >= 10 ? 1 : 2);
  }

  function formatInteger(value) {
    return formatCompactNumber(value);
  }

  function formatCompactNumber(value) {
    const numberValue = Math.max(Math.round(Number(value) || 0), 0);
    const suffixes = [
      { threshold: 1000000000, suffix: 'b' },
      { threshold: 1000000, suffix: 'm' },
      { threshold: 1000, suffix: 'k' },
    ];
    const suffix = suffixes.find((item) => numberValue >= item.threshold);

    if (!suffix) {
      return String(numberValue);
    }

    const compactValue = numberValue / suffix.threshold;
    const fractionDigits = compactValue < 10 ? 1 : 0;
    return `${compactValue.toFixed(fractionDigits).replace(/\.0$/, '')}${suffix.suffix}`;
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
    let maxSpeedKmh = 0;
    let segmentCount = 0;
    let accuracyTotal = 0;
    let accuracyCount = 0;
    let bestAccuracy = Infinity;

    validLocations.forEach((location) => {
      const locationAccuracy = Number(location.accuracy);

      if (Number.isFinite(locationAccuracy) && locationAccuracy >= 0) {
        accuracyTotal += locationAccuracy;
        accuracyCount += 1;
        bestAccuracy = Math.min(bestAccuracy, locationAccuracy);
      }
    });

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
      maxSpeedKmh = Math.max(maxSpeedKmh, segmentSpeedMps * 3.6);
      segmentCount += 1;
    }

    const averageSpeedKmh =
      durationMsTotal > 0 ? (distanceMetersTotal / (durationMsTotal / 1000)) * 3.6 : 0;
    const estimatedSteps = distanceMetersTotal / ESTIMATED_STEP_LENGTH_METERS;

    return {
      averageSpeedKmh,
      averageAccuracyMeters: accuracyCount > 0 ? accuracyTotal / accuracyCount : null,
      bestAccuracyMeters: Number.isFinite(bestAccuracy) ? bestAccuracy : null,
      distanceMeters: distanceMetersTotal,
      durationMs: durationMsTotal,
      estimatedSteps,
      maxSpeedKmh,
      segmentCount,
      pointCount: validLocations.length,
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
    queueIndicator.setAttribute('aria-label', `${queuedCount} queued locations`);
    queueCount.textContent = formatCompactNumber(queuedCount);
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

  function parseDateInputValue(dateValue) {
    if (!dateValue) {
      return null;
    }

    const [year, month, day] = dateValue.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function addMonths(date, monthCount) {
    return new Date(date.getFullYear(), date.getMonth() + monthCount, 1);
  }

  function addDays(date, dayCount) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayCount);
  }

  function sameMonth(left, right) {
    return (
      left &&
      right &&
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth()
    );
  }

  function monthRange(date) {
    const from = startOfMonth(date);
    const to = addMonths(from, 1);
    return { from, to };
  }

  function dayRange(dateValue) {
    const from = parseDateInputValue(dateValue);

    if (!from) {
      return null;
    }

    const to = addDays(from, 1);
    return { from, to };
  }

  function chronologicalLocations(locations) {
    return locations
      .filter(isValidLocation)
      .slice()
      .sort((left, right) => new Date(left.collectedAt).getTime() - new Date(right.collectedAt).getTime());
  }

  function monthTitle(date) {
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
    }).format(date);
  }

  function achievementDateText(dateValue) {
    const date = parseDateInputValue(dateValue);

    if (!date) {
      return '-';
    }

    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    }).format(date);
  }

  function timeOnlyText(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '-';
    }

    return new Intl.DateTimeFormat('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function formatDurationCompact(durationMs) {
    const milliseconds = Number(durationMs) || 0;

    if (milliseconds <= 0) {
      return '0m';
    }

    const totalMinutes = Math.round(milliseconds / 60000);

    if (totalMinutes < 1) {
      return '<1m';
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!hours) {
      return `${minutes}m`;
    }

    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  function formatPace(stats) {
    if (!stats || stats.distanceMeters <= 0 || stats.durationMs <= 0) {
      return '-';
    }

    const paceMinutesPerKilometer = (stats.durationMs / 60000) / (stats.distanceMeters / 1000);

    if (!Number.isFinite(paceMinutesPerKilometer) || paceMinutesPerKilometer > 99) {
      return '-';
    }

    const minutes = Math.floor(paceMinutesPerKilometer);
    const seconds = Math.round((paceMinutesPerKilometer - minutes) * 60);
    return `${minutes}'${String(seconds).padStart(2, '0')}"`;
  }

  function speedText(kilometersPerHour) {
    const formattedSpeed = formatSpeed(kilometersPerHour);
    return formattedSpeed === '-' ? '-' : `${formattedSpeed} km/h`;
  }

  function accuracyText(value) {
    return value === null || value === undefined ? '-' : formatAccuracy(value);
  }

  function timeRangeText(stats) {
    if (!stats?.firstAt || !stats?.lastAt) {
      return 'No records';
    }

    return `${timeOnlyText(stats.firstAt)} - ${timeOnlyText(stats.lastAt)}`;
  }

  function dayCountForDate(dateValue) {
    return Number(dailyState.dayCounts.get(dateValue)) || 0;
  }

  function dailySummaryFromLocations(locations) {
    const orderedLocations = chronologicalLocations(locations);
    const routeStats = routeStatsFromLocations(orderedLocations);
    const firstLocation = orderedLocations[0] || null;
    const lastLocation = orderedLocations[orderedLocations.length - 1] || null;
    const firstTime = firstLocation ? new Date(firstLocation.collectedAt).getTime() : 0;
    const lastTime = lastLocation ? new Date(lastLocation.collectedAt).getTime() : 0;

    return {
      ...routeStats,
      elapsedMs: firstTime && lastTime && lastTime > firstTime ? lastTime - firstTime : 0,
      firstAt: firstLocation?.collectedAt || null,
      lastAt: lastLocation?.collectedAt || null,
      locations: orderedLocations,
      recordCount: orderedLocations.length,
    };
  }

  function dailyAchievementTitle(stats) {
    if (!stats?.recordCount) {
      return '기록을 기다리는 하루';
    }

    if (stats.distanceMeters >= 10000) {
      return '10K 워킹 데이';
    }

    if (stats.estimatedSteps >= 10000) {
      return '만 보 달성';
    }

    if (stats.distanceMeters >= 5000) {
      return '긴 산책 완료';
    }

    if (stats.averageSpeedKmh >= 5.5) {
      return '빠른 발걸음';
    }

    if (stats.distanceMeters >= 1000) {
      return '오늘의 산책 기록';
    }

    return '하루 발자국 저장';
  }

  function dailyAchievementSubtitle(stats) {
    if (!stats?.recordCount) {
      return '이 날짜에는 아직 공유할 위치 기록이 없습니다.';
    }

    return `${formatDistance(stats.distanceMeters)} 이동, ${formatInteger(
      stats.estimatedSteps
    )}걸음 추정, ${formatDurationCompact(stats.durationMs)} 활동`;
  }

  function routePreviewData(locations, width = 320, height = 160, padding = 18) {
    const points = chronologicalLocations(locations).map((location) => ({
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    }));

    if (!points.length) {
      return null;
    }

    const minLatitude = Math.min(...points.map((point) => point.latitude));
    const maxLatitude = Math.max(...points.map((point) => point.latitude));
    const minLongitude = Math.min(...points.map((point) => point.longitude));
    const maxLongitude = Math.max(...points.map((point) => point.longitude));
    const latitudeRange = Math.max(maxLatitude - minLatitude, 0.00001);
    const longitudeRange = Math.max(maxLongitude - minLongitude, 0.00001);
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;
    const projectedPoints = points.map((point) => ({
      x: padding + ((point.longitude - minLongitude) / longitudeRange) * innerWidth,
      y: height - padding - ((point.latitude - minLatitude) / latitudeRange) * innerHeight,
    }));
    const path = projectedPoints
      .map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(' ');

    return {
      path: projectedPoints.length > 1 ? path : '',
      points: projectedPoints,
      start: projectedPoints[0],
      end: projectedPoints[projectedPoints.length - 1],
    };
  }

  function setCirclePoint(circle, point, radius) {
    if (!circle) {
      return;
    }

    circle.setAttribute('cx', point ? String(point.x) : '0');
    circle.setAttribute('cy', point ? String(point.y) : '0');
    circle.setAttribute('r', point ? String(radius) : '0');
  }

  function setDailyStatus(message) {
    if (dailySummaryStatus) {
      dailySummaryStatus.textContent = message;
    }
  }

  function setDailyLoading(isLoading) {
    [dailyTodayButton, dailyPreviousMonthButton, dailyNextMonthButton, dailyShareButton, dailyDownloadButton]
      .filter(Boolean)
      .forEach((button) => {
        button.disabled = isLoading;
        button.classList.toggle('is-loading', isLoading);
      });

    if (dailyDateInput) {
      dailyDateInput.disabled = isLoading;
    }

    dailyAchievementCard?.classList.toggle('is-loading', isLoading);
  }

  function renderDailyDetailGrid(stats) {
    if (!dailyDetailGrid) {
      return;
    }

    const detailItems = [
      ['거리', formatDistance(stats?.distanceMeters || 0)],
      ['평균 속도', speedText(stats?.averageSpeedKmh || 0)],
      ['최고 속도', speedText(stats?.maxSpeedKmh || 0)],
      ['추정 걸음', formatInteger(stats?.estimatedSteps || 0)],
      ['이동 시간', formatDurationCompact(stats?.durationMs || 0)],
      ['기록 범위', formatDurationCompact(stats?.elapsedMs || 0)],
      ['GPS 포인트', formatInteger(stats?.pointCount || 0)],
      ['평균 정확도', accuracyText(stats?.averageAccuracyMeters)],
      ['최고 정확도', accuracyText(stats?.bestAccuracyMeters)],
    ];

    dailyDetailGrid.replaceChildren(
      ...detailItems.map(([label, value]) => {
        const item = document.createElement('div');
        const labelElement = document.createElement('span');
        const valueElement = document.createElement('strong');
        labelElement.textContent = label;
        valueElement.textContent = value;
        item.append(labelElement, valueElement);
        return item;
      })
    );
  }

  function renderDailyAchievement() {
    const stats = dailyState.stats || dailySummaryFromLocations([]);
    const hasRecords = stats.recordCount > 0;
    const preview = routePreviewData(stats.locations || []);

    dailyAchievementCard?.classList.toggle('is-empty', !hasRecords);

    if (dailyCardDate) {
      dailyCardDate.textContent = achievementDateText(dailyState.selectedDate);
    }

    if (dailyCardKicker) {
      dailyCardKicker.textContent = hasRecords ? `${speedText(stats.averageSpeedKmh)} average` : 'Daily route';
    }

    if (dailyCardTitle) {
      dailyCardTitle.textContent = dailyAchievementTitle(stats);
    }

    if (dailyCardSubtitle) {
      dailyCardSubtitle.textContent = dailyAchievementSubtitle(stats);
    }

    if (dailyRoutePath) {
      dailyRoutePath.setAttribute('d', preview?.path || '');
    }

    setCirclePoint(dailyRouteStart, preview?.start, hasRecords ? 5 : 0);
    setCirclePoint(dailyRouteEnd, preview?.end, hasRecords ? 5 : 0);

    if (dailyCardDistance) {
      dailyCardDistance.textContent = formatDistance(stats.distanceMeters);
    }

    if (dailyCardSteps) {
      dailyCardSteps.textContent = formatInteger(stats.estimatedSteps);
    }

    if (dailyCardPace) {
      dailyCardPace.textContent = formatPace(stats);
    }

    if (dailyCardMoving) {
      dailyCardMoving.textContent = formatDurationCompact(stats.durationMs);
    }

    if (dailyCardTimeRange) {
      dailyCardTimeRange.textContent = timeRangeText(stats);
    }

    if (dailyCardPointCount) {
      dailyCardPointCount.textContent = `${formatInteger(stats.pointCount)} points`;
    }

    renderDailyDetailGrid(stats);
  }

  function renderDailyCalendar() {
    if (!dailyCalendarGrid || !dailyState.visibleMonth) {
      return;
    }

    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const todayValue = toDateInputValue(new Date());
    const selectedDate = parseDateInputValue(dailyState.selectedDate);
    const monthStart = dailyState.visibleMonth;
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const leadingBlankCount = monthStart.getDay();
    const cellCount = Math.ceil((leadingBlankCount + daysInMonth) / 7) * 7;
    const nodes = weekdays.map((weekday) => {
      const label = document.createElement('span');
      label.className = 'daily-calendar-weekday';
      label.textContent = weekday;
      return label;
    });

    for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
      const dayNumber = cellIndex - leadingBlankCount + 1;

      if (dayNumber < 1 || dayNumber > daysInMonth) {
        const spacer = document.createElement('span');
        spacer.className = 'daily-calendar-spacer';
        nodes.push(spacer);
        continue;
      }

      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), dayNumber);
      const dateValue = toDateInputValue(date);
      const count = dayCountForDate(dateValue);
      const button = document.createElement('button');
      const dayLabel = document.createElement('strong');
      const countLabel = document.createElement('span');

      button.type = 'button';
      button.className = 'daily-calendar-day';
      button.classList.toggle('has-data', count > 0);
      button.classList.toggle('is-today', dateValue === todayValue);
      button.classList.toggle('is-selected', Boolean(selectedDate && dateValue === dailyState.selectedDate));
      button.setAttribute(
        'aria-label',
        `${achievementDateText(dateValue)} ${count > 0 ? `${count} records` : 'no records'}`
      );
      dayLabel.textContent = String(dayNumber);
      countLabel.textContent = count > 0 ? formatCompactNumber(count) : '';
      button.append(dayLabel, countLabel);
      button.addEventListener('click', () => selectDailyDate(dateValue));
      nodes.push(button);
    }

    dailyCalendarGrid.replaceChildren(...nodes);

    if (dailyMonthTitle) {
      dailyMonthTitle.textContent = monthTitle(monthStart);
    }
  }

  async function loadDailyCalendar() {
    if (!dailyState.visibleMonth) {
      return;
    }

    const requestId = dailyCalendarRequestId + 1;
    dailyCalendarRequestId = requestId;

    if (dailyCalendarAbortController) {
      dailyCalendarAbortController.abort();
    }

    dailyCalendarAbortController = new AbortController();
    const { from, to } = monthRange(dailyState.visibleMonth);
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      timezoneOffsetMinutes: String(from.getTimezoneOffset()),
    });

    try {
      const response = await fetch(`/api/location/days?${params.toString()}`, {
        signal: dailyCalendarAbortController.signal,
      });

      if (requestId !== dailyCalendarRequestId) {
        return;
      }

      if (response.status === 401) {
        handleAuthExpired();
        return;
      }

      if (!response.ok) {
        setDailyStatus('캘린더 날짜 목록을 불러오지 못했습니다.');
        return;
      }

      const dayCounts = await response.json();

      if (!Array.isArray(dayCounts)) {
        setDailyStatus('캘린더 응답 형식이 올바르지 않습니다.');
        return;
      }

      dailyState.dayCounts = new Map(
        dayCounts
          .filter((item) => item?.date)
          .map((item) => [String(item.date), Number(item.count) || 0])
      );
      renderDailyCalendar();
    } catch (error) {
      if (error.name !== 'AbortError') {
        setDailyStatus(`캘린더를 불러오지 못했습니다: ${error.message}`);
      }
    } finally {
      if (requestId === dailyCalendarRequestId) {
        dailyCalendarAbortController = null;
      }
    }
  }

  async function loadDailySummary() {
    const range = dayRange(dailyState.selectedDate);

    if (!range) {
      setDailyStatus('조회할 날짜를 선택해 주세요.');
      return;
    }

    const requestId = dailyRequestId + 1;
    dailyRequestId = requestId;

    if (dailyAbortController) {
      dailyAbortController.abort();
    }

    dailyAbortController = new AbortController();
    setDailyLoading(true);
    setDailyStatus('하루 기록을 불러오는 중입니다.');

    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: new Date(range.to.getTime() - 1).toISOString(),
      limit: String(DAILY_HISTORY_LIMIT),
    });

    try {
      const response = await fetch(`/api/location?${params.toString()}`, {
        signal: dailyAbortController.signal,
      });

      if (requestId !== dailyRequestId) {
        return;
      }

      if (response.status === 401) {
        handleAuthExpired();
        return;
      }

      if (!response.ok) {
        setDailyStatus('하루 기록을 불러오지 못했습니다.');
        return;
      }

      const logs = await response.json();

      if (!Array.isArray(logs)) {
        setDailyStatus('하루 기록 응답 형식이 올바르지 않습니다.');
        return;
      }

      const serverDayCount = dayCountForDate(dailyState.selectedDate);
      dailyState.locations = chronologicalLocations(logs);
      dailyState.stats = dailySummaryFromLocations(dailyState.locations);
      dailyState.dayCounts.set(
        dailyState.selectedDate,
        Math.max(serverDayCount, dailyState.stats.recordCount)
      );
      renderDailyAchievement();
      renderDailyCalendar();

      if (serverDayCount > logs.length) {
        setDailyStatus(`이 날짜는 기록이 많아 최근 ${formatInteger(logs.length)}개 기준으로 계산했습니다.`);
        return;
      }

      if (dailyState.stats.recordCount > 0) {
        setDailyStatus('정사각형 업적 카드가 준비되었습니다.');
        return;
      }

      setDailyStatus('이 날짜에는 아직 위치 기록이 없습니다.');
    } catch (error) {
      if (error.name !== 'AbortError') {
        setDailyStatus(`하루 기록을 불러오지 못했습니다: ${error.message}`);
      }
    } finally {
      if (requestId === dailyRequestId) {
        setDailyLoading(false);
        dailyAbortController = null;
      }
    }
  }

  function selectDailyDate(dateValue) {
    const date = parseDateInputValue(dateValue);

    if (!date) {
      setDailyStatus('날짜 형식이 올바르지 않습니다.');
      return;
    }

    dailyState.selectedDate = dateValue;

    if (dailyDateInput) {
      dailyDateInput.value = dateValue;
    }

    if (!sameMonth(dailyState.visibleMonth, date)) {
      dailyState.visibleMonth = startOfMonth(date);
      renderDailyCalendar();
      loadDailyCalendar();
    } else {
      renderDailyCalendar();
    }

    loadDailySummary();
  }

  function moveDailyMonth(monthCount) {
    if (!dailyState.visibleMonth) {
      dailyState.visibleMonth = startOfMonth(new Date());
    }

    dailyState.visibleMonth = addMonths(dailyState.visibleMonth, monthCount);
    renderDailyCalendar();
    loadDailyCalendar();
  }

  function initDailySummary() {
    const todayValue = toDateInputValue(new Date());

    if (!dailyState.selectedDate) {
      dailyState.selectedDate = todayValue;
      dailyState.visibleMonth = startOfMonth(new Date());
      dailyState.stats = dailySummaryFromLocations([]);

      if (dailyDateInput) {
        dailyDateInput.value = todayValue;
      }

      renderDailyAchievement();
    }

    renderDailyCalendar();
    loadDailyCalendar();
    loadDailySummary();
  }

  function roundedRectPath(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  }

  function fillRoundedRect(context, x, y, width, height, radius, color) {
    roundedRectPath(context, x, y, width, height, radius);
    context.fillStyle = color;
    context.fill();
  }

  function strokeRoundedRect(context, x, y, width, height, radius, color, lineWidth = 2) {
    roundedRectPath(context, x, y, width, height, radius);
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
  }

  function canvasFont(size, weight = 700) {
    return `${weight} ${size}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  }

  function fitCanvasText(context, text, maxWidth, size, minSize, weight = 900) {
    let nextSize = size;

    while (nextSize > minSize) {
      context.font = canvasFont(nextSize, weight);

      if (context.measureText(text).width <= maxWidth) {
        return nextSize;
      }

      nextSize -= 2;
    }

    return minSize;
  }

  function drawWrappedCanvasText(context, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let currentLine = '';

    words.forEach((word) => {
      const testLine = currentLine ? `${currentLine} ${word}` : word;

      if (context.measureText(testLine).width <= maxWidth || !currentLine) {
        currentLine = testLine;
        return;
      }

      lines.push(currentLine);
      currentLine = word;
    });

    if (currentLine) {
      lines.push(currentLine);
    }

    lines.slice(0, maxLines).forEach((line, index) => {
      context.fillText(line, x, y + index * lineHeight);
    });

    return y + Math.min(lines.length, maxLines) * lineHeight;
  }

  function drawCanvasRoute(context, stats, x, y, width, height) {
    fillRoundedRect(context, x, y, width, height, 28, '#05070b');

    context.save();
    context.beginPath();
    roundedRectPath(context, x, y, width, height, 28);
    context.clip();

    context.strokeStyle = 'rgba(248, 250, 252, 0.08)';
    context.lineWidth = 2;

    for (let gridX = x + 80; gridX < x + width; gridX += 80) {
      context.beginPath();
      context.moveTo(gridX, y);
      context.lineTo(gridX, y + height);
      context.stroke();
    }

    for (let gridY = y + 80; gridY < y + height; gridY += 80) {
      context.beginPath();
      context.moveTo(x, gridY);
      context.lineTo(x + width, gridY);
      context.stroke();
    }

    const preview = routePreviewData(stats.locations || [], width, height, 54);

    if (!preview?.points?.length) {
      context.fillStyle = 'rgba(248, 250, 252, 0.74)';
      context.font = canvasFont(34, 800);
      context.textAlign = 'center';
      context.fillText('NO ROUTE DATA', x + width / 2, y + height / 2 + 12);
      context.restore();
      return;
    }

    context.translate(x, y);

    if (preview.points.length > 1) {
      context.beginPath();
      preview.points.forEach((point, index) => {
        if (index === 0) {
          context.moveTo(point.x, point.y);
          return;
        }

        context.lineTo(point.x, point.y);
      });

      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.shadowColor = 'rgba(34, 211, 238, 0.34)';
      context.shadowBlur = 18;
      context.strokeStyle = '#f8fafc';
      context.lineWidth = 16;
      context.stroke();
      context.shadowBlur = 0;
    }

    [
      [preview.start, '#22d3ee'],
      [preview.end, '#d946ef'],
    ].forEach(([point, color]) => {
      context.beginPath();
      context.fillStyle = color;
      context.arc(point.x, point.y, 16, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 6;
      context.strokeStyle = '#05070b';
      context.stroke();
    });

    context.restore();
  }

  function createDailyImageCanvas() {
    const stats = dailyState.stats || dailySummaryFromLocations([]);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const size = DAILY_IMAGE_SIZE;
    const margin = 72;
    const contentWidth = size - margin * 2;
    const title = dailyAchievementTitle(stats);
    const subtitle = dailyAchievementSubtitle(stats);

    canvas.width = size;
    canvas.height = size;

    context.fillStyle = '#f8fafc';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#05070b';
    context.fillRect(0, 0, size, 20);
    context.fillStyle = '#22d3ee';
    context.fillRect(0, 20, size * 0.34, 12);
    context.fillStyle = '#d946ef';
    context.fillRect(size * 0.34, 20, size * 0.33, 12);
    context.fillStyle = '#84cc16';
    context.fillRect(size * 0.67, 20, size * 0.33, 12);

    context.fillStyle = '#05070b';
    context.textAlign = 'left';
    context.font = canvasFont(30, 900);
    context.fillText('MAGWALK', margin, 92);
    context.textAlign = 'right';
    context.font = canvasFont(27, 800);
    context.fillText(achievementDateText(dailyState.selectedDate), size - margin, 92);

    context.textAlign = 'left';
    const titleSize = fitCanvasText(context, title, contentWidth, 80, 48, 950);
    context.font = canvasFont(titleSize, 950);
    context.fillStyle = '#05070b';
    context.fillText(title, margin, 182);
    context.font = canvasFont(31, 650);
    context.fillStyle = '#374151';
    drawWrappedCanvasText(context, subtitle, margin, 234, contentWidth, 42, 2);

    drawCanvasRoute(context, stats, margin, 330, contentWidth, 278);

    const statY = 652;
    const statHeight = 176;
    const statGap = 16;
    const statWidth = (contentWidth - statGap * 3) / 4;
    const statItems = [
      ['DISTANCE', formatDistance(stats.distanceMeters || 0)],
      ['STEPS', formatInteger(stats.estimatedSteps || 0)],
      ['AVG PACE', formatPace(stats)],
      ['MOVING', formatDurationCompact(stats.durationMs || 0)],
    ];

    statItems.forEach(([label, value], index) => {
      const x = margin + index * (statWidth + statGap);
      fillRoundedRect(context, x, statY, statWidth, statHeight, 22, '#ffffff');
      strokeRoundedRect(context, x, statY, statWidth, statHeight, 22, 'rgba(5, 7, 11, 0.12)', 2);
      context.fillStyle = ['#0891b2', '#7c3aed', '#65a30d', '#db2777'][index];
      context.font = canvasFont(22, 900);
      context.textAlign = 'left';
      context.fillText(label, x + 24, statY + 48);
      context.fillStyle = '#05070b';
      context.font = canvasFont(fitCanvasText(context, value, statWidth - 48, 46, 28, 950), 950);
      context.fillText(value, x + 24, statY + 118);
    });

    fillRoundedRect(context, margin, 866, contentWidth, 106, 24, '#05070b');
    context.fillStyle = '#f8fafc';
    context.font = canvasFont(30, 850);
    context.textAlign = 'left';
    context.fillText(timeRangeText(stats), margin + 28, 930);
    context.textAlign = 'right';
    context.fillText(`${formatInteger(stats.pointCount || 0)} points`, size - margin - 28, 930);

    context.fillStyle = '#6b7280';
    context.font = canvasFont(23, 750);
    context.textAlign = 'center';
    context.fillText('Built from local 00:00-24:00 Magwalk location records', size / 2, 1022);

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Could not create PNG image.'));
      }, 'image/png');
    });
  }

  async function createDailyImageBlob() {
    return canvasToBlob(createDailyImageCanvas());
  }

  function dailyImageFileName() {
    return `magwalk-daily-${dailyState.selectedDate || toDateInputValue(new Date())}.png`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleDailyDownload() {
    try {
      setDailyLoading(true);
      setDailyStatus('PNG 이미지를 만드는 중입니다.');
      const blob = await createDailyImageBlob();
      downloadBlob(blob, dailyImageFileName());
      setDailyStatus('정사각형 PNG 이미지를 내려받았습니다.');
    } catch (error) {
      setDailyStatus(`이미지를 만들지 못했습니다: ${error.message}`);
    } finally {
      setDailyLoading(false);
    }
  }

  async function handleDailyShare() {
    try {
      setDailyLoading(true);
      setDailyStatus('공유 이미지를 준비하는 중입니다.');
      const blob = await createDailyImageBlob();
      const file = new File([blob], dailyImageFileName(), { type: 'image/png' });

      if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
        downloadBlob(blob, dailyImageFileName());
        setDailyStatus('이 브라우저는 이미지 공유를 지원하지 않아 PNG로 내려받았습니다.');
        return;
      }

      await navigator.share({
        files: [file],
        title: 'Magwalk Daily Achievement',
        text: dailyAchievementSubtitle(dailyState.stats),
      });
      setDailyStatus('공유 시트를 열었습니다.');
    } catch (error) {
      if (error.name !== 'AbortError') {
        setDailyStatus(`공유하지 못했습니다: ${error.message}`);
      }
    } finally {
      setDailyLoading(false);
    }
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
    const pointCount = mapState.coordinates.length;
    pathCount.textContent = formatCompactNumber(pointCount);
    pathCount.closest('.path-count')?.setAttribute('aria-label', `${pointCount} path points`);
  }

  function updateRouteStats() {
    if (!distanceStat || !averageSpeedStat || !stepCountStat) {
      return;
    }

    const stats = routeStatsFromLocations(mapState.locations);
    distanceStat.textContent = formatDistance(stats.distanceMeters);
    averageSpeedStat.textContent = formatSpeed(stats.averageSpeedKmh);
    stepCountStat.textContent = formatInteger(stats.estimatedSteps);
    distanceStat.closest('.route-stat')?.setAttribute('aria-label', `Distance ${formatDistance(stats.distanceMeters)}`);
    averageSpeedStat.closest('.route-stat')?.setAttribute(
      'aria-label',
      `Average speed ${stats.averageSpeedKmh.toFixed(2)} kilometers per hour`
    );
    stepCountStat.closest('.route-stat')?.setAttribute(
      'aria-label',
      `${Math.round(stats.estimatedSteps) || 0} estimated steps`
    );
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

  dailySummaryModal?.addEventListener('shown.bs.modal', initDailySummary);

  dailyDateInput?.addEventListener('change', () => {
    selectDailyDate(dailyDateInput.value);
  });

  dailyTodayButton?.addEventListener('click', () => {
    selectDailyDate(toDateInputValue(new Date()));
  });

  dailyPreviousMonthButton?.addEventListener('click', () => {
    moveDailyMonth(-1);
  });

  dailyNextMonthButton?.addEventListener('click', () => {
    moveDailyMonth(1);
  });

  dailyDownloadButton?.addEventListener('click', handleDailyDownload);
  dailyShareButton?.addEventListener('click', handleDailyShare);

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
