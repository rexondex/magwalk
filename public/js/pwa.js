(function () {
  const INSTALL_READY_EVENT = 'magwalk:pwa-install-ready';
  const INSTALL_CHANGED_EVENT = 'magwalk:pwa-install-changed';
  let installPrompt = null;
  let serviceWorkerRegistrationPromise = null;

  function isStandalone() {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function dispatchInstallState() {
    window.dispatchEvent(
      new CustomEvent(INSTALL_CHANGED_EVENT, {
        detail: {
          isStandalone: isStandalone(),
          canPrompt: Boolean(installPrompt),
        },
      })
    );
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return Promise.resolve(null);
    }

    if (!serviceWorkerRegistrationPromise) {
      serviceWorkerRegistrationPromise = navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((error) => {
          console.warn('Magwalk service worker registration failed:', error);
          return null;
        });
    }

    return serviceWorkerRegistrationPromise;
  }

  async function promptInstall() {
    if (isStandalone()) {
      return { outcome: 'installed' };
    }

    if (!installPrompt) {
      return { outcome: 'manual' };
    }

    const promptEvent = installPrompt;
    installPrompt = null;
    const result = await promptEvent.prompt();
    dispatchInstallState();
    return result || { outcome: 'unknown' };
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    window.dispatchEvent(new CustomEvent(INSTALL_READY_EVENT));
    dispatchInstallState();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    dispatchInstallState();
  });

  window.MagwalkPWA = {
    canPromptInstall: () => Boolean(installPrompt),
    clearPrivateCache() {
      navigator.serviceWorker?.controller?.postMessage({ type: 'MAGWALK_CLEAR_PRIVATE_CACHE' });
    },
    getRegistration: registerServiceWorker,
    isStandalone,
    promptInstall,
  };

  registerServiceWorker().then(dispatchInstallState);
})();
