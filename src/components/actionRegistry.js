
const STORAGE_KEY = "hourmaker_action_registry_v2";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readRegistry() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRegistry(actions) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch (error) {
    console.error("Could not save Hourmaker actions:", error);
  }
}

function actionKey(item) {
  return `${item.page || item.path || ""}::${item.id || normalize(item.name)}`;
}

export function saveDiscoveredActions(actions = [], pagePath) {
  if (typeof window === "undefined") return [];

  const currentPage =
    pagePath ||
    window.location.pathname + window.location.search;

  const existing = readRegistry();

  const discovered = actions
    .filter((item) => item && item.id && item.name)
    .map((item) => ({
      ...item,
      page: item.page || currentPage,
      path: item.page || item.path || currentPage,
      type: "action",
      enabled: item.enabled !== false,
      visible: item.visible !== false,
      lastSeenAt: Date.now(),
    }));

  const byKey = new Map();

  existing
    .filter((item) => item.page !== currentPage)
    .forEach((item) => byKey.set(actionKey(item), item));

  discovered.forEach((item) => {
    byKey.set(actionKey(item), item);
  });

  const result = Array.from(byKey.values()).slice(-1000);

  writeRegistry(result);
  return result;
}

export function replaceScannedPageActions(pagePath, actions = []) {
  if (typeof window === "undefined" || !pagePath) return [];

  const existing = readRegistry().filter(
    (item) => item.page !== pagePath
  );

  const discovered = actions
    .filter((item) => item && item.id && item.name)
    .map((item) => ({
      ...item,
      page: pagePath,
      path: pagePath,
      type: "action",
      enabled: item.enabled !== false,
      visible: item.visible !== false,
      lastSeenAt: Date.now(),
    }));

  const byKey = new Map();

  existing.forEach((item) => byKey.set(actionKey(item), item));
  discovered.forEach((item) => byKey.set(actionKey(item), item));

  const result = Array.from(byKey.values()).slice(-1000);
  writeRegistry(result);

  return result;
}

export function getRegisteredActions() {
  return readRegistry();
}

export function findRegisteredAction(query) {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return null;

  const matches = getRegisteredActions()
    .filter((item) => item.enabled !== false && item.visible !== false)
    .map((item) => {
      const searchable = normalize(
        `${item.name} ${item.label || ""} ${item.description || ""}`
      ).split(" ");

      const matched = words.every((word) =>
        searchable.some((candidate) => candidate === word || candidate.startsWith(word))
      );

      if (!matched) return null;

      const exact = words.filter((word) => searchable.includes(word)).length;

      return {
        item,
        score: exact * 100 + words.length * 10,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return matches[0]?.item || null;
}

export function clearActionRegistry() {
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem("hourmaker_action_registry_v1");
}
