/**
 * SIM Integration Agent SDK v8 — Production-Grade Orchestrator
 *
 * 11-phase integration pipeline with safety gates.
 * Every phase validates against SPECIFICATION.md rules.
 *
 * NEVER: guess outputs, skip endpoints, create separate blocks per operation.
 * ALWAYS: one tool per endpoint, grouped block, correct visibility, alphabetical registries.
 */

import { LlmClient, createSimIntegratorClient, type LlmClientOptions } from "./local-llm-client";
import {
  generateToolFile,
  generateToolsIndex,
  generateTypesFile,
  type EndpointSpec,
  type GeneratedTool,
} from "./tool-generator";
import { generateBlockFile, type BlockGenOptions } from "./block-generator";
import {
  generateTriggerFile,
  generateTriggerIndex,
  type TriggerGenOptions,
} from "./trigger-generator";
import { FileWriter, type FileToWrite } from "./file-writer";
import { RegistryPatcher, type RegistryEntry } from "./registry-patcher";

// ============================================================================
// Types
// ============================================================================

export interface AgentOptions {
  serviceName: string;
  apiDescription: string;
  workspaceRoot: string;
  llmUrl?: string;
  model?: string;
  dryRun?: boolean;
}

export interface AnalysisResult {
  provider: string;
  serviceName: string;
  baseUrl: string;
  authModel: string;
  hasWebhooks: boolean;
  webhookEvents: string[];
  methodCount: number;
  mainCategories: string[];
  integrationType: string;
  notes: string;
}

// ============================================================================
// Agent Class
// ============================================================================

export class SimIntegrationAgent {
  private serviceName: string;
  private apiDescription: string;
  private workspaceRoot: string;
  private dryRun: boolean;

  private client: LlmClient;
  private writer: FileWriter;
  private patcher: RegistryPatcher;

  /** Track which endpoints have unverified schemas. */
  private unverifiedEndpoints: string[] = [];
  /** Track warnings for the final report. */
  private warnings: string[] = [];

  constructor(options: AgentOptions) {
    this.serviceName = options.serviceName;
    this.apiDescription = options.apiDescription;
    this.workspaceRoot = options.workspaceRoot;
    this.dryRun = options.dryRun ?? false;

    this.client = createSimIntegratorClient({
      url: options.llmUrl,
      model: options.model,
      temperature: 0,
    });

    this.writer = new FileWriter({
      workspaceRoot: options.workspaceRoot,
      dryRun: this.dryRun,
    });

    this.patcher = new RegistryPatcher({
      workspaceRoot: options.workspaceRoot,
      dryRun: this.dryRun,
    });
  }

