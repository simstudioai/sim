#!/usr/bin/env bun
/**
 * SIM Universal Integrator v8 — CLI Entry Point
 *
 * Usage:
 *   bun run src/index.ts <service-name> "<api-description>"
 *
 *   LOCAL_LLM_URL=http://localhost:1234/api/v1/chat bun run src/index.ts Stripe "..."
 *   SIM_WORKSPACE=/path/to/sim bun run src/index.ts Stripe "..."
 */

import { existsSync, readFileSync } from "node:fs";
import { SimIntegrationAgent } from "./agent-sdk";

const USAGE = `
════════════════════════════════════════════════════════════════════════════════
SIM UNIVERSAL INTEGRATOR v8 — Generate ANY API Integration for Sim.ai
════════════════════════════════════════════════════════════════════════════════

USAGE:
  bun run src/index.ts <service-name> "<api-description>"

ENVIRONMENT:
  LOCAL_LLM_URL            LLM server URL (default: http://localhost:1234/api/v1/chat)
  SIM_WORKSPACE            Path to sim repo (default: auto-detected)
  SIM_INTEGRATOR_DRY_RUN   Set to "1" to preview without writing files
  SIM_INTEGRATOR_MODEL     Model name (default: mistralai/ministral-3-3b)

EXAMPLES:

  # Stripe payments
  bun run src/index.ts Stripe "Payment processing API.
    Base URL: https://api.stripe.com/v1
    Auth: Bearer token (sk_live_*)
    Resources: Customers, Charges, Invoices, Subscriptions, Products,
    PaymentMethods, Refunds, Checkout, Webhooks"

  # Telegram Bot
  bun run src/index.ts Telegram "Bot API for messaging.
    Base URL: https://api.telegram.org/bot{token}
    Auth: Bot token
    Methods: sendMessage, sendPhoto, editMessageText, getUpdates, setWebhook"

  # Any REST API
  bun run src/index.ts ServiceName "API description with:
    - Base URL
    - Auth method (OAuth2 / API Key / Bearer / Bot Token)
    - All endpoints you know about
    - Webhook events (if any)
    - Response schemas (if known)"

FEATURES:
  ✓ Local LLM via REST API (localhost:1234)
  ✓ 11-phase integration pipeline
  ✓ Full ToolConfig generation (one per endpoint)
  ✓ Grouped BlockConfig + BlockMeta
  ✓ Webhook TriggerConfig generation
  ✓ Automatic file writing to apps/sim/tools|blocks|triggers/
  ✓ Automatic registry patching
  ✓ Token tracking
  ✓ Dry-run mode

════════════════════════════════════════════════════════════════════════════════
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(USAGE);
    process.exit(args.length === 0 ? 0 : 1);
  }

  const serviceName = args[0];
  const apiDescription = args.slice(1).join(" ");

  const workspaceRoot = process.env.SIM_WORKSPACE || findWorkspaceRoot(process.cwd());
  const dryRun = process.env.SIM_INTEGRATOR_DRY_RUN === "1";
  const llmUrl = process.env.LOCAL_LLM_URL;
  const model = process.env.SIM_INTEGRATOR_MODEL;

  const agent = new SimIntegrationAgent({
    serviceName,
    apiDescription,
    workspaceRoot,
    llmUrl,
    model,
    dryRun,
  });

  try {
    await agent.run();
  } catch (error) {
    console.error("\n❌ Integration generation failed:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Try to find the sim workspace root.
 * Walks up from cwd looking for package.json with "sim" name.
 */
function findWorkspaceRoot(cwd: string): string {
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    const pkgPath = `${dir}/package.json`;
    try {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        // The monorepo root has workspaces + name === 'sim'
        if (pkg.name === "sim" && pkg.workspaces) {
          return dir;
        }
        // Fallback: any package.json with workspaces is a monorepo root
        if (pkg.workspaces && Array.isArray(pkg.workspaces)) {
          return dir;
        }
      }
    } catch {
      // Continue walking up
    }
    const parent = dir.substring(0, dir.lastIndexOf("/"));
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return cwd;
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
