import React, { useEffect, useMemo, useState } from "react";

import { useLocation, useNavigate } from "react-router-dom";



import {

  startBackgroundPageScan,

  isBackgroundScanFrame,

} from "./backgroundPageScanner";



import {

  discoverCurrentPage,

  findDiscoveredButton,

  highlightDiscoveredButton,

  isSensitiveButton,

  isVisible,

  observePageButtons,

} from "./autoDiscovery";



import "./AISearchBar.css";



/* =========================================================

   HOURMAKER AI SEARCH

   NVIDIA backend + automatic DOM discovery + background

   route scanning. No actionsCatalog.js or page.actions.

========================================================= */



const PENDING_KEY = "hourmaker_pending_ai_action";

const RECENT_KEY = "hourmaker_recent_suggestions";

const ACTIONS_KEY = "hourmaker_dynamic_actions_v2";

const PENDING_MAX_AGE = 2 * 60 * 1000;

const SCAN_MESSAGE = "HOURMAKER_PAGE_SCAN_RESULT";

const MAX_STORED_ACTIONS = 600;



const API_BASE_URL = (

  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"

).replace(/\/+$/, "");



const API_URL = `${API_BASE_URL}/api/assistant/chat`;



const STOP_WORDS = new Set([

  "i", "me", "my", "the", "a", "an", "to",

  "please", "can", "could", "would", "want",

  "like", "need", "show", "open", "go", "take",

  "bring", "navigate", "get", "see", "view",

  "let", "us", "for", "on", "in", "at",

  "page", "section",

]);



/* -------------------- General helpers -------------------- */



function normalize(value) {

  return String(value || "")

    .toLowerCase()

    .replace(/[^\w\s]/g, " ")

    .replace(/\s+/g, " ")

    .trim();

}



function getSearchWords(value) {

  return normalize(value)

    .split(" ")

    .filter((word) => word && !STOP_WORDS.has(word));

}



function getPathWithoutQuery(path) {

  return String(path || "").split("?")[0];

}



function getRouteForAction(action, availablePages) {

  const actionPath = getPathWithoutQuery(action?.page || action?.path);



  return availablePages.find(

    (page) => getPathWithoutQuery(page.path) === actionPath

  );

}



function getPageTitle(path, availablePages, actions = []) {

  const matchingAction = actions.find(

    (action) =>

      getPathWithoutQuery(action.page || action.path) ===

        getPathWithoutQuery(path) &&

      action.pageTitle

  );



  if (matchingAction?.pageTitle) return matchingAction.pageTitle;



  const route = availablePages.find(

    (page) => getPathWithoutQuery(page.path) === getPathWithoutQuery(path)

  );



  return route?.pageTitle || route?.title || route?.name || "Website";

}



function isPendingDestination(path, location) {

  if (!path) return false;



  const [targetPath, targetQuery] = String(path).split("?");



  if (location.pathname !== targetPath) return false;

  if (targetQuery) return location.search === `?${targetQuery}`;



  return true;

}



function readStorageJson(storage, key, fallback) {

  try {

    const raw = storage.getItem(key);

    if (!raw) return fallback;

    const parsed = JSON.parse(raw);

    return parsed ?? fallback;

  } catch {

    return fallback;

  }

}



/* -------------------- Dynamic action registry -------------------- */



/*

  Use the visible action label as the fallback identity. The DOM-generated

  element ID can change when a page is rendered in a different iframe.

  Therefore a moved "Export Data" button updates its saved page instead of

  leaving an old route behind.



  If the application has two genuinely different controls with the same

  label, give them distinct visible labels or add distinct data-ai-action-id

  attributes to those controls.

*/



function getActionIdentity(item) {

  const explicitId = String(item?.declaredId || "").trim();

  if (explicitId) return `declared:${explicitId}`;



  const label = normalize(item?.name || item?.label);

  return label ? `label:${label}` : `id:${item?.id || ""}`;

}



