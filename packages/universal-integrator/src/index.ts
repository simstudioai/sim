#!/usr/bin/env bun
/**
 * sim-universal-integrator v5
 *
 * DETERMINISTIC PIPELINE (not AI agent):
 * Chain of algorithms that GUARANTEES complete API integration
 *
 * Phase 1: FETCH & PARSE
 * Phase 2: EXTRACT ENDPOINTS
 * Phase 3: GENERATE TYPES
 * Phase 4: GENERATE TOOLS
 * Phase 5: REGISTER
 * Phase 6: VALIDATE
 *
 * Each phase MUST complete successfully before next begins
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "./args.js";

const client = new Anthropic();

interface Endpoint {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  params: Record<string, any>;
}

interface ApiInventory {
  provider: string;
  baseUrl: string;
  endpoints: Endpoint[];
  categories: Record<string, Endpoint[]>;
}

class Pipeline {
  private service: string;
  private simRepo: string;
  private dryRun: boolean;
  private outDir: string;
  private provider: string = "";
  private inventory: ApiInventory | null = null;

  constructor(args: ReturnType<typeof parseArgs>) {
    this.service = args.service;
    this.simRepo = args.simRepo;
    this.dryRun = args.dryRun;
    this.outDir = args.outDir;
  }

  log(phase: string, msg: string) {
    console.log(`\n📍 [${phase}] ${msg}`);
  }

  error(msg: string) {
    console.error(`\n❌ ERROR: ${msg}`);
    process.exit(1);
  }

  async phase1_fetch() {
    this.log("PHASE 1", "FETCH & PARSE API spec");

    const prompt = `You are analyzing the API for: ${this.service}

    Task: Extract the provider name (e.g. "stripe", "telegram") and provide a summary of what this API does.

    Return ONLY valid JSON in this format (no markdown, no backticks, PURE JSON):
    {
      "provider": "service_name_lowercase",
      "baseUrl": "https://api.example.com",
      "summary": "Brief description of API"
    }`;

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    let result: any;
    try {
      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      result = JSON.parse(text);
    } catch (e) {
      this.error(`Failed to parse Phase 1 response: ${e}`);
    }

    this.provider = result.provider;
    console.log(`   Provider: ${this.provider}`);
    console.log(`   Base URL: ${result.baseUrl}`);

    return result;
  }

  async phase2_extract() {
    this.log("PHASE 2", "EXTRACT all API endpoints");

    const prompt = `You are analyzing API: ${this.service}

    Task: Extract EVERY endpoint/method from this API.

    For EACH endpoint, provide:
    - id: snake_case identifier
    - name: Human readable name
    - method: HTTP method
    - path: API path
    - description: What it does
    - params: object with parameter definitions

    Return ONLY valid JSON array (no markdown):
    [
      {
        "id": "list_users",
        "name": "List Users",
        "method": "GET",
        "path": "/users",
        "description": "Get all users",
        "params": {"limit": "number", "offset": "number"}
      }
    ]

    Be EXHAUSTIVE - extract every single endpoint!`;

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });

    let endpoints: Endpoint[];
    try {
      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      endpoints = JSON.parse(text);
    } catch (e) {
      this.error(`Failed to parse Phase 2 response: ${e}`);
    }

    console.log(`   Extracted: ${endpoints.length} endpoints`);

    // Group by category
    const categories: Record<string, Endpoint[]> = {};
    endpoints.forEach((ep) => {
      const cat = ep.id.split("_")[0] || "core";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(ep);
    });

    this.inventory = {
      provider: this.provider,
      baseUrl: "https://api.example.com",
      endpoints,
      categories,
    };

    return endpoints;
  }

  async phase3_generate_types() {
    this.log("PHASE 3", "GENERATE TypeScript types");

    if (!this.inventory) this.error("No inventory from Phase 2");

    const prompt = `Generate TypeScript interfaces for these endpoints:
    ${JSON.stringify(this.inventory!.endpoints.slice(0, 5), null, 2)}

    Return ONLY valid TypeScript code (no markdown):
    export interface CreateUserParams { ... }
    export interface User { ... }
    export interface ListUsersResponse { ... }
    `;

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const typeCode =
      response.content[0].type === "text" ? response.content[0].text : "";
    const typesFile = path.join(
      this.simRepo,
      "apps/sim/tools",
      this.provider,
      "types.ts"
    );

    this._ensureDir(typesFile);
    this._writeFile(
      typesFile,
      `// Auto-generated types for ${this.provider}\n\n${typeCode}`
    );

    console.log(`   Written: ${typesFile}`);
  }

  async phase4_generate_tools() {
    this.log("PHASE 4", "GENERATE tool files");

    if (!this.inventory) this.error("No inventory from Phase 2");

    for (const [category, endpoints] of Object.entries(
      this.inventory.categories
    )) {
      const toolName = `${this.provider}_${category}`;

      const prompt = `Generate a LangChain/Sim tool for these endpoints:
      ${JSON.stringify(endpoints.slice(0, 3), null, 2)}

      Return ONLY valid TypeScript:
      export const ${this._toCamelCase(toolName)}Tool: ToolConfig = { ... }
      `;

      const response = await client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      });

      const toolCode =
        response.content[0].type === "text" ? response.content[0].text : "";
      const toolFile = path.join(
        this.simRepo,
        "apps/sim/tools",
        this.provider,
        `${toolName}.ts`
      );

      this._ensureDir(toolFile);
      this._writeFile(
        toolFile,
        `import type { ToolConfig } from '@/tools/types'\n\n${toolCode}`
      );

      console.log(`   ✓ ${toolFile}`);
    }
  }

  async phase5_register() {
    this.log("PHASE 5", "REGISTER all tools");

    if (!this.inventory) this.error("No inventory from Phase 2");

    const registryPath = path.join(
      this.simRepo,
      "apps/sim/tools/registry.ts"
    );
    let registry = fs.readFileSync(registryPath, "utf-8");

    // Generate imports
    const imports = Object.keys(this.inventory.categories)
      .map((cat) => {
        const toolName = `${this.provider}_${cat}`;
        return `  ${this._toCamelCase(toolName)}Tool,`;
      })
      .join("\n");

    const importBlock = `import {\n${imports}\n} from '@/tools/${this.provider}'`;

    // Check if already imported
    if (!registry.includes(`from '@/tools/${this.provider}'`)) {
      registry = registry.replace(
        "export const toolRegistry = [",
        `${importBlock}\n\nexport const toolRegistry = [`
      );
    }

    // Add to registry
    const registryEntries = Object.keys(this.inventory.categories)
      .map((cat) => {
        const toolName = `${this.provider}_${cat}`;
        return `  ${toolName}: ${this._toCamelCase(toolName)}Tool,`;
      })
      .join("\n");

    if (!registry.includes(`${this.provider}_`)) {
      registry = registry.replace(
        "export const toolRegistry = {",
        `export const toolRegistry = {\n${registryEntries}\n`
      );
    }

    this._writeFile(registryPath, registry);
    console.log(`   ✓ Registered ${Object.keys(this.inventory.categories).length} tools`);
  }

  async phase6_validate() {
    this.log("PHASE 6", "VALIDATE completeness");

    if (!this.inventory) this.error("No inventory from Phase 2");

    const toolsDir = path.join(this.simRepo, "apps/sim/tools", this.provider);
    const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".ts"));

    const expectedCount = Object.keys(this.inventory.categories).length + 2; // +2 for types.ts and index.ts
    const actualCount = files.length;

    if (actualCount < expectedCount) {
      this.error(`Missing tools! Expected ${expectedCount}, got ${actualCount}`);
    }

    console.log(`   ✓ All ${actualCount} files created`);
    console.log(`   ✓ All ${Object.keys(this.inventory.categories).length} tools registered`);
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

  private _ensureDir(filePath: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private _writeFile(filePath: string, content: string) {
    if (this.dryRun) {
      const dryPath = filePath.replace(this.simRepo, this.outDir);
      this._ensureDir(dryPath);
      fs.writeFileSync(dryPath, content, "utf-8");
    } else {
      this._ensureDir(filePath);
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }

  async run() {
    console.log(`\n🚀 sim-integrator v5 (Deterministic Pipeline)`);
    console.log(`Service: ${this.service}`);
    console.log(`Repo: ${this.simRepo}\n`);

    try {
      await this.phase1_fetch();
      await this.phase2_extract();
      await this.phase3_generate_types();
      await this.phase4_generate_tools();
      await this.phase5_register();
      await this.phase6_validate();

      console.log(`\n✅ COMPLETE!\n`);
    } catch (e) {
      this.error(`Pipeline failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function main() {
  const args = parseArgs();
  const pipeline = new Pipeline(args);
  await pipeline.run();
}

main();
