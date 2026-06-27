#!/usr/bin/env bun
/**
 * sim-universal-integrator v4
 *
 * LangChain + Claude agent: takes ANY service (URL or name) and generates a complete
 * sim.ai Block + Tool integration.
 *
 * Usage:
 *   bun run src/index.ts <service_url_or_name> [--sim-repo <path>] [--dry-run] [--out <dir>]
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { createReactAgent } from "@langchain/core/agents";
import { Tool } from "@langchain/core/tools";
import { parseArgs } from "./args.js";
import { buildPrompt } from "./prompt.js";
import { Printer } from "./printer.js";
import { BashTool, WebFetchTool, ReadTool, WriteTool, EditTool, GlobTool, GrepTool, WebSearchTool } from "./tools.js";

async function main(): Promise<void> {
  const args = parseArgs();
  const p = new Printer(args.verbose);

  if (!args.service) {
    console.error("Usage: bun run src/index.ts <service_url_or_name> [options]");
    console.error("  --sim-repo <path>  Path to simstudioai/sim repo (default: cwd)");
    console.error("  --dry-run          Write to --out instead of repo");
    console.error("  --out <dir>        Output dir for dry-run (default: ./generated)");
    console.error("  --verbose          Show tool I/O");
    console.error("\nExamples:");
    console.error("  bun run src/index.ts 'https://core.telegram.org/api'");
    console.error("  bun run src/index.ts 'Stripe' --sim-repo ~/code/sim");
    process.exit(1);
  }

  p.header("sim-universal-integrator v4 (LangChain)");
  p.info(`Service:  ${args.service}`);
  p.info(`Sim repo: ${args.simRepo}`);
  p.info(`Mode:     ${args.dryRun ? `dry-run → ${args.outDir}` : "write to repo"}`);
  p.divider();

  const prompt = buildPrompt(args);

  // Create Claude model
  const model = new ChatAnthropic({
    modelName: "claude-3-5-sonnet-20241022",
    temperature: 0,
    maxTokens: 8192,
  });

  // Create tools for the agent
  const tools: Tool[] = [
    new BashTool(args.simRepo, args.verbose),
    new WebFetchTool(args.verbose),
    new ReadTool(args.simRepo, args.verbose),
    new WriteTool(args.simRepo, args.verbose, args.dryRun, args.outDir),
    new EditTool(args.simRepo, args.verbose),
    new GlobTool(args.simRepo, args.verbose),
    new GrepTool(args.simRepo, args.verbose),
    new WebSearchTool(args.verbose),
  ];

  // Create agent
  const agent = createReactAgent({
    llmWithTools: model.bindTools(tools),
    tools,
    agentRunnerType: "toolsCalling",
  });

  p.info("Starting integration generation...");

  try {
    // Execute agent
    const messages = [
      {
        role: "user",
        content: prompt,
      },
    ];

    let response = await agent.invoke({
      input: prompt,
      messages,
    });

    p.divider();
    p.success("Done");

    if (response.output) {
      p.divider();
      console.log(response.output);
    }
  } catch (error) {
    p.error(`Generation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
