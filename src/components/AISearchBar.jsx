import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import searchData from "../searchData";
import {
  discoverCurrentPage,
  findDiscoveredButton,
  isSensitiveButton,
  observePageButtons,
} from "./autoDiscovery";
import "./AISearchBar.css";

const PENDING_KEY = "hourmaker_pending_ai_action";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const API_URL = `${API_BASE_URL}/api/assistant/chat`;

const STOP_WORDS = ["i", "me", "my", "the", "a", "an", "to", "please", "can", "could", "would", "want", "like", "need", "show", "open", "go", "take", "bring", "navigate", "get", "see", "view", "let", "us"];

const PAGE_ALIASES = {
  Dashboard: ["home", "home page", "overview", "main page"],
  "Dashboard Statistics": ["statistics", "dashboard stats", "stats"],
  "Recent Team Activity": ["team activity", "recent activity"],
  "Dashboard Quick Actions": ["quick actions", "quick action", "actions"],
  "Team Management": ["team", "employees", "staff", "people"],
  "Team Members List": ["employee list", "team list", "all employees", "members list"],
  "Search Team Members": ["find employee", "search employee", "find member", "search members"],
  "Edit Team Member": ["edit employee", "update employee", "change employee details"],
  "Remove Team Member": ["remove employee", "delete employee", "remove member"],
  "Manage Member Status": ["member status", "employee status", "active inactive"],
  "Invite a Team Member": ["invite", "add employee", "new employee"],
  "Account Settings": ["settings", "account", "profile settings"],
  "Edit Profile": ["edit my profile", "change profile"],
  "Email Notifications": ["notifications", "email settings"],
  "Theme Settings": ["theme", "dark mode", "light mode"],
  "Billing and Payments": ["billing", "payments", "subscription"],
};

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function getSelectedCapability(result, capabilities) {
  if (!result || result.type !== "tool_result" || result.tool !== "select_capability" ||
      !result.result || result.result.success !== true || !result.result.capabilityId) return null;
  return capabilities.find((item) => item.id === result.result.capabilityId) || null;
}

async function askAssistant(query, capabilities, mode) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, capabilities, mode }),
    });
  } catch (error) {
    console.error("Backend connection error:", error);
    throw new Error(`Cannot connect to backend. Check whether it is running at ${API_BASE_URL}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Backend returned an invalid response. HTTP status: ${response.status}`);
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || data.answer || `Backend request failed. HTTP status: ${response.status}`);
  }
  return data;
}

async function waitForDiscoveredButtons() {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const buttons = discoverCurrentPage();
    if (buttons && buttons.length > 0) return buttons;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return [];
}

function toButtonCapabilities(buttons) {
  return buttons
    .filter((item) => item && item.id && item.enabled !== false && item.visible !== false)
    .map((item) => ({
      id: item.id,
      name: item.name || item.label || "",
      label: item.label || item.name || "",
      description: item.description || item.name || item.label || "",
      type: item.type || "action",
      category: item.category || "action",
      page: item.page,
      pageTitle: item.pageTitle,
      risk: item.risk,
      sensitive: item.sensitive,
      enabled: item.enabled !== false,
      visible: item.visible !== false,
    }));
}