function readRegisteredActions() {

  if (typeof window === "undefined") return [];



  const actions = readStorageJson(

    window.localStorage,

    ACTIONS_KEY,

    []

  );



  return Array.isArray(actions) ? actions : [];

}



function writeRegisteredActions(actions) {

  try {

    window.localStorage.setItem(

      ACTIONS_KEY,

      JSON.stringify(actions.slice(-MAX_STORED_ACTIONS))

    );

  } catch (error) {

    console.warn("Hourmaker AI: Could not save discovered actions.", error);

  }

}



function saveDiscoveredActions(actions, pagePath) {

  if (typeof window === "undefined") return readRegisteredActions();



  const previous = readRegisteredActions();

  const incoming = (Array.isArray(actions) ? actions : [])

    .filter(

      (item) =>

        item &&

        item.id &&

        (item.name || item.label) &&

        item.enabled !== false &&

        item.visible !== false

    )

    .map((item) => ({

      ...item,

      id: String(item.id),

      name: String(item.name || item.label),

      label: String(item.label || item.name),

      description: String(

        item.description || item.name || item.label

      ),

      page: item.page || pagePath,

      path: item.page || pagePath,

      pageTitle: item.pageTitle || document.title || "Website",

      type: "action",

      risk: item.risk || "normal",

      sensitive: item.sensitive === true,

      enabled: item.enabled !== false,

      visible: item.visible !== false,

      lastSeenAt: Date.now(),

    }));



  const byIdentity = new Map(

    previous.map((item) => [getActionIdentity(item), item])

  );



  incoming.forEach((item) => {

    // Updating an action with the same identity also updates its current route.

    byIdentity.set(getActionIdentity(item), item);

  });



  const result = Array.from(byIdentity.values()).slice(-MAX_STORED_ACTIONS);

  writeRegisteredActions(result);

  return result;

}



function replaceScannedPageActions(pagePath, actions, pageTitle) {

  const previous = readRegisteredActions();

  const pageKey = getPathWithoutQuery(pagePath);



  // Remove stale actions from the scanned route before inserting its latest DOM.

  const retained = previous.filter(

    (item) => getPathWithoutQuery(item.page || item.path) !== pageKey

  );



  const byIdentity = new Map(

    retained.map((item) => [getActionIdentity(item), item])

  );



  (Array.isArray(actions) ? actions : []).forEach((item) => {

    if (

      !item?.id ||

      !(item.name || item.label) ||

      item.enabled === false ||

      item.visible === false

    ) {

      return;

    }



    const normalized = {

      ...item,

      name: item.name || item.label,

      label: item.label || item.name,

      page: item.page || pagePath,

      path: item.page || pagePath,

      pageTitle: item.pageTitle || pageTitle || "Website",

      type: "action",

      lastSeenAt: Date.now(),

    };



    byIdentity.set(getActionIdentity(normalized), normalized);

  });



  writeRegisteredActions(

    Array.from(byIdentity.values()).slice(-MAX_STORED_ACTIONS)

  );

}



function findRegisteredAction(query) {

  const queryWords = getSearchWords(query);

  if (!queryWords.length) return null;



  const matches = readRegisteredActions().filter((item) => {

    if (item.enabled === false || item.visible === false) return false;



    const candidateWords = normalize(

      `${item.name || ""} ${item.label || ""}`

    )

      .split(" ")

      .filter(Boolean);



    return queryWords.every((word) =>

      candidateWords.some(

        (candidate) => candidate === word || candidate.startsWith(word)

      )

    );

  });



  return matches.length === 1 ? matches[0] : null;

}



/* -------------------- NVIDIA backend -------------------- */



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



