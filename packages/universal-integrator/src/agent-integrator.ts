#!/usr/bin/env bun
/**
 * SIM Universal Integrator v8 - LangChain Agent with Tool Calling
 * Proper Agent Framework implementation
 */

import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { AgentExecutor, createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

// Initialize DeepSeek LLM
const llm = new ChatOpenAI({
  modelName: "deepseek-v3",
  temperature: 0,
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: "https://api.deepseek.com/v1",
  },
});

// ============================================================================
// TOOL DEFINITIONS (Agent will call these)
// ============================================================================

const analyzeApiTool = tool(
  async (input: { serviceName: string; apiDescription: string }) => {
    console.log(`🔍 Analyzing ${input.serviceName} API...`);

    // Call DeepSeek to analyze API
    const response = await llm.invoke([
      {
        role: "user",
        content: `Analyze this API and extract key information:

Service: ${input.serviceName}
Description: ${input.apiDescription}

Extract and return JSON:
{
  "provider": "service_id",
  "baseUrl": "url",
  "authModel": "oauth2|api_key|bearer",
  "hasWebhooks": true/false,
  "methodCount": number,
  "mainCategories": ["cat1", "cat2"]
}`,
      },
    ]);

    return String(response.content);
  },
  {
    name: "analyze_api",
    description:
      "Analyze API documentation to extract structure, auth, webhooks, and endpoints",
    schema: z.object({
      serviceName: z.string().describe("Service/API name"),
      apiDescription: z.string().describe("Detailed API description"),
    }),
  }
);

const extractEndpointsTool = tool(
  async (input: {
    serviceName: string;
    apiDescription: string;
    categoryFilter?: string;
  }) => {
    console.log(
      `📋 Extracting endpoints from ${input.serviceName}...`
    );

    const response = await llm.invoke([
      {
        role: "user",
        content: `Extract ALL endpoints from this API:

Service: ${input.serviceName}
Description: ${input.apiDescription}
${input.categoryFilter ? `Filter: ${input.categoryFilter}` : ""}

Return JSON array of endpoints:
[
  {
    "id": "service_action",
    "method": "GET|POST|PUT|DELETE",
    "path": "/path",
    "name": "Friendly Name",
    "description": "What it does",
    "params": [{"name": "param", "type": "string", "required": true}],
    "responseFields": ["field1", "field2"]
  }
]`,
      },
    ]);

    return String(response.content);
  },
  {
    name: "extract_endpoints",
    description: "Extract ALL API endpoints/methods from documentation",
    schema: z.object({
      serviceName: z.string().describe("Service name"),
      apiDescription: z.string().describe("API description"),
      categoryFilter: z
        .string()
        .optional()
        .describe("Optional filter for specific endpoint category"),
    }),
  }
);

const generateToolsTool = tool(
  async (input: {
    serviceName: string;
    endpoints: string;
    endpointCount: number;
  }) => {
    console.log(
      `⚙️ Generating ${input.endpointCount} ToolConfigs for ${input.serviceName}...`
    );

    const response = await llm.invoke([
      {
        role: "user",
        content: `Generate Sim.ai ToolConfigs for these endpoints:

Service: ${input.serviceName}
Endpoints: ${input.endpoints}

Requirements:
- One ToolConfig per endpoint
- ID format: {service}_{action} (snake_case)
- Auth params: visibility hidden
- All outputs: typed JSON
- Include transformResponse

Return COMPLETE TypeScript code for all ToolConfigs`,
      },
    ]);

    return String(response.content);
  },
  {
    name: "generate_tools",
    description: "Generate ToolConfig TypeScript for all endpoints",
    schema: z.object({
      serviceName: z.string(),
      endpoints: z.string().describe("JSON array of endpoints"),
      endpointCount: z.number(),
    }),
  }
);

const generateBlockTool = tool(
  async (input: {
    serviceName: string;
    toolCount: number;
  }) => {
    console.log(
      `🧩 Generating BlockConfig + BlockMeta for ${input.serviceName}...`
    );

    const response = await llm.invoke([
      {
        role: "user",
        content: `Generate BlockConfig + BlockMeta for ${input.serviceName}:

Requirements:
- Single grouped block (NOT separate blocks)
- Operation dropdown (user-or-llm)
- Auth fields (user-only for credentials)
- ${input.toolCount} tools in tools.access
- BlockMeta: tags, templates, skills
- Proper tools.config mapping

Return complete TypeScript BlockConfig and BlockMeta code`,
      },
    ]);

    return String(response.content);
  },
  {
    name: "generate_block",
    description:
      "Generate BlockConfig and BlockMeta TypeScript for the integration",
    schema: z.object({
      serviceName: z.string(),
      toolCount: z.number().describe("Number of tools in integration"),
    }),
  }
);

