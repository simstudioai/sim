#!/usr/bin/env bun
/**
 * sim-universal-integrator v3
 *
 * Universal agent: takes ANY service (URL or name) and generates a complete
 * sim.ai Block + Tool integration.
 *
 * Core principle: the agent DECIDES, per service, which approach and which
 * optional library (if any) fits — then runs it via `bunx`. It NEVER assumes
 * a fixed parsing stack and ALWAYS has a native-tool fallback.
 *
 * Usage:
 *   bun run src/index.ts <service_url_or_name> [--sim-repo <path>] [--dry-run] [--out <dir>]
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { parseArgs } from "./args.js";
import { buildPrompt } from "./prompt.js";
import { Printer } from "./printer.js";

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
    console.error("  bun run src/index.ts 'https://core.telegram.org/bots/api'");
    console.error("  bun run src/index.ts 'https://apidocs.bitrix24.com'");
    console.error("  bun run src/index.ts 'Stripe' --sim-repo ~/code/sim");
    process.exit(1);
  }

  p.header("sim-universal-integrator v3");
  p.info(`Service:  ${args.service}`);
  p.info(`Sim repo: ${args.simRepo}`);
  p.info(`Mode:     ${args.dryRun ? `dry-run → ${args.outDir}` : "write to repo"}`);
  p.divider();

  const prompt = buildPrompt(args);
  let sessionId: string | undefined;
  let finalResult = "";

  for await (const msg of query({
    prompt,
    options: {
      // Native Claude Code tools. Bash is what lets the agent run `bunx <lib>`
      // on-demand when IT decides a library fits — no preinstalled stack.
      allowedTools: ["WebSearch", "WebFetch", "Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      permissionMode: "acceptEdits",
      cwd: args.simRepo,
    },
  })) {
    if (msg.type === "system" && (msg as any).subtype === "init") {
      sessionId = (msg as any).session_id;
    }
    p.handleMessage(msg as SDKMessage);
    if ("result" in msg && msg.result) finalResult = String(msg.result);
  }

  p.divider();
  p.success("Done");
  if (sessionId) p.info(`Session: ${sessionId}`);
  if (finalResult) {
    p.divider();
    console.log(finalResult);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
