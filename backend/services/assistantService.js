
import OpenAI from "openai";

import {
  getAllTools,
  getTool,
} from "../tools/toolRegistry.js";

// Register navigation tools
import "../tools/navigationTools.js";

// ==================================================
// NVIDIA AI CONFIGURATION
// ==================================================

const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

function getAIClient() {
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "NVIDIA_API_KEY is missing. Check your backend .env file."
    );
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
    timeout: 45000,
    maxRetries: 0,
  });
}

// ==================================================
// TOOL DECLARATIONS
// ==================================================

function getNvidiaToolDeclarations() {
  const registeredTools = getAllTools();

  if (!Array.isArray(registeredTools)) {
    throw new Error("Tool registry must return an array.");
  }

  return registeredTools
    .filter(
      (tool) =>
        tool &&
        typeof tool.name === "string" &&
        tool.parameters
    )
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description:
          tool.description || "Select an available capability.",
        parameters: tool.parameters,
      },
    }));
}

// ==================================================
// VALIDATE CAPABILITIES
// ==================================================

function validateCapabilities(capabilities, expectedType) {
  if (!Array.isArray(capabilities)) {
    throw new Error("Capabilities must be an array.");
  }

  const seenIds = new Set();
  const validCapabilities = [];

  for (const item of capabilities) {
    if (!item || typeof item !== "object") continue;

    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.description !== "string"
    ) {
      continue;
    }

    if (item.type !== expectedType) continue;

    if (seenIds.has(item.id)) continue;

    if (item.enabled === false || item.visible === false) {
      continue;
    }

    seenIds.add(item.id);

    validCapabilities.push({
      id: item.id,
      name: item.name,
      label: item.label || item.name,
      description: item.description,
      type: item.type,
      category: item.category || "general",
      page: item.page || item.path || null,
      pageTitle: item.pageTitle || null,
      path: item.path || item.page || null,
      risk: item.risk || "normal",
      sensitive: item.sensitive === true,
      enabled: true,
      visible: true,
    });
  }

  return validCapabilities;
}

// ==================================================
// DIRECT ACTION MATCHING
// ==================================================

function findDirectActionMatch(query, capabilities) {
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "please",
    "i",
    "me",
    "my",
    "can",
    "could",
    "would",
    "to",
    "do",
    "show",
    "want",
    "need",
  ]);

  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !stopWords.has(word));

  if (words.length < 2) return null;

  const matches = capabilities.map((item) => {
    const name = item.name.toLowerCase();
    const label = item.label.toLowerCase();
    const description = item.description.toLowerCase();

    const searchableText = `${name} ${label} ${description}`;

    const allWordsMatch = words.every((word) =>
      searchableText.includes(word)
    );

    if (!allWordsMatch) {
      return { item, score: 0 };
    }

    let score = 100;

    if (words.every((word) => name.includes(word))) score += 30;
    if (words.every((word) => label.includes(word))) score += 20;
    if (words.every((word) => description.includes(word))) score += 10;

    return { item, score };
  });

  matches.sort((a, b) => b.score - a.score);

  if (!matches.length || matches[0].score === 0) {
    return null;
  }

  if (
    matches.length > 1 &&
    matches[0].score === matches[1].score
  ) {
    return null;
  }

  return matches[0].item;
}

// ==================================================
// SYSTEM PROMPT
// ==================================================

function createSystemPrompt(capabilities, mode) {
  const capabilityList = capabilities.map((item) => ({
    id: item.id,
    name: item.name,
    label: item.label,
    description: item.description,
    type: item.type,
    category: item.category,
    page: item.page,
    pageTitle: item.pageTitle,
    path: item.path,
    risk: item.risk,
    sensitive: item.sensitive,
  }));

  const commonRules = `
You are Hourmaker AI, an intelligent employee management assistant.

Your task is to understand the user's request and select the best matching capability.

AVAILABLE CAPABILITIES:
${JSON.stringify(capabilityList, null, 2)}

IMPORTANT RULES:

1. Understand the user's actual intention.
2. Match by meaning, not only exact words.
3. Select only an exact capability ID from the supplied list.
4. Never invent a capability ID.
5. Never select unavailable capabilities.
6. Never claim that an action has been completed.
7. If nothing matches, respond with exactly:
   No result found.
8. Use the select_capability function when a capability matches.
`;

  if (mode === "route") {
    return commonRules + `

CURRENT TASK:

Find the most appropriate page for the user's request.

Select only page capabilities.

The intent must be:
- navigate: when the user wants to open or view a page.
- action: when the user wants to perform an operation on a page.

Examples:
- Open dashboard -> navigate
- Show team members -> navigate
- Invite a new member -> action
- Edit an employee -> action

Use the select_capability function.
`;
  }

  if (mode === "action") {
    return commonRules + `

CURRENT TASK:

The user is already on the relevant page.

Find the exact button or operation requested.

Rules:
- Select only action capabilities.
- Use the exact capability ID.
- Never select a page capability.
- Never invent an action.
- Sensitive operations must not be executed automatically.
- The intent must be action.

Use the select_capability function.
`;
  }

  throw new Error("Invalid assistant mode.");
}

// ==================================================
// PARSE TOOL ARGUMENTS
// ==================================================

