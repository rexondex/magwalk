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

  async function loadCurrentUser() {
    const response = await fetch('/api/me');

    if (!response.ok) {
      window.location.href = '/signin';
      return;
    }

    const result = await response.json();
    accountName.textContent = result.user.username;
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

  loadCurrentUser();
})();
