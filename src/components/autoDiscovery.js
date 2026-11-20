
/*
  src/components/autoDiscovery.js

  Automatically discovers visible buttons and action links
  on the currently rendered Hourmaker page.
*/

const ELEMENT_ID_ATTRIBUTE = "data-hourmaker-ai-id";

const discoveredElements = new Map();
const elementIds = new WeakMap();

let nextElementId = 1;

function getMainContent() {
  if (typeof document === "undefined") return null;

  return (
    document.querySelector(".main-content") ||
    document.querySelector("#main-content") ||
    document.querySelector('[role="main"]') ||
    document.querySelector("main") ||
    document.body
  );
}

function getElementLabel(element) {
  if (!element) return "";

  const ariaLabel = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  const text = element.innerText || element.textContent || "";

  return String(ariaLabel || title || text)
    .replace(/\s+/g, " ")
    .trim();
}

export function isVisible(element) {
  if (
    !element ||
    !element.isConnected ||
    typeof window === "undefined"
  ) {
    return false;
  }

  const style = window.getComputedStyle(element);

  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0" ||
    element.hidden
  ) {
    return false;
  }

  return element.getClientRects().length > 0;
}

function isDisabled(element) {
  return Boolean(
    element.disabled === true ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function getDeclaredRisk(element) {
  const risk = String(
    element.getAttribute("data-ai-risk") || ""
  ).toLowerCase();

  const requiresConfirmation =
    element.getAttribute("data-ai-confirm") === "true" ||
    element.getAttribute("data-ai-sensitive") === "true";

  if (
    requiresConfirmation ||
    ["high", "confirm", "manual", "critical"].includes(risk)
  ) {
    return "manual";
  }

  if (["low", "normal"].includes(risk)) {
    return risk;
  }

  return null;
}

/*
  Sensitive actions must never be auto-clicked.
*/
export function isSensitiveButton(element) {
  if (!element) return false;

  const label = [
    getElementLabel(element),
    element.getAttribute("data-ai-description") || ""
  ]
    .join(" ")
    .toLowerCase();

  const sensitivePatterns = [
    "delete",
    "remove",
    "terminate",
    "deactivate",
    "disable account",
    "reset password",
    "change password",
    "logout",
    "log out",
    "sign out",
    "payment",
    "billing",
    "purchase",
    "refund",
    "approve",
    "reject",
    "send invitation",
    "invite user",
    "submit application",
    "save changes",
    "confirm",
    "publish",
    "archive"
  ];

  return sensitivePatterns.some((pattern) =>
    label.includes(pattern)
  );
}

function getRisk(element) {
  const declaredRisk = getDeclaredRisk(element);

  if (declaredRisk === "manual") return "manual";

  if (isSensitiveButton(element)) return "manual";

  return declaredRisk || "normal";
}

function getEligibleButtons() {
  const container = getMainContent();

  if (!container) return [];

  const elements = Array.from(
    container.querySelectorAll(
      [
        "button",
        '[role="button"]',
        "a[href]",
        'input[type="button"]',
        'input[type="submit"]'
      ].join(",")
    )
  );

  return elements.filter((element) => {
    const ignored = element.closest(
      [
        ".topbar",
        ".navbar",
        ".sidebar",
        ".ai-search-container",
        "[data-ai-ignore]",
        '[aria-hidden="true"]'
      ].join(",")
    );

    return (
      !ignored &&
      !isDisabled(element) &&
      isVisible(element) &&
      getElementLabel(element).length > 0
    );
  });
}

function getElementId(element) {
  const existingId = elementIds.get(element);

  if (existingId) return existingId;

  const declaredId = element.getAttribute("data-ai-action-id");

  let id = declaredId
    ? `action-${declaredId}`
    : element.getAttribute(ELEMENT_ID_ATTRIBUTE);

  // Ensure the same ID is not assigned to two DOM elements.
  if (id && discoveredElements.has(id)) {
    const existingElement = discoveredElements.get(id);

    if (existingElement !== element) {
      id = null;
    }
  }

  if (!id) {
    id = `hourmaker-action-${nextElementId++}`;
  }

  element.setAttribute(ELEMENT_ID_ATTRIBUTE, id);
  elementIds.set(element, id);

  return id;
}

/*
  Discover all eligible actions on the current page.
*/
export function discoverCurrentPage() {
  if (typeof document === "undefined") return [];

  const elements = getEligibleButtons();
  const currentIds = new Set();

  const capabilities = elements.map((element) => {
    const id = getElementId(element);
    const label = getElementLabel(element);
    const sensitive = isSensitiveButton(element);

    currentIds.add(id);
    discoveredElements.set(id, element);

    return {
      id,
      name: label,
      label,

      description:
        element.getAttribute("data-ai-description") ||
        element.getAttribute("title") ||
        element.getAttribute("aria-label") ||
        label,

      type: "action",

      category:
        element.getAttribute("data-ai-category") ||
        "ui-action",

      page: window.location.pathname + window.location.search,
      pageTitle:
        document.querySelector("h1")?.innerText ||
        document.title,

      risk: getRisk(element),
      sensitive,

      enabled: !isDisabled(element),
      visible: isVisible(element),

      elementTag: element.tagName.toLowerCase(),

      href:
        element.tagName.toLowerCase() === "A"
          ? element.getAttribute("href")
          : null
    };
  });

  // Remove stale elements, including elements hidden or removed
  // after a React page update.
  discoveredElements.forEach((element, id) => {
    if (!element?.isConnected || !currentIds.has(id)) {
      discoveredElements.delete(id);
    }
  });

  return capabilities;
}

/*
  Get the real DOM element selected by the AI.
*/
export function findDiscoveredButton(selected) {
  if (!selected?.id) return null;

  const element = discoveredElements.get(selected.id);

  if (!element || !element.isConnected || !isVisible(element)) {
    return null;
  }

  return element;
}

/*
  Observe dynamic React page changes and rediscover actions.
*/
export function observePageButtons(callback) {
  if (typeof document === "undefined") {
    return () => {};
  }

  if (typeof callback !== "function") {
    console.error(
      "Hourmaker AI: Observer callback must be a function."
    );
    return () => {};
  }

  const container = getMainContent();

  if (!container) {
    console.warn("Hourmaker AI: Main content not found.");
    return () => {};
  }

  callback(discoverCurrentPage());

  let updateTimeout = null;

  const observer = new MutationObserver(() => {
    if (updateTimeout) {
      clearTimeout(updateTimeout);
    }

    updateTimeout = setTimeout(() => {
      callback(discoverCurrentPage());
    }, 150);
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "disabled",
      "aria-disabled",
      "aria-label",
      "title",
      "class",
      "style",
      "hidden",
      "href",
      "data-ai-action-id",
      "data-ai-description",
      "data-ai-category",
      "data-ai-risk",
      "data-ai-confirm",
      "data-ai-sensitive"
    ]
  });

  return function stopObserving() {
    observer.disconnect();

    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = null;
    }
  };
}