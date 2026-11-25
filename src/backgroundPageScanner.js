/*
 * Scans every route supplied by AISearchBar's pageCapabilities prop.
 * Uses a same-origin, off-screen iframe so the route's React UI can render
 * without navigating away from the user's current page.
 *
 * The iframe only reads visible controls and reports their metadata. It never
 * clicks controls or invokes their handlers.
 */

const SCAN_MESSAGE = "HOURMAKER_PAGE_SCAN_RESULT";
const SCAN_QUERY_KEY = "__hourmaker_scan";
const DEFAULT_ROUTE_TIMEOUT = 12000;

export function isBackgroundScanFrame() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(SCAN_QUERY_KEY) === "1";
}

function getCleanPath(path) {
  const url = new URL(path || "/", window.location.origin);
  url.searchParams.delete(SCAN_QUERY_KEY);
  return `${url.pathname}${url.search}${url.hash}`;
}

function getScanUrl(path) {
  const url = new URL(path || "/", window.location.origin);
  url.searchParams.set(SCAN_QUERY_KEY, "1");
  return url.toString();
}

function isSafeSameOriginPath(path) {
  try {
    return new URL(path || "/", window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function startBackgroundPageScan({
  pages = [],
  onPageScanned = () => {},
  onProgress = () => {},
  routeTimeout = DEFAULT_ROUTE_TIMEOUT,
} = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const routes = [...new Map(
    (Array.isArray(pages) ? pages : [])
      .filter((page) => page?.path && isSafeSameOriginPath(page.path))
      .map((page) => [getCleanPath(page.path), page])
  ).values()];

  if (!routes.length) return () => {};

  let cancelled = false;
  let index = 0;
  let timer = null;
  let iframe = null;
  let settled = false;
  let currentPage = null;

  const cleanupFrame = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
    if (iframe) {
      iframe.onload = null;
      iframe.onerror = null;
      iframe.remove();
    }
    iframe = null;
  };

  const finishCurrent = (result) => {
    if (cancelled || settled) return;
    settled = true;
    cleanupFrame();
    if (result) onPageScanned(result);
    index += 1;
    onProgress({ completed: index, total: routes.length });
    scanNext();
  };

  const handleMessage = (event) => {
    if (cancelled || event.origin !== window.location.origin || !iframe || event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.type !== SCAN_MESSAGE || !currentPage) return;

    finishCurrent({
      path: getCleanPath(data.path || currentPage.path),
      title: data.title || currentPage.title || currentPage.name || "Website",
      pageTitle: data.title || currentPage.pageTitle || currentPage.title || currentPage.name || "Website",
      actions: Array.isArray(data.actions) ? data.actions : [],
      scanStatus: "complete",
      empty: data.empty === true,
    });
  };

  const scanNext = () => {
    if (cancelled) return;
    if (index >= routes.length) {
      cleanupFrame();
      window.removeEventListener("message", handleMessage);
      return;
    }

    currentPage = routes[index];
    settled = false;
    iframe = document.createElement("iframe");
    iframe.title = "Hourmaker background page scanner";
    iframe.tabIndex = -1;
    iframe.setAttribute("aria-label", "Background page scanner");
    Object.assign(iframe.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: "1280px",
      height: "900px",
      border: "0",
      opacity: "0.01",
      pointerEvents: "none",
      zIndex: "-1",
    });

    iframe.onload = () => {
      // The app reports after React has rendered and its DOM has settled.
      // Keep a timeout in case a protected/unsupported route never reports.
    };
    iframe.onerror = () => finishCurrent({
      path: getCleanPath(currentPage.path),
      title: currentPage.title || currentPage.name || "Website",
      pageTitle: currentPage.pageTitle || currentPage.title || currentPage.name || "Website",
      actions: [],
      scanStatus: "failed",
    });

    timer = window.setTimeout(() => finishCurrent({
      path: getCleanPath(currentPage.path),
      title: currentPage.title || currentPage.name || "Website",
      pageTitle: currentPage.pageTitle || currentPage.title || currentPage.name || "Website",
      actions: [],
      scanStatus: "timeout",
    }), routeTimeout);

    iframe.src = getScanUrl(currentPage.path);
    document.body.appendChild(iframe);
  };

  window.addEventListener("message", handleMessage);
  scanNext();

  return () => {
    cancelled = true;
    cleanupFrame();
    window.removeEventListener("message", handleMessage);
  };
}