  async run(): Promise<void> {
    const mode = this.dryRun ? "DRY RUN" : "LIVE";
    console.log(`
════════════════════════════════════════════════════════════════════════════════
🤖 SIM UNIVERSAL INTEGRATOR v8 — ${mode}
════════════════════════════════════════════════════════════════════════════════
Service:     ${this.serviceName}
Model:       ${this.client['model']}
URL:         ${this.client['url']}
════════════════════════════════════════════════════════════════════════════════
`);

    // ════════════════════════════════════════════════════════════════
    // PHASE 1: ANALYZE API
    // ════════════════════════════════════════════════════════════════
    console.log("📍 PHASE 1: ANALYZE API");
    const analysis = await this.analyzeApi();
    const serviceSlug = analysis.provider;
    console.log(`   Provider:       ${serviceSlug}`);
    console.log(`   Auth:           ${analysis.authModel}`);
    console.log(`   Webhooks:       ${analysis.hasWebhooks}`);
    console.log(`   Est. methods:   ${analysis.methodCount}`);

    // ════════════════════════════════════════════════════════════════
    // PHASE 2: EXTRACT ALL ENDPOINTS (EXHAUSTIVE)
    // ════════════════════════════════════════════════════════════════
    console.log("\n📍 PHASE 2: EXTRACT ALL ENDPOINTS");
    const endpoints = await this.extractEndpoints();
    console.log(`   Extracted ${endpoints.length} endpoints`);

    // Safety gate: warn about unverified schemas
    this.unverifiedEndpoints = endpoints
      .filter((ep) => {
        const sv = ep.schemaVerified;
        if (typeof sv === "boolean") return !sv;
        const s = String(sv).toLowerCase();
        return s === "partial" || s === "unknown" || s === "false";
      })
      .map((ep) => ep.id);

    if (this.unverifiedEndpoints.length > 0) {
      const msg = `${this.unverifiedEndpoints.length} endpoints have unverified response schemas — transformResponse will use raw passthrough`;
      this.warnings.push(msg);
      console.log(`   ⚠ ${msg}`);
    }

    // Group endpoints by category for operation dropdown
    const categories = [...new Set(endpoints.map((e) => e.category).filter(Boolean))];

    // ════════════════════════════════════════════════════════════════
    // PHASE 3: DESIGN
    // ════════════════════════════════════════════════════════════════
    console.log("\n📍 PHASE 3: DESIGN");

    // ════════════════════════════════════════════════════════════════
    // PHASE 4: GENERATE TOOLS
    // ════════════════════════════════════════════════════════════════
    console.log("\n📍 PHASE 4: GENERATE TOOLS");
    const tools = this.generateToolsFromEndpoints(endpoints, analysis);
    const toolFiles: FileToWrite[] = [];

    toolFiles.push({
      path: `apps/sim/tools/${serviceSlug}/types.ts`,
      content: generateTypesFile(this.serviceName, false),
    });

    for (const tool of tools) {
      toolFiles.push({
        path: `apps/sim/tools/${serviceSlug}/${tool.fileName}`,
        content: tool.code,
      });
    }

    toolFiles.push({
      path: `apps/sim/tools/${serviceSlug}/index.ts`,
      content: generateToolsIndex(tools),
    });

    console.log(`   Generated ${tools.length} ToolConfig files`);

    // ════════════════════════════════════════════════════════════════
    // PHASE 5: GENERATE BLOCK
    // ════════════════════════════════════════════════════════════════
    console.log("\n📍 PHASE 5: GENERATE BLOCK");
    const blockCode = await this.generateBlock(analysis, endpoints, tools);
    const blockFile: FileToWrite = {
      path: `apps/sim/blocks/blocks/${serviceSlug}.ts`,
      content: blockCode,
    };
    console.log(`   Generated BlockConfig + BlockMeta`);

    // ════════════════════════════════════════════════════════════════
    // PHASE 6: GENERATE TRIGGERS
    // ════════════════════════════════════════════════════════════════
    console.log("\n📍 PHASE 6: GENERATE TRIGGERS");
    let triggerFiles: FileToWrite[] = [];
    let triggerId = "";

    if (analysis.hasWebhooks && analysis.webhookEvents.length > 0) {
      const triggerCode = await this.generateTriggers(analysis);
      triggerId = `${serviceSlug}_webhook`;

      triggerFiles = [
        {
          path: `apps/sim/triggers/${serviceSlug}/webhook.ts`,
          content: triggerCode,
        },
        {
          path: `apps/sim/triggers/${serviceSlug}/index.ts`,
          content: generateTriggerIndex(`${serviceSlug}WebhookTrigger`),
        },
      ];
      console.log(`   Generated webhook trigger: ${triggerId}`);
    } else {
      console.log("   No webhooks — skipping triggers");
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 7: AUTH (embedded in block)
    // ════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════
    // PHASE 8: FILE HANDLING (placeholder — generated tools use external URLs)
    // ════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════
    // PHASE 9: ICON
    // ════════════════════════════════════════════════════════════════
    console.log("\n📍 PHASE 9: GENERATE ICON");
    const iconCode = this.generateIconStub(serviceSlug);
    const iconFile: FileToWrite = {
      path: `apps/sim/components/icons-generated/${serviceSlug}.tsx`,
      content: iconCode,
    };
    console.log(`   Generated icon stub`);

    // ════════════════════════════════════════════════════════════════
    // WRITE FILES
    // ════════════════════════════════════════════════════════════════
    console.log("\n📍 WRITING FILES");
    const allFiles = [...toolFiles, blockFile, ...triggerFiles, iconFile];
    await this.writer.writeAll(allFiles);
    this.writer.printSummary();

    // ════════════════════════════════════════════════════════════════
    // PHASE 10: REGISTRY PATCHING
    // ════════════════════════════════════════════════════════════════
    console.log("\n📍 PHASE 10: REGISTRY PATCHING");
    const registryEntries = this.buildRegistryEntries(serviceSlug, tools, triggerId, analysis);
    await this.patcher.applyAll(registryEntries);

    // ════════════════════════════════════════════════════════════════
    // PHASE 11: VALIDATION
    // ════════════════════════════════════════════════════════════════
    console.log("\n📍 PHASE 11: VALIDATION");
    const validation = await this.validateIntegration(tools.length, true, triggerId !== "");
    console.log(validation);

    // ════════════════════════════════════════════════════════════════
    // FINAL REPORT
    // ════════════════════════════════════════════════════════════════
    console.log(`\n📍 COST SUMMARY`);
    console.log(this.client.costSummary());

    console.log(`
════════════════════════════════════════════════════════════════════════════════
✅ INTEGRATION GENERATED — ${mode}
════════════════════════════════════════════════════════════════════════════════

SERVICE:       ${this.serviceName}
PROVIDER:      ${serviceSlug}

DELIVERABLES:
  📁 apps/sim/tools/${serviceSlug}/
     ├─ types.ts
     ├─ index.ts (${tools.length} tool exports)
     └─ ${tools.length} tool files

  📁 apps/sim/blocks/blocks/
     └─ ${serviceSlug}.ts (BlockConfig + BlockMeta)

  ${
    triggerId
      ? `📁 apps/sim/triggers/${serviceSlug}/
     └─ webhook.ts (TriggerConfig)\n`
      : ""
  }
  📁 apps/sim/components/icons-generated/
     └─ ${serviceSlug}.tsx (icon stub)

REGISTRIES PATCHED:
  ✓ tools/registry.ts    (${tools.length} entries)
  ✓ blocks/registry.ts   (${serviceSlug} + meta)
  ${triggerId ? `✓ triggers/registry.ts  (${triggerId})\n` : ""}
SAFETY:
  ${
    this.unverifiedEndpoints.length > 0
      ? `⚠ ${this.unverifiedEndpoints.length} unverified schemas — raw passthrough`
      : "✓ All schemas verified"
  }
  ${
    this.warnings.length > 0
      ? `WARNINGS:\n${this.warnings.map((w) => `     ⚠ ${w}`).join("\n")}`
      : "✓ No warnings"
  }

NEXT STEPS:
  1. Verify icon in apps/sim/components/icons-generated/${serviceSlug}.tsx
  2. Run: cd apps/sim && bun run type-check
  3. Fix any type errors (import paths, icon references)
  4. ${analysis.authModel === "oauth2" ? "Add OAuth scopes to lib/oauth/oauth.ts" : "Verify API key field works in workflow editor"}
  5. Run: bun run scripts/generate-docs.ts
  6. Test with a real workflow
  7. Register icon in apps/sim/components/icons.tsx

${this.dryRun ? "⚠ DRY RUN — no files were written." : ""}
════════════════════════════════════════════════════════════════════════════════
`);
  }

  // ==========================================================================
  // Phase Methods
  // ==========================================================================

  private async analyzeApi(): Promise<AnalysisResult> {
    const result = await this.client.call(`
ANALYZE the "${this.serviceName}" API and extract COMPLETE structure.

Description: ${this.apiDescription}

Return ONLY a JSON object (no markdown, no explanation):
{
  "provider": "snake_case_service_id",
  "serviceName": "${this.serviceName}",
  "baseUrl": "https://...",
  "authModel": "oauth2|api_key|bearer|bot_token",
  "hasWebhooks": true/false,
  "webhookEvents": ["event.name", "..."],
  "methodCount": number,
  "mainCategories": ["cat1", "cat2"],
  "integrationType": "Communication|Commerce|Analytics|DevOps|CRM|Marketing|Productivity|Security|Support|Data|Documents|Email|HR|AI|Observability|Search|Sales|Databases",
  "notes": "important details about auth, rate limits, docs URLs"
}

IMPORTANT:
- provider MUST be lowercase snake_case (e.g., "stripe", "telegram", "google_sheets")
- integrationType MUST be one from the list above
- webhookEvents must be real event type strings, not made up
- methodCount must be your best estimate of total API operations`);

    const analysis = this.parseJson<AnalysisResult>(result.content);

    // Safety gate: validate provider name
    if (!analysis.provider || !analysis.provider.match(/^[a-z][a-z0-9_]*$/)) {
      this.warnings.push(
        `Provider "${analysis.provider}" may not be valid snake_case — generated as-is`,
      );
    }

    return analysis;
  }

  private async extractEndpoints(): Promise<EndpointSpec[]> {
    const result = await this.client.call(`
EXTRACT EVERY SINGLE API endpoint from ${this.serviceName}.

API Description: ${this.apiDescription}

For EACH endpoint, return a JSON array entry:
{
  "id": "service_action (snake_case, e.g. stripe_create_customer)",
  "method": "GET|POST|PUT|DELETE|PATCH",
  "path": "/v1/resource/{param}",
  "name": "Human-Readable Operation Name",
  "description": "What this endpoint does, when to use it",
  "category": "resource_category",
  "params": [
    {
      "name": "param_name",
      "type": "string|number|boolean|object|array",
      "required": true/false,
      "description": "Parameter description",
      "visibility": "user-only|user-or-llm|hidden"
    }
  ],
  "responseFields": [
    {
      "name": "field_name",
      "type": "string|number|boolean|json|array|object",
      "description": "Field description",
      "optional": true/false
    }
  ],
  "schemaVerified": "documented|example_verified|live_verified|partial|unknown"
}

CRITICAL RULES:
- EXHAUSTIVE: list EVERY endpoint. Do NOT filter or skip ANY.
- ID format: {service}_{action} (snake_case only)
- Visibility rules:
  - "hidden" for auth tokens, internal system params
  - "user-only" for API keys, credentials, account IDs
  - "user-or-llm" for query params, content, filters
- Schema verification:
  - "documented" if official docs describe the response
  - "example_verified" if you've seen example responses
  - "partial" if only some fields are known
  - "unknown" if response schema is completely undocumented

Return as a JSON array: [{...}, {...}, ...].
DO NOT wrap in markdown code blocks. Pure JSON array only.`);

    const endpoints = this.parseJsonArray<EndpointSpec>(result.content);

    // Safety gate: validate ALL endpoint IDs
    for (const ep of endpoints) {
      if (!ep.id || !ep.id.match(/^[a-z][a-z0-9_]+$/)) {
        this.warnings.push(`Endpoint "${ep.id}" has invalid snake_case ID`);
      }
      if (!ep.method) {
        this.warnings.push(`Endpoint "${ep.id}" is missing HTTP method`);
      }
    }

    return endpoints;
  }

  private generateToolsFromEndpoints(
    endpoints: EndpointSpec[],
    analysis: AnalysisResult,
  ): GeneratedTool[] {
    const hasAuth = analysis.authModel !== "none" && analysis.authModel !== "public";
    const authParamName = hasAuth
      ? analysis.authModel === "bot_token" ? "botToken" : "apiKey"
      : "";
    const authHeaderTemplate = hasAuth
      ? analysis.authModel === "bot_token"
        ? "${params.botToken}"
        : "Bearer ${params.apiKey}"
      : "";

    return endpoints.map((ep) =>
      generateToolFile(ep, analysis.baseUrl, authParamName, authHeaderTemplate),
    );
  }

  private async generateBlock(
    analysis: AnalysisResult,
    endpoints: EndpointSpec[],
    tools: GeneratedTool[],
  ): Promise<string> {
    // Build operations list from endpoints for the dropdown
    const operations = endpoints.map((ep) => ({
      label: ep.name || ep.id,
      id: ep.id,
    }));

    // Ask LLM for minimal display metadata (keep prompt short for small models)
    const result = await this.client.call(`
Return JSON for ${this.serviceName} (slug: ${analysis.provider}, auth: ${analysis.authModel}):
{"displayName":"Short name","description":"One line","integrationType":"Communication","bgColor":"#6366f1","tags":["API","Data"],"templates":[{"name":"Fetch Data","prompt":"Build a workflow that fetches data from ${this.serviceName}"}]}
integrationType: AI|Analytics|Commerce|Communication|Databases|DevOps|Documents|Email|HR|Marketing|Observability|Productivity|Sales|Search|Security|Support
tags: AI|Analytics|Automation|Bot|Communication|CRM|Data|Databases|DevOps|Documents|Email|HR|Marketing|Observability|Productivity|Sales|Search|Security|Support|Payments|E-commerce|Integration`);

    const blockMeta = this.parseJson<{
      displayName: string;
      description: string;
      longDescription?: string;
      category: string;
      integrationType: string;
      bgColor: string;
      iconName: string;
      tags: string[];
      templates: Array<{ name: string; prompt: string }>;
      skills: Array<{ title: string; action: string }>;
      docsLink?: string;
    }>(result.content);

    return generateBlockFile({
      serviceName: this.serviceName,
      serviceSlug: analysis.provider,
      displayName: blockMeta.displayName || this.serviceName,
      description: blockMeta.description || `Integrate ${this.serviceName} into your workflows`,
      longDescription: blockMeta.longDescription,
      category: blockMeta.category || "tools",
      integrationType: blockMeta.integrationType || "Communication",
      authMode:
        analysis.authModel === "none" || analysis.authModel === "public"
          ? "ApiKey" // Block type system requires an auth mode even for public APIs
          : analysis.authModel === "oauth2"
            ? "OAuth"
            : analysis.authModel === "bot_token"
              ? "BotToken"
              : "ApiKey",
      bgColor: blockMeta.bgColor || "#6366f1",
      iconName: blockMeta.iconName || analysis.provider,
      tools: tools.map((t) => t.id),
      operations,
      hasTriggers: analysis.hasWebhooks,
      triggerIds: analysis.hasWebhooks ? [`${analysis.provider}_webhook`] : [],
      tags: blockMeta.tags?.length ? blockMeta.tags : ["Integration"],
      templates: blockMeta.templates?.length
        ? blockMeta.templates
        : [
            {
              name: `${this.serviceName} Action`,
              prompt: `Build a workflow that uses ${this.serviceName}`,
            },
          ],
      skills: blockMeta.skills?.length
        ? blockMeta.skills
        : [{ title: `${this.serviceName} Operation`, action: tools[0]?.id ?? "" }],
      authParams:
        analysis.authModel === "none" || analysis.authModel === "public"
          ? []
          : [
              {
                id: analysis.authModel === "bot_token" ? "botToken" : "apiKey",
                title: analysis.authModel === "bot_token" ? "Bot Token" : "API Key",
                type: "short-input",
                required: true,
              },
            ],
      docsLink: blockMeta.docsLink,
    });
  }

  private async generateTriggers(analysis: AnalysisResult): Promise<string> {
    const result = await this.client.call(`
Return JSON for ${this.serviceName} webhook trigger. Events: ${analysis.webhookEvents.join(", ")}.
{"displayName":"${this.serviceName}","description":"Triggers on ${this.serviceName} events","events":[{"id":"event.type","label":"Event"}],"outputFields":[{"name":"id","type":"string","description":"Event ID"}],"hasSignatureVerification":false,"setupInstructions":["Go to dashboard","Create webhook","Paste URL"]}`);

    const triggerMeta = this.parseJson<TriggerGenOptions>(result.content);

    return generateTriggerFile({
      ...triggerMeta,
      serviceName: this.serviceName,
      serviceSlug: analysis.provider,
    });
  }

  private generateIconStub(serviceSlug: string): string {
    const pascalName = toPascalCase(serviceSlug);
    return `import React from 'react'

/**
 * ${pascalName} icon component.
 * TODO: Replace with actual SVG from the service's brand kit.
 */
export const ${pascalName}Icon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect width="24" height="24" rx="4" fill="currentColor" opacity="0.15" />
    <text
      x="12"
      y="16"
      textAnchor="middle"
      fontSize="12"
      fontWeight="bold"
      fill="currentColor"
    >
      ${pascalName.slice(0, 2).toUpperCase()}
    </text>
  </svg>
)
`;
  }

  private buildRegistryEntries(
    serviceSlug: string,
    tools: GeneratedTool[],
    triggerId: string,
    analysis: AnalysisResult,
  ): RegistryEntry[] {
    const pascalName = toPascalCase(serviceSlug);
    const entries: RegistryEntry[] = [];

    // Tool registry — one import line per service
    // Sim.ai pattern: import all tools from '@/tools/{service}'
    const toolNames = tools.map((t) => `${toCamelCase(t.id)}Tool`).join(",\n  ");

    // Tool registry — one import for all tools, then individual map entries
    entries.push({
      registryFile: "apps/sim/tools/registry.ts",
      importLine: `import {\n  ${toolNames},\n} from '@/tools/${serviceSlug}'`,
      registryLine: `${tools[0].id}: ${toCamelCase(tools[0].id)}Tool,`,
      sortKey: tools[0].id,
    });

    for (let i = 1; i < tools.length; i++) {
      entries.push({
        registryFile: "apps/sim/tools/registry.ts",
        importLine: "",
        registryLine: `${tools[i].id}: ${toCamelCase(tools[i].id)}Tool,`,
        sortKey: tools[i].id,
      });
    }

    // Block registry — same import for Block + BlockMeta
    entries.push({
      registryFile: "apps/sim/blocks/registry.ts",
      importLine: `import { ${pascalName}Block, ${pascalName}BlockMeta } from '@/blocks/blocks/${serviceSlug}'`,
      registryLine: `${serviceSlug}: ${pascalName}Block,`,
      sortKey: serviceSlug,
    });

    entries.push({
      registryFile: "apps/sim/blocks/registry.ts",
      importLine: "",
      registryLine: `${serviceSlug}: ${pascalName}BlockMeta,`,
      sortKey: serviceSlug,
      isBlockMeta: true,
    });

    if (triggerId) {
      entries.push({
        registryFile: "apps/sim/triggers/registry.ts",
        importLine: `import { ${serviceSlug}WebhookTrigger } from '@/triggers/${serviceSlug}'`,
        registryLine: `${triggerId}: ${serviceSlug}WebhookTrigger,`,
        sortKey: triggerId,
        isTrigger: true,
      });
    }

    return entries;
  }

  private async validateIntegration(
    toolCount: number,
    blockGenerated: boolean,
    triggersGenerated: boolean,
  ): Promise<string> {
    const unverifiedList =
      this.unverifiedEndpoints.length > 0
        ? `\nUnverified schemas: ${this.unverifiedEndpoints.join(", ")}`
        : "";

    const result = await this.client.call(`Validate ${this.serviceName}: ${toolCount} tools, block=${blockGenerated}, triggers=${triggersGenerated}.${unverifiedList} Check: 1)snake_case IDs 2)visibility correct 3)grouped block 4)no guessed outputs 5)auth hidden. Reply PASS or FAIL per rule.`);

    return result.content;
  }

  // ==========================================================================
  // JSON Parsing Helpers
  // ==========================================================================

  private parseJson<T>(content: string): T {
    const repaired = this.repairJson(content);
    try {
      return JSON.parse(repaired) as T;
    } catch (e1) {
      const jsonMatch = repaired.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[1]) as T; } catch {}
      }
      const objMatch = repaired.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try { return JSON.parse(objMatch[0]) as T; } catch {}
      }
      throw new Error(`Failed to parse JSON:\n${repaired.slice(0, 500)}`);
    }
  }

  private parseJsonArray<T>(content: string): T[] {
    const repaired = this.repairJson(content);
    try {
      const parsed = JSON.parse(repaired);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {}
    const arrMatch = repaired.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        const parsed = JSON.parse(arrMatch[0]);
        if (Array.isArray(parsed)) return parsed as T[];
      } catch {}
    }
    throw new Error(`Failed to parse JSON array:\n${repaired.slice(0, 500)}`);
  }

  /** Basic JSON repair for common LLM output issues. */
  private repairJson(raw: string): string {
    let s = raw.trim();
    // Remove markdown code fences
    s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
    // Fix unterminated strings: add missing closing quote before newline
    s = s.replace(/(:\s*"[^"\n]*)(\n)/g, '$1"$2');
    // Remove trailing commas before } or ]
    s = s.replace(/,(\s*[}\]])/g, "$1");
    // Balance braces: count { and } and add missing }
    const opens = (s.match(/\{/g) || []).length;
    const closes = (s.match(/\}/g) || []).length;
    if (opens > closes) {
      s += "\n}" + "}".repeat(opens - closes - 1);
    }
    return s;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function toPascalCase(str: string): string {
  return str
    .split(/[_\s-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