async function askAssistant(query, capabilities, mode = "action") {

  let response;



  try {

    response = await fetch(API_URL, {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ query, capabilities, mode }),

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



/* -------------------- DOM discovery helpers -------------------- */



async function waitForDiscoveredButtons() {

  const maxAttempts = 20;

  const delay = 250;



  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {

    const buttons = discoverCurrentPage();



    if (buttons.length > 0) {

      saveDiscoveredActions(

        buttons,

        `${window.location.pathname}${window.location.search}`

      );

      return buttons;

    }



    await new Promise((resolve) => window.setTimeout(resolve, delay));

  }



  return [];

}



function toButtonCapabilities(buttons) {

  return (Array.isArray(buttons) ? buttons : [])

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

      description: item.description || item.name || item.label || "",

      type: "action",

      category: item.category || "ui-action",

      page:

        item.page ||

        `${window.location.pathname}${window.location.search}`,

      pageTitle: item.pageTitle || document.title || "",

      risk: item.risk || "normal",

      sensitive: item.sensitive === true,

      enabled: item.enabled !== false,

      visible: item.visible !== false,

    }));

}



/* -------------------- Action matching -------------------- */



function findExactActionMatch(query, capabilities) {

  const queryWords = getSearchWords(query);

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



function isRelevantAction(query, capability) {

  const queryWords = getSearchWords(query);

  if (!queryWords.length) return false;



  const actionWords = normalize(

    `${capability?.name || ""} ${capability?.label || ""} ${

      capability?.description || ""

    }`

  )

    .split(" ")

    .filter(Boolean);



  return queryWords.every((word) =>

    actionWords.some(

      (actionWord) =>

        actionWord === word || actionWord.startsWith(word)

    )

  );

}



function isPageNameQuery(query, page) {

  const queryWords = getSearchWords(query);

  const pageWords = normalize(

    `${page?.name || ""} ${page?.title || ""} ${page?.pageTitle || ""}`

  )

    .split(" ")

    .filter(Boolean);



  return (

    queryWords.length > 0 &&

    queryWords.every((word) =>

      pageWords.some(

        (pageWord) => pageWord === word || pageWord.startsWith(word)

      )

    )

  );

}



/* -------------------- Suggestion ranking -------------------- */



function getSuggestionScore(query, item) {

  const queryWords = getSearchWords(query);

  if (!queryWords.length) return 0;



  const nameWords = normalize(item.name).split(" ").filter(Boolean);

  const contextWords = normalize(item.pageTitle).split(" ").filter(Boolean);



  let nameMatches = 0;

  let exactNameMatches = 0;

  let contextMatches = 0;



  for (const queryWord of queryWords) {

    const exactName = nameWords.includes(queryWord);

    const prefixName = nameWords.some((word) => word.startsWith(queryWord));

    const exactContext = contextWords.includes(queryWord);

    const prefixContext = contextWords.some((word) =>

      word.startsWith(queryWord)

    );



    if (exactName) {

      nameMatches += 1;

      exactNameMatches += 1;

    } else if (prefixName) {

      nameMatches += 1;

    } else if (exactContext || prefixContext) {

      contextMatches += 1;

    } else {

      return 0;

    }

  }



  let score = nameMatches * 100;

  score += exactNameMatches * 30;

  score += contextMatches * 15;



  if (item.type === "action" && nameMatches > 0) score += 25;



  if (queryWords.every((word) => nameWords.includes(word))) {

    score += 50;

  }



  return score;

}



/* -------------------- Action safety -------------------- */



function canExecuteButton(button, capability) {

  const risk = String(capability?.risk || "").toLowerCase();



  const blockedRisks = [

    "high",

    "confirm",

    "manual",

    "critical",

  ];



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

      !blockedRisks.includes(risk) &&

      !hasConfirmationAttribute &&

      !isSensitiveButton(button)

  );

}



/* -------------------- Pending action storage -------------------- */



