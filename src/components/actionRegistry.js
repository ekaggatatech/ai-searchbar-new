
/*
  src/components/actionRegistry.js

  Stores discovered action metadata across visited pages.
  Does not store DOM elements.
*/

const STORAGE_KEY = "hourmaker_action_registry_v1";

const STOP_WORDS = new Set([
  "i", "me", "my", "the", "a", "an", "to",
  "please", "can", "could", "would", "want",
  "like", "need", "show", "open", "go", "take",
  "bring", "navigate", "get", "see", "view",
  "find", "search", "for", "on", "in", "us"
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(value) {
  return normalize(value)
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word));
}

function readRegistry() {
  if (typeof window === "undefined") return [];

  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Hourmaker AI registry read error:", error);
    return [];
  }
}

function writeRegistry(actions) {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(actions)
    );
  } catch (error) {
    console.error("Hourmaker AI registry save error:", error);
  }
}

/*
  Stable key based on page and action ID.
*/
function getActionKey(action) {
  return `${action.page || ""}::${String(action.name || "").toLowerCase().trim()}::${String(action.label || "").toLowerCase().trim()}`;
}

/*
  Save discovered actions from the current page.
*/
export function saveDiscoveredActions(capabilities = []) {
  if (!Array.isArray(capabilities) || !capabilities.length) {
    return readRegistry();
  }

  const registry = readRegistry();

const cleanedRegistry = registry.filter((item) => {
  if (
    item.name === "Member Status" &&
    item.page === "/team"
  ) {
    return false;
  }

  return true;
});

const actionMap = new Map(
  cleanedRegistry.map((item) => [getActionKey(item), item])
);

  capabilities.forEach((item) => {
    if (
      !item ||
      !item.id ||
      !item.page ||
      !item.name ||
      item.enabled === false ||
      item.visible === false
    ) {
      return;
    }

    const action = {
      id: String(item.id),
      name: String(item.name),
      label: String(item.label || item.name),
      description: String(item.description || item.name),
      category: String(item.category || "ui-action"),
      page: String(item.page),
      pageTitle: String(item.pageTitle || ""),
      risk: String(item.risk || "normal"),
      sensitive: item.sensitive === true,
      type: "action",
      lastSeenAt: Date.now()
    };

    actionMap.set(getActionKey(action), action);
  });

  const updated = Array.from(actionMap.values());

  // Keep the registry bounded.
  const limited = updated.slice(-500);

  writeRegistry(limited);

  return limited;
}

export function getRegisteredActions() {
  return readRegistry();
}

/*
  Find one unique action matching the user's request.
  Ambiguous matches are deliberately rejected.
*/
export function findRegisteredAction(query) {
  const queryWords = getWords(query);

  if (!queryWords.length) return null;

  const actions = readRegistry();

  const matches = actions
    .map((action) => {
      const name = normalize(
        `${action.name} ${action.label}`
      );

      const description = normalize(action.description);
      const nameWords = name.split(" ").filter(Boolean);
      const descriptionWords = description.split(" ").filter(Boolean);

      const allWordsMatch = queryWords.every((word) =>
        nameWords.some(
          (candidate) =>
            candidate === word || candidate.startsWith(word)
        )
      );

      if (!allWordsMatch) return null;

      const exactName = queryWords.every((word) =>
        nameWords.includes(word)
      );

      const score =
        (exactName ? 100 : 50) +
        queryWords.length * 10 +
        (descriptionWords.length ? 1 : 0);

      return { action, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!matches.length) return null;

  // Do not guess if two actions have the same best score.
  if (
    matches.length > 1 &&
    matches[0].score === matches[1].score &&
    getActionKey(matches[0].action) !==
      getActionKey(matches[1].action)
  ) {
    return null;
  }

  return matches[0].action;
}

/*
  Optional utility for clearing stored action metadata.
*/
export function clearActionRegistry() {
  if (typeof window === "undefined") return;

  sessionStorage.removeItem(STORAGE_KEY);
}
