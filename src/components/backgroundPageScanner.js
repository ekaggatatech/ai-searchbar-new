
const SCAN_PARAM = "__hourmaker_background_scan";
const MESSAGE_TYPE = "HOURMAKER_PAGE_SCAN_RESULT";

function withScanParam(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set(SCAN_PARAM, "1");
  return url.pathname + url.search + url.hash;
}

export function isBackgroundScanFrame() {
  return new URLSearchParams(window.location.search).get(SCAN_PARAM) === "1";
}

export function startBackgroundPageScan({
  pages = [],
  onPageScanned = () => {},
  onProgress = () => {},
  timeoutMs = 12000,
} = {}) {
  if (typeof window === "undefined" || isBackgroundScanFrame()) {
    return () => {};
  }

  let stopped = false;
  let index = 0;
  let activeFrame = null;
  let timeoutId = null;

  const routes = [
    ...new Map(
      pages
        .filter((page) => page?.path && page.path !== "*")
        .map((page) => [page.path, page])
    ).values(),
  ];

  function cleanupFrame() {
    clearTimeout(timeoutId);

    if (activeFrame) {
      activeFrame.remove();
      activeFrame = null;
    }
  }

  function scanNext() {
    if (stopped || index >= routes.length) {
      cleanupFrame();
      onProgress({
        completed: index,
        total: routes.length,
        done: true,
      });
      return;
    }

    const page = routes[index];
    const frame = document.createElement("iframe");

    activeFrame = frame;

    frame.title = "Hourmaker background page scanner";
    frame.setAttribute("aria-hidden", "true");

    Object.assign(frame.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      left: "-10000px",
      top: "0",
      opacity: "0",
      pointerEvents: "none",
      border: "0",
    });

    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return;

      const data = event.data;

      if (
        !data ||
        data.type !== MESSAGE_TYPE ||
        data.path !== page.path
      ) {
        return;
      }

      window.removeEventListener("message", handleMessage);

      if (!stopped) {
        onPageScanned({
          ...page,
          actions: Array.isArray(data.actions) ? data.actions : [],
          scannedAt: Date.now(),
          scanStatus: "complete",
        });

        index += 1;

        onProgress({
          completed: index,
          total: routes.length,
          page: page.path,
          done: false,
        });
      }

      cleanupFrame();
      scanNext();
    };

    window.addEventListener("message", handleMessage);

    frame.onload = () => {
      // The child page reports after React has rendered.
      // Keep a timeout in case a route cannot be scanned.
    };

    timeoutId = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);

      if (!stopped) {
        onPageScanned({
          ...page,
          actions: [],
          scannedAt: Date.now(),
          scanStatus: "timeout",
        });

        index += 1;
      }

      cleanupFrame();
      scanNext();
    }, timeoutMs);

    frame.src = withScanParam(page.path);
    document.body.appendChild(frame);
  }

  scanNext();

  return () => {
    stopped = true;
    cleanupFrame();
  };
}