// "generate report" matches "Generate a dashboard report", but not "Statistics".
function findExactActionMatch(query, capabilities) {
  const ignored = new Set(["a", "an", "the", "please", "my", "me", "i", "to"]);
  const queryWords = normalize(query).split(" ").filter((word) => word && !ignored.has(word));
  if (!queryWords.length) return null;

  const matches = capabilities.filter((item) => {
    if (item.type !== "action" || item.enabled === false || item.visible === false) return false;
    const candidateWords = normalize(`${item.name || ""} ${item.label || ""}`).split(" ").filter(Boolean);
    return queryWords.every((queryWord) =>
      candidateWords.some((candidateWord) => candidateWord === queryWord || candidateWord.startsWith(queryWord))
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

function canExecuteButton(button, capability) {
  return Boolean(
    button && button.isConnected && !button.disabled &&
    button.getAttribute("aria-disabled") !== "true" &&
    capability && capability.sensitive !== true &&
    capability.risk !== "manual" && !isSensitiveButton(button)
  );
}

export default function AISearchBar({ role }) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentRole = String(role || "employee").toLowerCase();

  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const [error, setError] = useState("");
  const [, setDiscoveredCapabilities] = useState([]);

  useEffect(() => {
    let stopObserving = () => {};
    const startDiscovery = () => {
      setDiscoveredCapabilities(discoverCurrentPage());
      stopObserving = observePageButtons((updatedButtons) => {
        setDiscoveredCapabilities(updatedButtons);
        console.log("Hourmaker AI: UI updated", updatedButtons);
      });
    };
    const timer = setTimeout(startDiscovery, 200);
    return () => {
      clearTimeout(timer);
      stopObserving();
    };
  }, [location.pathname, location.search, location.key]);

  const meaningfulWords = normalize(query).split(/\s+/).filter((word) => word && !STOP_WORDS.includes(word));
  const suggestions = (Array.isArray(searchData) ? searchData : [])
    .filter((item) => {
      const allowedRoles = (item.roles || []).map((itemRole) => String(itemRole).toLowerCase());
      if (!allowedRoles.includes(currentRole) || meaningfulWords.length === 0) return false;
      const searchableText = [item.title, item.description, ...(PAGE_ALIASES[item.title] || [])].join(" ");
      const searchableWords = normalize(searchableText).split(/\s+/);
      return meaningfulWords.every((queryWord) => searchableWords.some((word) => word.startsWith(queryWord)));
    })
    .slice(0, 5);

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

  // Run a queued action after navigating to its target page.
  useEffect(() => {
    let cancelled = false;

    async function continuePendingAction() {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return;

      let pending;
      try {
        pending = JSON.parse(raw);
      } catch {
        sessionStorage.removeItem(PENDING_KEY);
        return;
      }

      if (!pending || typeof pending.query !== "string" || typeof pending.path !== "string") {
        sessionStorage.removeItem(PENDING_KEY);
        return;
      }
      if (pending.role && String(pending.role).toLowerCase() !== currentRole) {
        sessionStorage.removeItem(PENDING_KEY);
        setAiResponse("No result found.");
        return;
      }
      if (location.pathname !== pending.path.split("?")[0]) return;

      sessionStorage.removeItem(PENDING_KEY);
      setLoading(true);
      setAiResponse("");
      setError("");

      try {
        const discovered = await waitForDiscoveredButtons();
        if (cancelled) return;
        const capabilities = toButtonCapabilities(discovered);
        if (!capabilities.length) {
          setAiResponse("No result found.");
          return;
        }

        let selected = findExactActionMatch(pending.query, capabilities);
        if (!selected) {
          const result = await askAssistant(pending.query, capabilities, "action");
          if (cancelled) return;
          selected = getSelectedCapability(result, capabilities);
          if (!selected || !result.result || result.result.intent !== "action") {
            setAiResponse("No result found.");
            return;
          }
        }

        const button = findDiscoveredButton(selected);
        if (!canExecuteButton(button, selected)) {
          setAiResponse(selected.sensitive || selected.risk === "manual"
            ? "This operation requires manual action."
            : "The requested action is no longer available.");
          return;
        }
        button.click();
        setAiResponse(`Clicked: ${selected.name || selected.label}`);
      } catch (err) {
        console.error("Button discovery error:", err);
        if (!cancelled) setError(err.message || "Unable to complete the action.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timer = setTimeout(continuePendingAction, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [location.pathname, location.search, location.key, currentRole]);

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
      console.log("Current page discovered actions:", capabilities);

      // First: exact/word match on the current page. This prevents a wrong tab
      // such as Statistics being clicked for a Generate Report request.
      const directMatch = findExactActionMatch(searchTerm, capabilities);
      if (directMatch) {
        const button = findDiscoveredButton(directMatch);
        if (!canExecuteButton(button, directMatch)) {
          setAiResponse(directMatch.sensitive || directMatch.risk === "manual"
            ? "This operation requires manual action."
            : "The matching button is no longer available.");
          return;
        }
        button.click();
        setAiResponse(`Clicked: ${directMatch.name || directMatch.label}`);
        return;
      }

      // Second: let NVIDIA select a current-page action if there is no unique
      // direct match.
      if (capabilities.length > 0) {
        const actionResult = await askAssistant(searchTerm, capabilities, "action");
        const selectedAction = getSelectedCapability(actionResult, capabilities);
        if (selectedAction && actionResult.result && actionResult.result.intent === "action") {
          const button = findDiscoveredButton(selectedAction);
          if (!canExecuteButton(button, selectedAction)) {
            setAiResponse(selectedAction.sensitive || selectedAction.risk === "manual"
              ? "This operation requires manual action."
              : "The requested action is no longer available.");
            return;
          }
          button.click();
          setAiResponse(`Clicked: ${selectedAction.name || selectedAction.label}`);
          return;
        }
      }

      // Third: fall back to page navigation.
      const pageCapabilities = (Array.isArray(searchData) ? searchData : [])
        .filter((item) => (item.roles || []).some((itemRole) => String(itemRole).toLowerCase() === currentRole))
        .map((item) => ({
          id: `page:${item.id}`,
          name: item.title,
          description: item.description || "",
          type: "page",
          category: "navigation",
          page: item.path,
          pageTitle: item.title,
          path: item.path,
        }));

      if (!pageCapabilities.length) {
        setAiResponse("No result found.");
        return;
      }

      const routeResult = await askAssistant(searchTerm, pageCapabilities, "route");
      const selectedPage = getSelectedCapability(routeResult, pageCapabilities);
      if (!selectedPage || !selectedPage.path || !routeResult.result) {
        setAiResponse("No result found.");
        return;
      }

      if (routeResult.result.intent === "navigate") {
        clearSearch();
        navigate(selectedPage.path, { state: { aiNavigation: Date.now() } });
        return;
      }

      if (routeResult.result.intent === "action") {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({
          query: searchTerm,
          path: selectedPage.path,
          role: currentRole,
          createdAt: Date.now(),
        }));
        setQuery("");
        setShowSuggestions(false);
        setAiResponse(`Opening ${selectedPage.name} to find the requested action...`);
        navigate(selectedPage.path, { state: { aiActionDiscovery: Date.now() } });
        return;
      }

      setAiResponse("No result found.");
    } catch (err) {
      console.error("Hourmaker AI search error:", err);
      setError(err.message || "Unable to connect to Hourmaker AI.");
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
      <form className="ai-search-form" onSubmit={handleSearch}>
        <span className="search-icon">✧</span>
        <input
          type="text"
          placeholder="Ask Hourmaker AI or search your workspace..."
          value={query}
          onChange={handleChange}
          onFocus={() => {
            if (query.trim()) setShowSuggestions(true);
          }}
          disabled={loading}
        />
        {query && (
          <button type="button" className="search-clear-button" onClick={clearSearch} aria-label="Clear search">
            ✕
          </button>
        )}
        <button type="submit" className="unified-search-button" disabled={loading || !query.trim()}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {showSuggestions && query.trim() && !loading && (
        <div className="search-suggestions">
          {suggestions.length > 0 ? (
            suggestions.map((item) => (
              <button type="button" className="suggestion-item" key={item.id} onClick={() => openPage(item.path)}>
                <span className="suggestion-icon">⌕</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="no-suggestions">No direct suggestions. Press Search to ask Hourmaker AI.</div>
          )}
        </div>
      )}

      {(aiResponse || error) && (
        <div className="ai-answer ai-response">
          <h3>✧ Hourmaker AI</h3>
          {aiResponse && <p>{aiResponse}</p>}
          {error && <p className="search-error">{error}</p>}
        </div>
      )}

      {loading && (
        <div className="ai-loading-overlay">
          <div className="ai-loading-card">
            <div className="ai-loading-spinner" />
            <h3>Hourmaker AI is thinking...</h3>
            <p>Understanding your request and discovering available actions.</p>
          </div>
        </div>
      )}
    </div>
  );
}
