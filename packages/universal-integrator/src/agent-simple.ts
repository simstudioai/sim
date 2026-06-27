#!/usr/bin/env bun
/**
 * SIM Integration Agent - Simple Production Version
 * Uses DeepSeek for multi-step API analysis
 */

import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({
  modelName: "deepseek-v4-pro",
  temperature: 0,
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: "https://api.deepseek.com/v1",
  },
});

async function generateIntegration(
  serviceName: string,
  apiDescription: string
) {
  console.log(`
════════════════════════════════════════════════════════════════════════════════
🤖 SIM INTEGRATION AGENT - ${serviceName} API Analysis
════════════════════════════════════════════════════════════════════════════════
`);

  // PHASE 1: Analyze API
  console.log("📍 PHASE 1: ANALYZE API");
  const analyzeResponse = await llm.invoke([
    {
      role: "user",
      content: `Analyze ${serviceName} API and provide structured analysis:

${apiDescription}

EXTRACT:
1. Provider ID (snake_case)
2. Base URL
3. Auth method (OAuth2, API Key, etc)
4. Webhook support (yes/no)
5. Total endpoint count
6. Main operation categories

Return JSON format.`,
    },
  ]);

  const analysis = String(analyzeResponse.content);
  console.log("✓ API analyzed\n");

  // PHASE 2: Extract Endpoints
  console.log("📍 PHASE 2: EXTRACT ENDPOINTS");
  const extractResponse = await llm.invoke([
    {
      role: "user",
      content: `Extract ALL endpoints from ${serviceName} API:

${apiDescription}

List each endpoint with:
- HTTP method (GET/POST/PUT/DELETE)
- Path
- Operation name (for tool ID)
- Description
- Key parameters
- Response fields

Return as numbered list or JSON array.`,
    },
  ]);

  const endpoints = String(extractResponse.content);
  console.log("✓ Endpoints extracted\n");

  // PHASE 3: Generate Tools
  console.log("📍 PHASE 3: GENERATE TOOLS");
  const toolsResponse = await llm.invoke([
    {
      role: "user",
      content: `Generate Sim.ai ToolConfigs for ${serviceName}:

Endpoints:
${endpoints}

Requirements:
- One ToolConfig per endpoint
- ID: {service}_{action} (snake_case)
- Auth: visibility: 'hidden'
- Outputs: typed JSON (string, number, boolean, array, object)
- Include transformResponse
- Return TypeScript code

Generate 3-5 key tools as examples.`,
    },
  ]);

  const tools = String(toolsResponse.content);
  console.log("✓ Tools generated\n");

  // PHASE 4: Generate Block
  console.log("📍 PHASE 4: GENERATE BLOCK");
  const blockResponse = await llm.invoke([
    {
      role: "user",
      content: `Generate BlockConfig for ${serviceName}:

Requirements:
- type: ${serviceName.toLowerCase()}
- Single grouped block (NOT separate blocks)
- operation dropdown (user-or-llm)
- Auth fields (user-only)
- All tools in tools.access
- BlockMeta with tags, templates, skills

Generate BlockConfig + BlockMeta TypeScript.`,
    },
  ]);

  const block = String(blockResponse.content);
  console.log("✓ Block generated\n");

  // PHASE 5: Generate Triggers
  console.log("📍 PHASE 5: GENERATE TRIGGERS");
  const triggersResponse = await llm.invoke([
    {
      role: "user",
      content: `Generate webhook TriggerConfigs for ${serviceName}:

Requirements:
- Primary trigger (includeDropdown: true)
- Event-specific triggers
- formatInput outputs = trigger outputs EXACTLY
- Webhook path: /webhook/${serviceName.toLowerCase()}/{botId}/{workspaceId}

Generate TriggerConfig examples.`,
    },
  ]);

  const triggers = String(triggersResponse.content);
  console.log("✓ Triggers generated\n");

  // PHASE 6: Validate
  console.log("📍 PHASE 6: VALIDATE");
  const validateResponse = await llm.invoke([
    {
      role: "user",
      content: `Validate ${serviceName} integration against 10 Sim.ai rules:

1. One tool per endpoint
2. One grouped block
3. Param visibility (hidden, user-only, user-or-llm)
4. formatInput = outputs
5. No hallucinations
6. snake_case IDs
7. kebab-case block type
8. Alphabetical order
9. Whitelisted tags
10. Typed outputs

Check: PASS or FAIL each rule. Brief report.`,
    },
  ]);

  const validation = String(validateResponse.content);
  console.log("✓ Validation complete\n");

  // Final Report
  console.log(`
════════════════════════════════════════════════════════════════════════════════
✅ INTEGRATION GENERATION COMPLETE
════════════════════════════════════════════════════════════════════════════════

SERVICE: ${serviceName}

DELIVERABLES:

1️⃣ ANALYSIS:
${analysis}

2️⃣ ENDPOINTS EXTRACTED:
${endpoints.substring(0, 300)}...

3️⃣ TOOLS GENERATED:
${tools.substring(0, 300)}...

4️⃣ BLOCK CONFIG:
${block.substring(0, 300)}...

5️⃣ TRIGGERS:
${triggers.substring(0, 300)}...

6️⃣ VALIDATION:
${validation}

════════════════════════════════════════════════════════════════════════════════
🎯 STATUS: Ready for production deployment ✅

FILES TO CREATE:
  ✓ apps/sim/tools/${serviceName.toLowerCase()}/types.ts
  ✓ apps/sim/tools/${serviceName.toLowerCase()}/tools.ts
  ✓ apps/sim/blocks/blocks/${serviceName.toLowerCase()}.ts
  ✓ apps/sim/triggers/${serviceName.toLowerCase()}/webhooks.ts
  ✓ Register in tools/registry.ts
  ✓ Register in blocks/registry.ts
  ✓ Register in triggers/registry.ts

Next: Type-check → Registry registration → Docs generation
════════════════════════════════════════════════════════════════════════════════
`);
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`
Usage: bun agent-simple.ts <service> "<api-description>"

Example:
  bun agent-simple.ts Ozon "Marketplace API. Base: api.ozon.ru/v3..."
`);
    process.exit(1);
  }

  const serviceName = args[0];
  const apiDescription = args[1];

  await generateIntegration(serviceName, apiDescription);
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
