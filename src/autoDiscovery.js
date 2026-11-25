
/*
  src/components/autoDiscovery.js

  Automatically discovers visible buttons and action links
  on the currently rendered Hourmaker page.

  Safety:
  - Discovery only reads and describes visible controls.
  - This module never clicks or executes discovered controls.
  - The user must explicitly click a page control to execute it.
*/

const ELEMENT_ID_ATTRIBUTE = "data-hourmaker-ai-id";

const discoveredElements = new Map();
const elementIds = new WeakMap();

let nextElementId = 1;

/* -----------------------------------------
   Get main page content
----------------------------------------- */

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

/* -----------------------------------------
   Get button label
----------------------------------------- */

export function getElementLabel(element) {
  if (!element) return "";

  const ariaLabel = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  const text = element.innerText || element.textContent || "";

  return String(ariaLabel || title || text)
    .replace(/\s+/g, " ")
    .trim();
}

/* -----------------------------------------
   Check visibility
----------------------------------------- */

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

/* -----------------------------------------
   Check disabled state
----------------------------------------- */

export function isDisabled(element) {
  return Boolean(
    element.disabled === true ||
    element.getAttribute("aria-disabled") === "true"
  );
}

/* -----------------------------------------
   Read manually declared risk
----------------------------------------- */

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

/* -----------------------------------------
   Check sensitive actions
----------------------------------------- */

export function isSensitiveButton(element) {
  if (!element) return false;

  const category = String(
    element.getAttribute("data-ai-category") || ""
  ).toLowerCase();

  const actionId = String(
    element.getAttribute("data-ai-action-id") || ""
  ).toLowerCase();

  const description = String(
    element.getAttribute("data-ai-description") || ""
  ).toLowerCase();

  // Allow section navigation even if its label contains
  // words like Remove, Edit, or Delete.
  const isSectionNavigation =
    category === "navigation" &&
    (
      actionId.startsWith("section-") ||
      /open the .* section/.test(description)
    );

  if (isSectionNavigation) {
    return false;
  }

  const label = [
    getElementLabel(element),
    description
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

/* -----------------------------------------
   Calculate action risk
----------------------------------------- */

function getRisk(element) {
  const declaredRisk = getDeclaredRisk(element);

  // Explicit manual risk always takes priority.
  if (declaredRisk === "manual") {
    return "manual";
  }

  // Automatically protect sensitive actions.
  if (isSensitiveButton(element)) {
    return "manual";
  }

  return declaredRisk || "normal";
}

/* -----------------------------------------
   Get eligible buttons and links
----------------------------------------- */

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

/* -----------------------------------------
   Generate unique element ID
----------------------------------------- */

function getElementId(element) {
  const existingId = elementIds.get(element);

  if (existingId) {
    return existingId;
  }

  const declaredId = element.getAttribute("data-ai-action-id");

  let id = declaredId
    ? String(declaredId).trim()
    : element.getAttribute(ELEMENT_ID_ATTRIBUTE);

  if (!id) {
    id = `hourmaker-action-${nextElementId++}`;
  }

  element.setAttribute(ELEMENT_ID_ATTRIBUTE, id);
  elementIds.set(element, id);

  return id;
}

/* -----------------------------------------
   Discover current page actions
----------------------------------------- */

export function discoverCurrentPage() {
  if (typeof document === "undefined") {
    return [];
  }

  const elements = getEligibleButtons();
  const currentIds = new Set();

  const capabilities = elements.map((element) => {
    const id = getElementId(element);
    const label = getElementLabel(element);
    const sensitive = isSensitiveButton(element);

    currentIds.add(id);
    discoveredElements.set(id, element);
    if (!id.startsWith("action-")) {
      discoveredElements.set(`action-${id}`, element);
    }

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

      page:
        element.getAttribute("data-ai-path") ||
        (() => {
          const url = new URL(window.location.href);
          url.searchParams.delete("__hourmaker_scan");
          return url.pathname + url.search;
        })(),

      pageTitle:
        document.querySelector("h1")?.innerText ||
        document.title,

      risk: getRisk(element),
      sensitive,

      enabled: !isDisabled(element),
      visible: isVisible(element),

      elementTag: element.tagName.toLowerCase(),

      href:
        element.tagName.toLowerCase() === "a"
          ? element.getAttribute("href")
          : null
    };
  });

  // Remove stale or disconnected DOM elements.
  discoveredElements.forEach((element, id) => {
    if (!element?.isConnected) {
      discoveredElements.delete(id);
    }
  });

  return capabilities;
}

/* -----------------------------------------
   Find selected DOM element
   Resilient lookup by ID, attributes, or label
----------------------------------------- */

export function findDiscoveredButton(selected) {
  if (!selected) return null;

  const rawId = String(selected.id || "").trim();
  const cleanId = rawId
    .replace(/^action:/, "")
    .replace(/.*::/, "")
    .replace(/^action-/, "");

  // 1. Try Map lookup with various key shapes
  const candidates = [
    rawId,
    cleanId,
    `action-${cleanId}`,
    `action:${cleanId}`,
    selected.actionId,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const el = discoveredElements.get(candidate);
    if (el && el.isConnected && isVisible(el)) {
      return el;
    }
  }

  // 2. Try direct DOM query by data attributes
  if (cleanId) {
    const domEl =
      document.querySelector(`[data-ai-action-id="${cleanId}"]`) ||
      document.querySelector(`[data-ai-action-id="action-${cleanId}"]`) ||
      document.querySelector(`[data-hourmaker-ai-id="${cleanId}"]`) ||
      document.querySelector(`[data-hourmaker-ai-id="action-${cleanId}"]`) ||
      document.querySelector(`#${cleanId}`);

    if (domEl && isVisible(domEl)) {
      return domEl;
    }
  }

  // 3. Fallback: match button by exact text or aria-label
  const targetLabel = String(selected.name || selected.label || "").trim().toLowerCase();
  if (targetLabel) {
    const buttons = getEligibleButtons();
    const found = buttons.find((btn) => {
      const btnLabel = getElementLabel(btn).toLowerCase();
      return btnLabel === targetLabel || btnLabel.includes(targetLabel);
    });

    if (found) {
      return found;
    }
  }

  return null;
}

/* -----------------------------------------
   Highlight & Scroll to Action Target
----------------------------------------- */

export function highlightDiscoveredButton(element) {
  if (!element || typeof window === "undefined") return;

  try {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });

    element.classList.add("ai-highlight-target");
    if (typeof element.focus === "function") {
      element.focus({ preventScroll: true });
    }

    setTimeout(() => {
      if (element && element.classList) {
        element.classList.remove("ai-highlight-target");
      }
    }, 3600);
  } catch (err) {
    console.warn("Could not highlight element:", err);
  }
}

/* -----------------------------------------
   Observe React page changes
----------------------------------------- */

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
    console.warn(
      "Hourmaker AI: Main content not found."
    );

    return () => {};
  }

  // Initial discovery.
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
      "data-ai-sensitive",
      "data-ai-path"
    ]
  });

  // Cleanup observer.
  return function stopObserving() {
    observer.disconnect();

    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = null;
    }
  };
}