function getPendingAction() {

  if (typeof window === "undefined") return null;



  try {

    const pending = readStorageJson(

      window.sessionStorage,

      PENDING_KEY,

      null

    );



    if (

      !pending ||

      typeof pending.query !== "string" ||

      typeof pending.path !== "string" ||

      !pending.createdAt ||

      Date.now() - pending.createdAt > PENDING_MAX_AGE

    ) {

      window.sessionStorage.removeItem(PENDING_KEY);

      return null;

    }



    return pending;

  } catch (error) {

    console.error("Pending action error:", error);

    return null;

  }

}



function readRecentSuggestions() {

  if (typeof window === "undefined") return [];



  const saved = readStorageJson(

    window.localStorage,

    RECENT_KEY,

    []

  );



  return Array.isArray(saved) ? saved : [];

}



/* =========================================================

   MAIN COMPONENT

========================================================= */



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

  const [selectedFilter, setSelectedFilter] = useState("all");

  const [recentSuggestions, setRecentSuggestions] = useState(

    readRecentSuggestions

  );



  /* -------------------- Available routes -------------------- */



  const availablePages = useMemo(() => {

    if (!Array.isArray(pageCapabilities)) return [];



    return pageCapabilities.filter((item) => {

      if (!item || !item.path) return false;



      const allowedRoles = Array.isArray(item.roles)

        ? item.roles.map((value) => String(value).toLowerCase())

        : [];



      return (

        allowedRoles.length === 0 ||

        allowedRoles.includes(currentRole)

      );

    });

  }, [pageCapabilities, currentRole]);



  /* -------------------- Child iframe scan reporting -------------------- */



  useEffect(() => {

    if (!isBackgroundScanFrame()) return undefined;



    let cancelled = false;

    let timer = null;

    let attempts = 0;

    let previousSignature = "";

    let stablePasses = 0;



    const publishScan = () => {

      if (cancelled) return;



      const actions = discoverCurrentPage();

      const signature = JSON.stringify(

        actions.map((item) => [item.id, item.name, item.page])

      );



      if (signature === previousSignature) {

        stablePasses += 1;

      } else {

        stablePasses = 0;

      }



      previousSignature = signature;

      attempts += 1;



      // Wait for the page DOM to settle rather than relying on a fixed delay.

      if ((actions.length > 0 && stablePasses >= 2) || attempts >= 24) {

        window.parent.postMessage(

          {

            type: SCAN_MESSAGE,

            path: `${window.location.pathname}${window.location.search}`,

            title:

              document.querySelector("h1")?.innerText ||

              document.title ||

              "Website",

            actions,

            empty: actions.length === 0,

          },

          window.location.origin

        );

        return;

      }



      timer = window.setTimeout(publishScan, 300);

    };



    timer = window.setTimeout(publishScan, 250);



    return () => {

      cancelled = true;

      if (timer) window.clearTimeout(timer);

    };

  }, []);



  /* -------------------- Discover current page buttons -------------------- */



  useEffect(() => {

    if (isBackgroundScanFrame()) return undefined;



    let stopObserving = () => {};

    let cancelled = false;



    const startDiscovery = () => {

      if (cancelled) return;



      const publish = (updatedButtons) => {

        if (cancelled) return;



        const capabilities = toButtonCapabilities(updatedButtons);

        setDiscoveredCapabilities(capabilities);



        saveDiscoveredActions(

          capabilities,

          `${window.location.pathname}${window.location.search}`

        );

      };



      publish(discoverCurrentPage());

      stopObserving = observePageButtons(publish);

    };



    const timer = window.setTimeout(startDiscovery, 200);



    return () => {

      cancelled = true;

      window.clearTimeout(timer);

      stopObserving();

    };

  }, [location.pathname, location.search, location.key]);



  /* -------------------- Background scan all available routes -------------------- */



  useEffect(() => {

    if (isBackgroundScanFrame() || availablePages.length === 0) {

      return undefined;

    }



    const stop = startBackgroundPageScan({

      pages: availablePages,



      onPageScanned: (result) => {

        if (result?.scanStatus !== "complete") return;



        replaceScannedPageActions(

          result.path,

          result.actions,

          result.pageTitle || result.title

        );

      },



      onProgress: (progress) => {

        console.log(

          "Hourmaker background scan:",

          progress.completed,

          "/",

          progress.total

        );

      },

    });



    return stop;

  }, [availablePages]);



  /* -------------------- Dynamic action suggestions -------------------- */



  const actionSuggestions = useMemo(() => {

    const registryActions = readRegisteredActions();

    const combinedActions = [

      ...registryActions,

      ...discoveredCapabilities,

    ];



    const uniqueActions = new Map();



    combinedActions.forEach((item) => {

      if (

        !item ||

        !item.id ||

        !item.page ||

        item.enabled === false ||

        item.visible === false

      ) {

        return;

      }



      const identity = getActionIdentity(item);

      const parentRoute = getRouteForAction(item, availablePages);



      const parentPageTitle =

        item.pageTitle ||

        parentRoute?.pageTitle ||

        parentRoute?.title ||

        parentRoute?.name ||

        "Website";



      uniqueActions.set(identity, {

        ...item,

        id: `action:${identity}`,

        name: item.name || item.label || "Action",

        label: item.label || item.name || "Action",

        description: item.description || "Available action",

        page: item.page,

        path: item.page,

        pageTitle: parentPageTitle,

        risk: item.risk || "normal",

        sensitive: item.sensitive === true,

        enabled: item.enabled !== false,

        visible: item.visible !== false,

        type: "action",

      });

    });



    return Array.from(uniqueActions.values());

  }, [

    discoveredCapabilities,

    availablePages,

    location.pathname,

    location.search,

  ]);



  /* -------------------- Page suggestions -------------------- */



  const pageSuggestions = useMemo(() => {

    return availablePages.map((item) => {

      const relatedAction = actionSuggestions.find(

        (action) =>

          getPathWithoutQuery(action.path) ===

            getPathWithoutQuery(item.path) &&

          action.pageTitle &&

          action.pageTitle !== "Website"

      );



      const pageName =

        relatedAction?.pageTitle ||

        item.pageTitle ||

        item.title ||

        item.name ||

        "Page";



      return {

        id: `page:${item.id || item.path}`,

        name: pageName,

        label: pageName,

        description: "Open page",

        path: item.path,

        pageTitle: pageName,

        type: "page",

      };

    });

  }, [availablePages, actionSuggestions]);



  const allSuggestions = useMemo(

    () => [...pageSuggestions, ...actionSuggestions],

    [pageSuggestions, actionSuggestions]

  );



  /* -------------------- Filter and rank suggestions -------------------- */



  const suggestions = useMemo(() => {

    let source = allSuggestions;



    if (selectedFilter === "pages") {

      source = pageSuggestions;

    } else if (selectedFilter === "actions") {

      source = actionSuggestions;

    } else if (selectedFilter === "recent") {

      source = recentSuggestions;

    }



    return source

      .map((item) => ({

        ...item,

        matchScore: getSuggestionScore(query, item),

      }))

      .filter((item) => item.matchScore > 0)

      .sort((a, b) => {

        if (b.matchScore !== a.matchScore) {

          return b.matchScore - a.matchScore;

        }



        if (a.type !== b.type) {

          return a.type === "action" ? -1 : 1;

        }



        return a.name.localeCompare(b.name);

      })

      .slice(0, 12);

  }, [

    query,

    selectedFilter,

    allSuggestions,

    pageSuggestions,

    actionSuggestions,

    recentSuggestions,

  ]);



  /* -------------------- Clear search -------------------- */



  function clearSearch() {

    setQuery("");

    setShowSuggestions(false);

    setAiResponse("");

    setError("");

  }



  /* -------------------- Save recent suggestion -------------------- */



  function saveRecentSuggestion(item) {

    const updated = [

      { ...item, lastUsedAt: Date.now() },

      ...recentSuggestions.filter((recent) => recent.id !== item.id),

    ].slice(0, 10);



    setRecentSuggestions(updated);



    try {

      window.localStorage.setItem(

        RECENT_KEY,

        JSON.stringify(updated)

      );

    } catch (storageError) {

      console.warn("Could not save recent suggestions:", storageError);

    }

  }



  /* -------------------- Open suggestion -------------------- */



  function openSuggestion(item) {

    if (!item?.path) return;



    saveRecentSuggestion(item);



    if (item.type === "action") {

      window.sessionStorage.setItem(

        PENDING_KEY,

        JSON.stringify({

          query: item.name,

          path: item.path,

          role: currentRole,

          createdAt: Date.now(),

        })

      );

    } else {

      window.sessionStorage.removeItem(PENDING_KEY);

    }



    clearSearch();

    navigate(item.path);

  }



  /* -------------------- Preview selected action (no execution) -------------------- */



  // Preview an action without triggering it.
  // The user must click the real page button to execute it.
  function previewAction(capability) {
    const button = findDiscoveredButton(capability);

    if (!button || !button.isConnected || !isVisible(button)) {
      setAiResponse("The matching action was found, but its button is no longer available on this page.");
      return false;
    }

    highlightDiscoveredButton(button);

    setAiResponse(
      `Found action: ${capability.name || capability.label}. It has not been executed. Click the highlighted button on the page when you want to run it.`
    );

    return true;
  }

  /* -------------------- Preview pending action after navigation -------------------- */



  useEffect(() => {

    if (isBackgroundScanFrame()) return undefined;



    let cancelled = false;



    async function continuePendingAction() {

      const pending = getPendingAction();

      if (!pending) return;



      if (

        pending.role &&

        String(pending.role).toLowerCase() !== currentRole

      ) {

        window.sessionStorage.removeItem(PENDING_KEY);

        setAiResponse("This action is not available for your role.");

        return;

      }



      if (!isPendingDestination(pending.path, location)) return;



      setLoading(true);

      setAiResponse("");

      setError("");



      try {

        const discovered = await waitForDiscoveredButtons();



        if (cancelled) return;



        const capabilities = toButtonCapabilities(discovered);



        if (!capabilities.length) {

          window.sessionStorage.removeItem(PENDING_KEY);

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

            result.result.intent !== "action" ||

            !isRelevantAction(pending.query, selected)

          ) {

            window.sessionStorage.removeItem(PENDING_KEY);

            setAiResponse("No matching action was found.");

            return;

          }

        }



        window.sessionStorage.removeItem(PENDING_KEY);

        previewAction(selected);

      } catch (err) {

        console.error("Pending action error:", err);



        if (!cancelled) {

          setError(err.message || "Unable to complete the action.");

        }

      } finally {

        if (!cancelled) setLoading(false);

      }

    }



    const timer = window.setTimeout(

      continuePendingAction,

      300

    );



    return () => {

      cancelled = true;

      window.clearTimeout(timer);

    };

  }, [

    location.pathname,

    location.search,

    location.key,

    currentRole,

  ]);



  /* -------------------- Main search -------------------- */



  async function handleSearch(event) {

    event.preventDefault();



    const searchTerm = query.trim();

    if (!searchTerm || loading) return;



    setShowSuggestions(false);

    setAiResponse("");

    setError("");

    setLoading(true);



    window.sessionStorage.removeItem(PENDING_KEY);



    try {

      // 1. Discover actions currently visible on this page.

      const discovered = await waitForDiscoveredButtons();

      const capabilities = toButtonCapabilities(discovered);



      console.log(

        "Hourmaker AI: Current page actions",

        capabilities

      );



      // 2. Match a currently visible action first.

      const directMatch = findExactActionMatch(

        searchTerm,

        capabilities

      );



      if (directMatch) {

        previewAction(directMatch);

        return;

      }



      // 3. Search dynamically discovered actions across scanned routes.

      const registeredAction = findRegisteredAction(searchTerm);



      if (registeredAction) {

        const targetPath =

          registeredAction.path || registeredAction.page;



        if (targetPath) {

          window.sessionStorage.setItem(

            PENDING_KEY,

            JSON.stringify({

              query: registeredAction.name,

              path: targetPath,

              role: currentRole,

              createdAt: Date.now(),

            })

          );



          setQuery("");

          setAiResponse(

            `Opening ${

              registeredAction.pageTitle || "the relevant page"

            }...`

          );



          navigate(targetPath);

          return;

        }

      }



      // 4. Ask NVIDIA only about actions on the current page.

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

          actionResult.result?.intent === "action" &&

          isRelevantAction(searchTerm, selectedAction)

        ) {

          previewAction(selectedAction);

          return;

        }

      }



      // 5. Match page names locally. Do not guess a route.

      const pageMatches = availablePages.filter((page) =>

        isPageNameQuery(searchTerm, page)

      );



      if (pageMatches.length === 1) {

        clearSearch();

        navigate(pageMatches[0].path);

        return;

      }



      if (pageMatches.length > 1) {

        setAiResponse(

          "More than one page matches your search. Please enter a more specific page name."

        );

        return;

      }



      // 6. No action or page matched.

      setAiResponse(

        "No matching action or page found. Check that the route is available to your role and that its page has finished loading."

      );

    } catch (err) {

      console.error("Hourmaker AI search error:", err);



      setError(

        err.message || "Unable to connect to Hourmaker AI."

      );

    } finally {

      setLoading(false);

    }

  }



  /* -------------------- Input change -------------------- */



  function handleChange(event) {

    setQuery(event.target.value);

    setAiResponse("");

    setError("");

    setSelectedFilter("all");

    setShowSuggestions(true);

  }



  /* -------------------- UI -------------------- */



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



      {/* Suggestions */}

      {showSuggestions && query.trim() && !loading && (

        <div className="search-suggestions">

          <div className="suggestion-filters">

            {[

              { id: "all", label: "All" },

              { id: "pages", label: "Pages" },

              { id: "actions", label: "Actions" },

              { id: "recent", label: "Recent" },

            ].map((filter) => (

              <button

                key={filter.id}

                type="button"

                className={`suggestion-filter ${

                  selectedFilter === filter.id ? "active" : ""

                }`}

                onClick={() => setSelectedFilter(filter.id)}

              >

                {filter.label}

              </button>

            ))}

          </div>



          {suggestions.length > 0 ? (

            suggestions.map((item) => (

              <button

                type="button"

                className="suggestion-item"

                key={item.id}

                onClick={() => openSuggestion(item)}

              >

                <span className="suggestion-icon">

                  {item.type === "page" ? "📄" : "⚡"}

                </span>



                <span className="suggestion-details">

                  <strong>{item.name}</strong>



                  <small>

                    {item.type === "action"

                      ? `Action · ${item.pageTitle || "Website"}`

                      : "Open page"}

                  </small>

                </span>



                <span className="suggestion-type">

                  {item.type === "page" ? "Page" : "Action"}

                </span>

              </button>

            ))

          ) : (

            <div className="no-suggestions">

              No matching suggestions found.

              Press Search to ask Hourmaker AI.

            </div>

          )}

        </div>

      )}



      {/* AI response */}

      {(aiResponse || error) && (

        <div className="ai-answer ai-response">

          <h3>✧ Hourmaker AI</h3>



          {aiResponse && <p>{aiResponse}</p>}



          {error && (

            <p className="search-error">{error}</p>

          )}

        </div>

      )}



      {/* Loading */}

      {loading && (

        <div className="ai-loading-overlay">

          <div className="ai-loading-card">

            <div className="ai-loading-spinner" />



            <h3>Hourmaker AI is thinking...</h3>



            <p>

              Understanding your request and

              discovering available actions.

            </p>

          </div>

        </div>

      )}

    </div>

  );

}