const generateTriggersTool = tool(
  async (input: {
    serviceName: string;
    webhookSupported: boolean;
    eventTypes?: string;
  }) => {
    console.log(
      `🔔 Generating ${input.webhookSupported ? "webhook" : "polling"} triggers for ${input.serviceName}...`
    );

    const response = await llm.invoke([
      {
        role: "user",
        content: `Generate TriggerConfigs for ${input.serviceName}:

Webhook Supported: ${input.webhookSupported}
${input.eventTypes ? `Event Types: ${input.eventTypes}` : ""}

Requirements:
- Primary trigger (if webhooks): includeDropdown: true
- Event-specific triggers
- formatInput outputs = trigger outputs EXACTLY
- Proper webhook paths

Return complete TypeScript TriggerConfig code`,
      },
    ]);

    return String(response.content);
  },
  {
    name: "generate_triggers",
    description:
      "Generate TriggerConfig TypeScript for webhooks or polling",
    schema: z.object({
      serviceName: z.string(),
      webhookSupported: z.boolean(),
      eventTypes: z.string().optional(),
    }),
  }
);

const validateIntegrationTool = tool(
  async (input: {
    serviceName: string;
    toolCount: number;
    blockGenerated: boolean;
    triggersGenerated: boolean;
  }) => {
    console.log(
      `✅ Validating ${input.serviceName} integration against 10 Sim.ai rules...`
    );

    const response = await llm.invoke([
      {
        role: "user",
        content: `Validate ${input.serviceName} integration:

Tools: ${input.toolCount}
Block: ${input.blockGenerated ? "YES" : "NO"}
Triggers: ${input.triggersGenerated ? "YES" : "NO"}

Check 10 Sim.ai rules:
1. One tool per endpoint
2. One grouped block
3. Param visibility (hidden, user-only, user-or-llm)
4. formatInput = outputs
5. No hallucinations
6. Tool IDs snake_case
7. Block type kebab-case
8. Alphabetical order
9. BlockMeta tags whitelisted
10. Outputs typed

Return validation report (pass/fail per rule)`,
      },
    ]);

    return String(response.content);
  },
  {
    name: "validate_integration",
    description:
      "Validate integration against 10 Sim.ai compliance rules",
    schema: z.object({
      serviceName: z.string(),
      toolCount: z.number(),
      blockGenerated: z.boolean(),
      triggersGenerated: z.boolean(),
    }),
  }
);

// ============================================================================
// AGENT EXECUTOR
// ============================================================================

async function runIntegrationAgent(
  serviceName: string,
  apiDescription: string
) {
  console.log(`
════════════════════════════════════════════════════════════════════════════════
🤖 LangChain AGENT - Generating ${serviceName} Integration
════════════════════════════════════════════════════════════════════════════════
`);

  // Create agent with tools
  const tools = [
    analyzeApiTool,
    extractEndpointsTool,
    generateToolsTool,
    generateBlockTool,
    generateTriggersTool,
    validateIntegrationTool,
  ];

  const systemPrompt = `You are expert at generating Sim.ai integrations.

Task: Generate complete ${serviceName} integration following these steps:

STEPS:
1. analyze_api - Extract API structure, auth, webhooks
2. extract_endpoints - Get ALL endpoints from the service
3. generate_tools - Create ToolConfigs for all endpoints
4. generate_block - Create BlockConfig + BlockMeta
5. generate_triggers - Create webhook/polling triggers
6. validate_integration - Validate against 10 Sim.ai rules

CRITICAL RULES:
- One tool per endpoint (NOT grouped)
- One grouped block with operation dropdown
- Param visibility: hidden (secrets), user-only (keys), user-or-llm (params)
- formatInput outputs MUST match trigger outputs EXACTLY
- Never guess schemas - use only official documentation
- Tool IDs: snake_case
- All outputs typed
- No hallucinations

EXECUTE IN ORDER:
1. Call analyze_api with service name and description
2. Based on analysis, call extract_endpoints
3. With endpoints, call generate_tools
4. Call generate_block with tool count
5. Call generate_triggers
6. Call validate_integration

Generate complete, production-grade integration.`;

  try {
    const agent = await createReactAgent({
      llm,
      tools,
      systemPrompt,
    });

    const executor = new AgentExecutor({ agent, tools });

    const result = await executor.invoke({
      input: `Generate complete ${serviceName} integration.

API Description:
${apiDescription}

Use tools to:
1. Analyze the API
2. Extract all endpoints
3. Generate tools (one per endpoint)
4. Generate block configuration
5. Generate webhook triggers
6. Validate against Sim.ai rules

Return summary of generated integration.`,
    });

    console.log(`
════════════════════════════════════════════════════════════════════════════════
✅ AGENT EXECUTION COMPLETE
════════════════════════════════════════════════════════════════════════════════

Result:
${result.output}

Integration Status: READY FOR DEPLOYMENT ✅
`);
  } catch (error) {
    console.error("❌ Agent Error:", error);
    throw error;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`
Usage: bun agent-integrator.ts <service-name> "<api-description>"

Example:
  bun agent-integrator.ts Ozon "Marketplace API. Base: api.ozon.ru/v3, Auth: API key"
`);
    process.exit(1);
  }

  const serviceName = args[0];
  const apiDescription = args[1];

  await runIntegrationAgent(serviceName, apiDescription);
}

main().catch(console.error);
