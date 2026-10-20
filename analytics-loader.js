/* GitHub Page Insights bridge. It intentionally does nothing on localhost/LAN. */
(() => {
  'use strict';
  const expectedHost = 'mehrdadmb2.github.io';
  const expectedPath = '/PySmartHome-PC';
  if (window.location.hostname !== expectedHost || !window.location.pathname.startsWith(`${expectedPath}/`)) return;
  if (window.PAGE_INSIGHTS_CONFIG) return;

  window.PAGE_INSIGHTS_CONFIG = {
    workerUrl: 'https://github-page-insights-worker.game-developer-mb.workers.dev',
    platformId: 'pysmarthome-pc-github-pages',
    platformName: 'PySmartHome-PC GitHub Pages',
    platformType: 'web',
    environment: 'production',
    appVersion: '4.0.0',
    advancedTelemetry: false,
    trackPageLeave: false,
    trackClicks: false,
    trackScroll: false,
    trackVisibility: false,
    heartbeat: false,
    periodicQueueFlush: false
  };

  const sdk = document.createElement('script');
  sdk.src = 'https://mehrdadmb2.github.io/github-page-insights/analytics.js';
  sdk.async = true;
  sdk.onerror = () => console.warn('[PySmartHome] Page Insights SDK could not load; dashboard remains fully usable.');
  document.head.appendChild(sdk);
})();