function parseToolArguments(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("NVIDIA returned invalid tool arguments.");
    }
  }

  if (value && typeof value === "object") {
    return value;
  }

  throw new Error("NVIDIA returned empty tool arguments.");
}

// ==================================================
// EXECUTE CAPABILITY SELECTION
// ==================================================

async function executeSelection(
  selectionTool,
  capability,
  intent
) {
  const result = await selectionTool.execute({
    capabilityId: capability.id,
    intent,
  });

  if (
    !result ||
    result.success !== true ||
    result.capabilityId !== capability.id ||
    result.intent !== intent
  ) {
    throw new Error("Capability selection failed.");
  }

  return {
    type: "tool_result",
    tool: "select_capability",
    result: {
      success: true,
      capabilityId: capability.id,
      intent,
      type: capability.type,
      page: capability.name,
      path: capability.path || null,
      risk: capability.risk,
      sensitive: capability.sensitive,
      message: `Selected ${capability.name}.`,
    },
  };
}

// ==================================================
// MAIN ASSISTANT FUNCTION
// ==================================================

export async function runAssistant(
  query,
  capabilities = [],
  mode = "route"
) {
  try {
    if (typeof query !== "string" || !query.trim()) {
      throw new Error("Please enter a valid search query.");
    }

    if (!["route", "action"].includes(mode)) {
      throw new Error("Invalid assistant mode.");
    }

    const expectedType =
      mode === "route" ? "page" : "action";

    const validCapabilities = validateCapabilities(
      capabilities,
      expectedType
    );

    if (validCapabilities.length === 0) {
      return {
        type: "message",
        message: "No result found.",
      };
    }

    const selectionTool = getTool("select_capability");

    if (
      !selectionTool ||
      typeof selectionTool.execute !== "function"
    ) {
      throw new Error(
        "select_capability tool is not registered correctly."
      );
    }

    // Fast direct matching for actions
    if (mode === "action") {
      const directMatch = findDirectActionMatch(
        query,
        validCapabilities
      );

      if (directMatch) {
        console.log(
          "Hourmaker direct action match:",
          directMatch.name,
          directMatch.id
        );

        return await executeSelection(
          selectionTool,
          directMatch,
          "action"
        );
      }
    }

    // Create NVIDIA client
    const ai = getAIClient();

    // Find selection function declaration
    const tools = getNvidiaToolDeclarations();

    const selectionDeclaration = tools.find(
      (tool) =>
        tool.function.name === "select_capability"
    );

    if (!selectionDeclaration) {
      throw new Error(
        "select_capability declaration is missing from toolRegistry.js."
      );
    }

    const systemPrompt = createSystemPrompt(
      validCapabilities,
      mode
    );

    console.log("Hourmaker NVIDIA request:", {
      model: MODEL,
      mode,
      capabilityCount: validCapabilities.length,
    });

    // NVIDIA API request
    const completion = await ai.chat.completions.create({
      model: MODEL,

      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: query.trim(),
        },
      ],

      tools: [selectionDeclaration],

      tool_choice: "auto",

      temperature: 0.2,

      max_tokens: 512,

      // Reduce unnecessary reasoning time.
      reasoning_effort: "none",

      // Request a normal JSON response, not a stream.
      stream: false,
    });

    const message = completion.choices?.[0]?.message;

    if (!message) {
      throw new Error("NVIDIA returned an empty response.");
    }

    // No tool call
    if (
      !Array.isArray(message.tool_calls) ||
      message.tool_calls.length === 0
    ) {
      return {
        type: "message",
        message: "No result found.",
      };
    }

    // Allow only one selection
    if (message.tool_calls.length !== 1) {
      return {
        type: "message",
        message: "No result found.",
      };
    }

    const toolCall = message.tool_calls[0];

    if (
      toolCall.type !== "function" ||
      toolCall.function?.name !== "select_capability"
    ) {
      return {
        type: "message",
        message: "No result found.",
      };
    }

    const args = parseToolArguments(
      toolCall.function.arguments
    );

    const capabilityId = args.capabilityId;
    const intent = args.intent;

    // Validate intent
    const allowedIntents =
      mode === "route"
        ? ["navigate", "action"]
        : ["action"];

    if (!allowedIntents.includes(intent)) {
      return {
        type: "message",
        message: "No result found.",
      };
    }

    // Find capability by exact ID
    const selectedCapability = validCapabilities.find(
      (item) => item.id === capabilityId
    );

    if (!selectedCapability) {
      return {
        type: "message",
        message: "No result found.",
      };
    }

    // Verify capability type
    if (
      mode === "route" &&
      selectedCapability.type !== "page"
    ) {
      return {
        type: "message",
        message: "No result found.",
      };
    }

    if (
      mode === "action" &&
      selectedCapability.type !== "action"
    ) {
      return {
        type: "message",
        message: "No result found.",
      };
    }

    // Execute only the validated selection
    return await executeSelection(
      selectionTool,
      selectedCapability,
      intent
    );

  } catch (error) {
    console.error("Hourmaker assistant service error:", {
      message: error.message,
      status: error.status,
      code: error.code,
      response: error.response?.data,
      requestId: error.request_id,
    });

    throw error;
  }
}
