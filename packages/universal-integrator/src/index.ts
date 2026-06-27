#!/usr/bin/env bun
/**
 * sim-universal-integrator v7 - DeepSeek Powered
 *
 * DETERMINISTIC ALGORITHM CHAIN with full Sim.ai support
 * using DeepSeek API (OpenAI-compatible)
 *
 * Phase 1: FETCH & ANALYZE
 * Phase 2: EXTRACT ENDPOINTS
 * Phase 3: CATEGORIZE & MAP
 * Phase 4: DESIGN (choose auth, param types, etc)
 * Phase 5: GENERATE TYPES
 * Phase 6: GENERATE TOOLS
 * Phase 7: GENERATE BLOCK
 * Phase 8: REGISTER
 * Phase 9: VALIDATE
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "./args.js";

interface Param {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "file";
  required: boolean;
  description: string;
  subBlockType: "short-input" | "long-input" | "dropdown" | "slider" | "switch" | "json" | "file-upload" | "combobox";
  visibility: "user-only" | "user-or-llm" | "llm-only" | "hidden";
  enum?: string[];
}

interface Endpoint {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  params: Param[];
  responseType: string;
}

interface ApiDesign {
  provider: string;
  baseUrl: string;
  authModel: "api_key" | "oauth2" | "bearer" | "basic" | "webhook_url" | "hosted";
  authHeader: string;
  endpoints: Endpoint[];
  categories: Record<string, Endpoint[]>;
}

class SimIntegrator {
  private service: string;
  private simRepo: string;
  private dryRun: boolean;
  private outDir: string;
  private design: ApiDesign | null = null;
  private generatedTools: Set<string> = new Set();
  private existingTools: Set<string> = new Set();
  private deepseek: OpenAI;

  constructor(args: ReturnType<typeof parseArgs>) {
    this.service = args.service;
    this.simRepo = args.simRepo;
    this.dryRun = args.dryRun;
    this.outDir = args.outDir;

    // Initialize DeepSeek client (OpenAI-compatible API)
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("❌ Error: DEEPSEEK_API_KEY or ANTHROPIC_API_KEY environment variable not set");
      console.error("Get your key at: https://platform.deepseek.com/");
      process.exit(1);
    }

    this.deepseek = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com/v1",
    });

    // Load existing tools
    const toolsPath = path.join(this.simRepo, "apps/sim/tools");
    if (fs.existsSync(toolsPath)) {
      const dirs = fs.readdirSync(toolsPath);
      dirs.forEach((dir) => {
        if (!dir.startsWith(".")) {
          const toolPath = path.join(toolsPath, dir);
          if (fs.statSync(toolPath).isDirectory()) {
            this.existingTools.add(dir);
          }
        }
      });
    }
  }

  log(phase: string, msg: string) {
    console.log(`\n${"━".repeat(60)}`);
    console.log(`📍 ${phase}`);
    console.log(`${"━".repeat(60)}`);
    console.log(`${msg}`);
  }

  error(msg: string): never {
    console.error(`\n❌ FATAL ERROR: ${msg}`);
    process.exit(1);
  }

  async callDeepSeek(prompt: string, maxTokens: number = 2000): Promise<string> {
    try {
      const response = await this.deepseek.chat.completions.create({
        model: "deepseek-chat",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });

      return response.choices[0]?.message?.content || "";
    } catch (error) {
      const err = error as any;
      this.error(
        `DeepSeek API error: ${err.message || "Unknown error"}. Make sure DEEPSEEK_API_KEY is set and valid.`
      );
    }
  }

  async phase1_analyze() {
    this.log("PHASE 1", "FETCH & ANALYZE API");

    const prompt = `Analyze this API: "${this.service}"

Return ONLY valid JSON (no markdown):
{
  "provider": "service_name_lowercase",
  "baseUrl": "https://api.example.com/v1",
  "authModel": "api_key|oauth2|bearer|basic|webhook_url|hosted",
  "authHeader": "Authorization|X-API-Key",
  "apiVersion": "1.0",
  "description": "What this API does"
}`;

    const text = await this.callDeepSeek(prompt, 1000);

    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch (e) {
      this.error(`Phase 1: Invalid JSON response`);
    }

    console.log(`✓ Provider: ${analysis.provider}`);
    console.log(`✓ Auth: ${analysis.authModel}`);
    console.log(`✓ Base URL: ${analysis.baseUrl}`);

    return analysis;
  }

  async phase2_extract() {
    this.log("PHASE 2", "EXTRACT ALL ENDPOINTS");

    const prompt = `Extract EVERY endpoint from: "${this.service}"

For each endpoint return: method, path, name, description, params (with type), responseType

Return ONLY valid JSON array:
[{"method":"GET","path":"/users","name":"List Users","description":"...","params":[...],"responseType":"array"}]

CRITICAL: Extract EVERY single endpoint!`;

    const text = await this.callDeepSeek(prompt, 12000);

    let endpoints;
    try {
      endpoints = JSON.parse(text);
    } catch (e) {
      this.error(`Phase 2: Invalid JSON response`);
    }

    console.log(`✓ Extracted ${endpoints.length} endpoints`);
    return endpoints;
  }

  async phase3_categorize(analysis: any, endpoints: any[]) {
    this.log("PHASE 3", "CATEGORIZE & MAP TO SIM CONSTRUCTS");

    const prompt = `Categorize these ${endpoints.length} endpoints:
${JSON.stringify(endpoints.slice(0, 10), null, 2)}

Return JSON:
{"categories": {"users": ["endpoint_id1", ...], "payments": [...], ...}}`;

    const text = await this.callDeepSeek(prompt, 2000);
    const categorization = JSON.parse(text);

    const categories: Record<string, Endpoint[]> = {};
    Object.entries(categorization.categories).forEach(([cat, epIds]: [string, any]) => {
      categories[cat] = endpoints.filter((ep) =>
        epIds.includes(ep.name?.toLowerCase().replace(/\s+/g, "_"))
      );
    });

    console.log(`✓ Created ${Object.keys(categories).length} categories`);
    return categories;
  }

  async phase4_design(analysis: any, endpoints: any[]) {
    this.log("PHASE 4", "DESIGN (Auth, Param Types, SubBlocks)");

    const prompt = `Design Sim integration for ${analysis.provider}:
Auth: ${analysis.authModel}

Map params to SubBlock types: short-input, long-input, dropdown, slider, switch, json, file-upload

Return JSON:
{"paramMappings": {"email": "short-input", ...}, "supportsWebhooks": true|false}`;

    const text = await this.callDeepSeek(prompt, 1500);
    const design = JSON.parse(text);

    console.log(`✓ Auth model: ${analysis.authModel}`);
    console.log(`✓ Param mappings configured`);

    return design;
  }

  async phase5_types(analysis: any, endpoints: any[]) {
    this.log("PHASE 5", "GENERATE TYPESCRIPT TYPES");

    const prompt = `Generate TypeScript types for ${analysis.provider}:
${JSON.stringify(endpoints.slice(0, 3), null, 2)}

Return ONLY TypeScript code (no markdown):
export interface ... { ... }`;

    const code = await this.callDeepSeek(prompt, 3000);
    const typeFile = path.join(
      this.simRepo,
      "apps/sim/tools",
      analysis.provider,
      "types.ts"
    );

    this._ensureDir(typeFile);
    this._writeFile(typeFile, `// Auto-generated types for ${analysis.provider}\n\n${code}`);

    console.log(`✓ Created types.ts`);
  }

  async phase6_tools(analysis: any, categories: Record<string, any[]>) {
    this.log("PHASE 6", "GENERATE TOOL CONFIGS");

    for (const [category, endpoints] of Object.entries(categories)) {
      const toolId = `${analysis.provider}_${category}`;

      const prompt = `Generate Sim ToolConfig for ${analysis.provider}/${category}:
${JSON.stringify(endpoints.slice(0, 2), null, 2)}

Return ONLY TypeScript (no markdown):
export const ${this._toCamelCase(toolId)}Tool: ToolConfig = {...}`;

      const code = await this.callDeepSeek(prompt, 2000);
      const toolFile = path.join(
        this.simRepo,
        "apps/sim/tools",
        analysis.provider,
        `${toolId}.ts`
      );

      this._ensureDir(toolFile);
      this._writeFile(toolFile, `import type { ToolConfig } from '@/tools/types'\n\n${code}`);

      this.generatedTools.add(toolId);
      console.log(`✓ ${toolId}`);
    }
  }

  async phase7_block(analysis: any, categories: Record<string, any[]>) {
    this.log("PHASE 7", "GENERATE BLOCK CONFIG");

    const toolIds = Array.from(this.generatedTools);
    const prompt = `Generate Sim BlockConfig for ${analysis.provider}:
Auth: ${analysis.authModel}
Tools: ${toolIds.join(", ")}

Return ONLY TypeScript (no markdown):
export const ${this._capitalize(analysis.provider)}Block: BlockConfig = {...}`;

    const code = await this.callDeepSeek(prompt, 3000);
    const blockFile = path.join(
      this.simRepo,
      "apps/sim/blocks/blocks",
      `${analysis.provider}.ts`
    );

    this._ensureDir(blockFile);
    this._writeFile(blockFile, `import type { BlockConfig } from '@/blocks/types'\n\n${code}`);

    console.log(`✓ Created ${analysis.provider}.ts block`);
  }

  async phase8_register(analysis: any) {
    this.log("PHASE 8", "REGISTER IN REGISTRY");

    const toolsRegistry = path.join(this.simRepo, "apps/sim/tools/registry.ts");
    let toolsContent = fs.readFileSync(toolsRegistry, "utf-8");

    const toolImports = Array.from(this.generatedTools)
      .map((id) => `  ${this._toCamelCase(id)}Tool,`)
      .join("\n");

    if (!toolsContent.includes(`from '@/tools/${analysis.provider}'`)) {
      const importStatement = `import {\n${toolImports}\n} from '@/tools/${analysis.provider}'`;
      toolsContent = toolsContent.replace(/^import \{/m, `${importStatement}\nimport {`);
    }

    const toolEntries = Array.from(this.generatedTools)
      .sort()
      .map((id) => `  ${id}: ${this._toCamelCase(id)}Tool,`)
      .join("\n");

    if (!toolsContent.includes(`${analysis.provider}_`)) {
      toolsContent = toolsContent.replace(
        "export const toolRegistry = {",
        `export const toolRegistry = {\n${toolEntries}\n`
      );
    }

    this._writeFile(toolsRegistry, toolsContent);
    console.log(`✓ Registered ${this.generatedTools.size} tools`);
  }

  async phase9_validate(analysis: any) {
    this.log("PHASE 9", "VALIDATE COMPLETENESS");

    const toolsDir = path.join(this.simRepo, "apps/sim/tools", analysis.provider);
    const toolFiles = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".ts"));
    const expectedTools = this.generatedTools.size + 2;

    if (toolFiles.length < expectedTools) {
      this.error(`Missing tool files! Expected ${expectedTools}, got ${toolFiles.length}`);
    }

    console.log(`✓ ${toolFiles.length} tool files created`);
    console.log(`✓ ${this.generatedTools.size} tools registered`);
    console.log(`✓ ALL VALIDATIONS PASSED`);
  }

  private _toCamelCase(str: string): string {
    return str
      .split("_")
      .map((word, i) =>
        i === 0
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join("");
  }

  private _capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private _ensureDir(filePath: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private _writeFile(filePath: string, content: string) {
    const targetPath = this.dryRun
      ? filePath.replace(this.simRepo, this.outDir)
      : filePath;

    this._ensureDir(targetPath);
    fs.writeFileSync(targetPath, content, "utf-8");
  }

  async run() {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🚀 SIM INTEGRATOR v7 - DeepSeek Powered`);
    console.log(`${"═".repeat(60)}`);
    console.log(`Service: ${this.service}`);
    console.log(`API: DeepSeek (https://platform.deepseek.com/)`);
    console.log(`Repo: ${this.simRepo}`);
    console.log(`${"═".repeat(60)}`);

    try {
      const analysis = await this.phase1_analyze();
      const endpoints = await this.phase2_extract();
      const categories = await this.phase3_categorize(analysis, endpoints);
      await this.phase4_design(analysis, endpoints);
      await this.phase5_types(analysis, endpoints);
      await this.phase6_tools(analysis, categories);
      await this.phase7_block(analysis, categories);
      await this.phase8_register(analysis);
      await this.phase9_validate(analysis);

      console.log(`\n${"═".repeat(60)}`);
      console.log(`✅ INTEGRATION COMPLETE!`);
      console.log(`${"═".repeat(60)}\n`);
    } catch (e) {
      this.error(`Pipeline failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function main() {
  const args = parseArgs();
  const integrator = new SimIntegrator(args);
  await integrator.run();
}

main();
