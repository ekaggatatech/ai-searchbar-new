import {
  saveDiscoveredActions,
  findRegisteredAction
} from "./actionRegistry";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import {
  discoverCurrentPage,
  findDiscoveredButton,
  isSensitiveButton,
  isVisible,
  observePageButtons,
} from "./autoDiscovery";

import "./AISearchBar.css";

const PENDING_KEY = "hourmaker_pending_ai_action";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"
).replace(/\/+$/, "");

const API_URL = `${API_BASE_URL}/api/assistant/chat`;

const STOP_WORDS = [
  "i", "me", "my", "the", "a", "an", "to",
  "please", "can", "could", "would", "want",
  "like", "need", "show", "open", "go", "take",
  "bring", "navigate", "get", "see", "view",
  "let", "us"
];

const PENDING_MAX_AGE = 2 * 60 * 1000;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
  Find the capability selected by NVIDIA.
*/
function getSelectedCapability(result, capabilities) {
  if (
    !result ||
    result.type !== "tool_result" ||
    result.tool !== "select_capability" ||
    !result.result ||
    result.result.success !== true ||
    !result.result.capabilityId
  ) {
    return null;
  }

  return (
    capabilities.find(
      (item) => item.id === result.result.capabilityId
    ) || null
  );
}

/*
  NVIDIA backend request.
*/
async function askAssistant(query, capabilities, mode) {
  let response;

  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        capabilities,
        mode,
      }),
    });
  } catch (error) {
    console.error("Backend connection error:", error);

    throw new Error(
      `Cannot connect to backend. Check whether it is running at ${API_BASE_URL}`
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Backend returned an invalid response. HTTP status: ${response.status}`
    );
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      data.message ||
      data.answer ||
      `Backend request failed. HTTP status: ${response.status}`
    );
  }

  return data;
}

/*
  Wait until React renders the destination page actions.
*/
async function waitForDiscoveredButtons() {
  const maxAttempts = 20;
  const delay = 250;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const buttons = discoverCurrentPage();

    if (buttons.length > 0) {
      return buttons;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return [];
}

/*
  Convert discovered DOM elements into AI capabilities.
*/
function toButtonCapabilities(buttons) {
  return buttons
    .filter(
      (item) =>
        item &&
        item.id &&
        item.enabled !== false &&
        item.visible !== false
    )
    .map((item) => ({
      id: item.id,
      name: item.name || item.label || "",
      label: item.label || item.name || "",
      description:
        item.description ||
        item.name ||
        item.label ||
        "",

      type: "action",
      category: item.category || "ui-action",

      page: item.page,
      pageTitle: item.pageTitle,

      risk: item.risk,
      sensitive: item.sensitive,

      enabled: item.enabled !== false,
      visible: item.visible !== false,
    }));
}

/*
  Match an action directly when the user's words uniquely
  identify one visible action.
*/
function findExactActionMatch(query, capabilities) {
  const ignored = new Set([
    "a", "an", "the", "please", "my", "me", "i", "to"
  ]);

  const queryWords = normalize(query)
    .split(" ")
    .filter((word) => word && !ignored.has(word));

  if (!queryWords.length) return null;

  const matches = capabilities.filter((item) => {
    if (
      item.type !== "action" ||
      item.enabled === false ||
      item.visible === false
    ) {
      return false;
    }

    const candidateWords = normalize(
      `${item.name || ""} ${item.label || ""}`
    )
      .split(" ")
      .filter(Boolean);

    return queryWords.every((queryWord) =>
      candidateWords.some(
        (candidateWord) =>
          candidateWord === queryWord ||
          candidateWord.startsWith(queryWord)
      )
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

function isPageNameQuery(query, page) {
  const ignored = new Set([
    ...STOP_WORDS,
    "page",
    "section"
  ]);

  const queryWords = normalize(query)
    .split(" ")
    .filter((word) => word && !ignored.has(word));

  const pageWords = normalize(
    `${page?.name || ""} ${page?.title || ""} ${page?.path || ""}`
  ).split(" ").filter(Boolean);

  return (
    queryWords.length > 0 &&
    queryWords.every((word) =>
      pageWords.some(
        (pageWord) =>
          pageWord === word || pageWord.startsWith(word)
      )
    )
  );
}


function isRelevantAction(query, capability) {
  const ignoredWords = new Set([
    ...STOP_WORDS,
    "member",
    "members",
    "team",
    "page",
    "section"
  ]);

  const queryWords = normalize(query)
    .split(" ")
    .filter((word) => word && !ignoredWords.has(word));

  const actionText = normalize(
    `${capability?.name || ""} ${capability?.label || ""} ${capability?.description || ""}`
  );

  // Require at least one meaningful matching word.
  if (queryWords.length === 0) {
    return false;
  }

  return queryWords.some((word) =>
    actionText.split(" ").some(
      (actionWord) =>
        actionWord === word || actionWord.startsWith(word)
    )
  );
}


/*
  Safety check before executing an action.
*/

function canExecuteButton(button, capability) {
  const risk = String(capability?.risk || "").toLowerCase();

  const requiresManualAction = [
    "high",
    "confirm",
    "manual",
    "critical"
  ].includes(risk);

  const hasConfirmationAttribute =
    button?.getAttribute("data-ai-confirm") === "true" ||
    button?.getAttribute("data-ai-sensitive") === "true";

  return Boolean(
    button &&
    button.isConnected &&
    !button.disabled &&
    button.getAttribute("aria-disabled") !== "true" &&
    isVisible(button) &&
    capability &&
    capability.sensitive !== true &&
    !requiresManualAction &&
    !hasConfirmationAttribute &&
    !isSensitiveButton(button)
  );
}


/*
  Read pending action safely.
*/
function getPendingAction() {
  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(PENDING_KEY);

    if (!raw) return null;

    const pending = JSON.parse(raw);

    if (
      !pending ||
      typeof pending.query !== "string" ||
      typeof pending.path !== "string"
    ) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }

    if (
      !pending.createdAt ||
      Date.now() - pending.createdAt > PENDING_MAX_AGE
    ) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }

    return pending;
  } catch (error) {
    console.error("Pending action error:", error);
    sessionStorage.removeItem(PENDING_KEY);
    return null;
  }
}

export default function AISearchBar({
  role,
  pageCapabilities = [],
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const currentRole = String(role || "employee").toLowerCase();

  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const [error, setError] = useState("");
  const [discoveredCapabilities, setDiscoveredCapabilities] = useState([]);

  /*
    Use route capabilities supplied by App.jsx.
    No searchData.js or duplicate page catalogue.
  */
  const availablePages = useMemo(() => {
    if (!Array.isArray(pageCapabilities)) return [];

    return pageCapabilities.filter((item) => {
      const allowedRoles = Array.isArray(item.roles)
        ? item.roles.map((value) => String(value).toLowerCase())
        : [];

      return (
        item &&
        item.path &&
        (!allowedRoles.length || allowedRoles.includes(currentRole))
      );
    });
  }, [pageCapabilities, currentRole]);

  /*
    Automatically discover current page buttons.
  */
  useEffect(() => {
    let stopObserving = () => {};
    let cancelled = false;

    const startDiscovery = () => {
      if (cancelled) return;

      const initialButtons = discoverCurrentPage();

setDiscoveredCapabilities(initialButtons);
saveDiscoveredActions(initialButtons);

      stopObserving = observePageButtons((updatedButtons) => {
        if (!cancelled) {
          setDiscoveredCapabilities(updatedButtons);
          saveDiscoveredActions(updatedButtons);
        }
      });
    };

    const timer = setTimeout(startDiscovery, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopObserving();
    };
  }, [
    location.pathname,
    location.search,
    location.key,
  ]);

  /*
    Suggestions are generated from App.jsx route metadata.
  */
  const meaningfulWords = normalize(query)
    .split(/\s+/)
    .filter(
      (word) => word && !STOP_WORDS.includes(word)
    );

  const suggestions = useMemo(() => {
    if (!meaningfulWords.length) return [];

    return availablePages
      .filter((item) => {
        const searchableText = normalize(
          [
            item.name,
            item.title,
            item.description,
            item.pageTitle,
            item.path,
          ].filter(Boolean).join(" ")
        );

        const searchableWords = searchableText.split(/\s+/);

        return meaningfulWords.every((queryWord) =>
          searchableWords.some((word) =>
            word.startsWith(queryWord)
          )
        );
      })
      .slice(0, 5);
  }, [availablePages, meaningfulWords.join(" ")]);

  function clearSearch() {
    setQuery("");
    setShowSuggestions(false);
    setAiResponse("");
    setError("");
  }

  function openPage(path) {
    sessionStorage.removeItem(PENDING_KEY);
    clearSearch();
    navigate(path);
  }

  /*
    Execute a discovered action only after safety checks.
  */
  function executeAction(capability) {
    const button = findDiscoveredButton(capability);

    if (!canExecuteButton(button, capability)) {
      setAiResponse(
        capability?.sensitive || capability?.risk === "manual"
          ? "This operation requires manual action."
          : "The requested action is no longer available."
      );

      return false;
    }

    button.click();

    setAiResponse(
      `Clicked: ${capability.name || capability.label}`
    );

    return true;
  }

  /*
    Continue a pending action after navigation.
  */
  useEffect(() => {
    let cancelled = false;

    async function continuePendingAction() {
      const pending = getPendingAction();

      if (!pending) return;

      if (
        pending.role &&
        String(pending.role).toLowerCase() !== currentRole
      ) {
        sessionStorage.removeItem(PENDING_KEY);
        setAiResponse("This action is not available for your role.");
        return;
      }

      const targetPath = pending.path;

const currentPath =
  location.pathname + location.search;

if (currentPath !== targetPath) return;

      setLoading(true);
      setAiResponse("");
      setError("");

      try {
        const discovered = await waitForDiscoveredButtons();

        if (cancelled) return;

        const capabilities = toButtonCapabilities(discovered);

        if (!capabilities.length) {
          sessionStorage.removeItem(PENDING_KEY);
          setAiResponse("No actions were found on this page.");
          return;
        }

        let selected = findExactActionMatch(
          pending.query,
          capabilities
        );

        if (!selected) {
          const result = await askAssistant(
            pending.query,
            capabilities,
            "action"
          );

          if (cancelled) return;

          selected = getSelectedCapability(result, capabilities);

          if (
            !selected ||
            !result.result ||
            result.result.intent !== "action"
          ) {
            sessionStorage.removeItem(PENDING_KEY);
            setAiResponse("No matching action was found.");
            return;
          }
        }

        sessionStorage.removeItem(PENDING_KEY);

        executeAction(selected);
      } catch (err) {
        console.error("Pending action error:", err);

        if (!cancelled) {
          setError(err.message || "Unable to complete the action.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    const timer = setTimeout(continuePendingAction, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    location.pathname,
    location.search,
    location.key,
    currentRole,
  ]);

  /*
    Main search flow:
    1. Check current page actions.
    2. Ask NVIDIA to select a current page action.
    3. Ask NVIDIA to select a destination route.
    4. Navigate or queue an action for the destination page.
  */
  async function handleSearch(event) {
    event.preventDefault();

    const searchTerm = query.trim();

    if (!searchTerm || loading) return;

    setShowSuggestions(false);
    setAiResponse("");
    setError("");
    setLoading(true);

    sessionStorage.removeItem(PENDING_KEY);

    try {
      const discovered = await waitForDiscoveredButtons();
      const capabilities = toButtonCapabilities(discovered);

      console.log(
        "Hourmaker AI: Current page actions",
        capabilities
      );

      // STEP 1: Direct action match.
      const directMatch = findExactActionMatch(
        searchTerm,
        capabilities
      );

      if (directMatch) {
        executeAction(directMatch);
        return;
      }

// STEP 2: Search previously discovered actions
// from all visited pages.
const registeredAction = findRegisteredAction(searchTerm);


if (registeredAction) {
  const currentPage =
    location.pathname + location.search;

  if (registeredAction.page !== currentPage) {
    // Remove any old pending auto-execution request.
    sessionStorage.removeItem(PENDING_KEY);

    setQuery("");
    setShowSuggestions(false);

    setAiResponse(
      `Navigating to ${registeredAction.pageTitle || "the relevant page"}...`
    );

    navigate(registeredAction.page);
    return;
  }
}



      // STEP 2: Ask NVIDIA to identify a current page action.
      if (capabilities.length > 0) {
        const actionResult = await askAssistant(
          searchTerm,
          capabilities,
          "action"
        );

        const selectedAction = getSelectedCapability(
          actionResult,
          capabilities
        );

        if (
  selectedAction &&
  actionResult.result &&
  actionResult.result.intent === "action" &&
  isRelevantAction(searchTerm, selectedAction)
) {
  executeAction(selectedAction);
  return;
}
      }

      // STEP 3: Use route metadata supplied by App.jsx.
      if (!availablePages.length) {
        setAiResponse("No pages are available for your role.");
        return;
      }

      const routeResult = await askAssistant(
        searchTerm,
        availablePages,
        "route"
      );

      const selectedPage = getSelectedCapability(
        routeResult,
        availablePages
      );

      if (
        !selectedPage ||
        !selectedPage.path ||
        !routeResult.result
      ) {
        setAiResponse(
          routeResult.answer || "No matching page or action found."
        );
        return;
      }

      const intent = routeResult.result.intent;

      // STEP 4: Normal page navigation.
     
const isDirectPageRequest = isPageNameQuery(
  searchTerm,
  selectedPage
);

// Normal page request: navigate without clicking a button.
if (isDirectPageRequest) {
  sessionStorage.removeItem(PENDING_KEY);
  clearSearch();

  navigate(selectedPage.path);
  return;
}

// Section/action request: navigate first, then discover
// and select the matching button on the destination page.
sessionStorage.setItem(
  PENDING_KEY,
  JSON.stringify({
    query: searchTerm,
    path: selectedPage.path,
    role: currentRole,
    createdAt: Date.now()
  })
);

setQuery("");
setShowSuggestions(false);

setAiResponse(
  `Opening ${selectedPage.name || selectedPage.title} to find the requested section...`
);

navigate(selectedPage.path);
return;


      setAiResponse("No matching page or action found.");
    } catch (err) {
      console.error("Hourmaker AI search error:", err);

      setError(
        err.message || "Unable to connect to Hourmaker AI."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleChange(event) {
    setQuery(event.target.value);
    setAiResponse("");
    setError("");
    setShowSuggestions(true);
  }

  return (
    <div className="ai-search-container">
      <form
        className="ai-search-form"
        onSubmit={handleSearch}
      >
        <span className="search-icon">✧</span>

        <input
          type="text"
          placeholder="Ask Hourmaker AI or search your workspace..."
          value={query}
          onChange={handleChange}
          onFocus={() => {
            if (query.trim()) {
              setShowSuggestions(true);
            }
          }}
          disabled={loading}
        />

        {query && (
          <button
            type="button"
            className="search-clear-button"
            onClick={clearSearch}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}

        <button
          type="submit"
          className="unified-search-button"
          disabled={loading || !query.trim()}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {showSuggestions && query.trim() && !loading && (
        <div className="search-suggestions">
          {suggestions.length > 0 ? (
            suggestions.map((item) => (
              <button
                type="button"
                className="suggestion-item"
                key={item.id}
                onClick={() => openPage(item.path)}
              >
                <span className="suggestion-icon">⌕</span>

                <span>
                  <strong>
                    {item.name || item.title || item.pageTitle}
                  </strong>

                  <small>
                    {item.description || item.path}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <div className="no-suggestions">
              No direct suggestions. Press Search to ask Hourmaker AI.
            </div>
          )}
        </div>
      )}

      {(aiResponse || error) && (
        <div className="ai-answer ai-response">
          <h3>✧ Hourmaker AI</h3>

          {aiResponse && <p>{aiResponse}</p>}

          {error && (
            <p className="search-error">{error}</p>
          )}
        </div>
      )}

      {loading && (
        <div className="ai-loading-overlay">
          <div className="ai-loading-card">
            <div className="ai-loading-spinner" />

            <h3>Hourmaker AI is thinking...</h3>

            <p>
              Understanding your request and discovering available actions.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
