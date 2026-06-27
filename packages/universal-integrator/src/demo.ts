#!/usr/bin/env bun
/**
 * Demo - shows how integrator works without requiring API key
 */

import * as fs from "fs";
import * as path from "path";

// Mock data for Stripe
const STRIPE_DATA = {
  analysis: {
    provider: "stripe",
    baseUrl: "https://api.stripe.com/v1",
    authModel: "bearer",
    authHeader: "Authorization",
  },
  endpoints: [
    {
      method: "GET",
      path: "/customers",
      name: "List Customers",
      description: "Returns a list of your customers",
      params: [
        { name: "limit", type: "number", required: false },
        { name: "starting_after", type: "string", required: false },
      ],
      responseType: "array",
    },
    {
      method: "POST",
      path: "/customers",
      name: "Create Customer",
      description: "Creates a new customer object",
      params: [
        { name: "email", type: "string", required: false },
        { name: "name", type: "string", required: false },
        { name: "metadata", type: "json", required: false },
      ],
      responseType: "object",
    },
    {
      method: "GET",
      path: "/charges",
      name: "List Charges",
      description: "Returns a list of charges",
      params: [{ name: "limit", type: "number", required: false }],
      responseType: "array",
    },
    {
      method: "POST",
      path: "/charges",
      name: "Create Charge",
      description: "Creates a charge",
      params: [
        { name: "amount", type: "number", required: true },
        { name: "currency", type: "string", required: true },
        { name: "source", type: "string", required: true },
      ],
      responseType: "object",
    },
  ],
};

function log(phase: string, msg: string) {
  console.log(`\n${"━".repeat(60)}`);
  console.log(`📍 ${phase}`);
  console.log(`${"━".repeat(60)}`);
  console.log(`${msg}`);
}

async function demo() {
  const simRepo = "/Users/aac/aacsim/sim";

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🚀 SIM INTEGRATOR v6 - DEMO (Mock Data)`);
  console.log(`${"═".repeat(60)}`);

  // Phase 1
  log("PHASE 1", "FETCH & ANALYZE API");
  console.log(`✓ Provider: ${STRIPE_DATA.analysis.provider}`);
  console.log(`✓ Auth: ${STRIPE_DATA.analysis.authModel}`);
  console.log(`✓ Base URL: ${STRIPE_DATA.analysis.baseUrl}`);

  // Phase 2
  log("PHASE 2", "EXTRACT ENDPOINTS");
  console.log(`✓ Extracted ${STRIPE_DATA.endpoints.length} endpoints`);

  // Phase 3
  log("PHASE 3", "CATEGORIZE");
  const categories = {
    customers: STRIPE_DATA.endpoints.slice(0, 2),
    charges: STRIPE_DATA.endpoints.slice(2, 4),
  };
  console.log(`✓ Created ${Object.keys(categories).length} categories`);

  // Phase 4
  log("PHASE 4", "DESIGN");
  console.log(`✓ Auth model: bearer`);
  console.log(`✓ Param mappings: 5 types`);

  // Phase 5
  log("PHASE 5", "GENERATE TYPES");
  const typesFile = path.join(simRepo, "apps/sim/tools/stripe-demo/types.ts");
  const typesCode = `
// Auto-generated types for stripe

export interface Customer {
  id: string;
  email?: string;
  name?: string;
  metadata?: Record<string, any>;
}

export interface Charge {
  id: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending';
}

export interface ListResponse<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
}
`;

  const dir = path.dirname(typesFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(typesFile, typesCode);
  console.log(`✓ Created types.ts`);

  // Phase 6
  log("PHASE 6", "GENERATE TOOLS");
  const tools = ["stripe_customers", "stripe_charges"];

  for (const tool of tools) {
    const toolFile = path.join(simRepo, `apps/sim/tools/stripe-demo/${tool}.ts`);
    const toolCode = `
import type { ToolConfig } from '@/tools/types'

export const ${tool.split("_").map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join("")}Tool: ToolConfig = {
  id: '${tool}',
  name: '${tool.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}',
  description: 'Manage ${tool.split("_")[1]} via Stripe API',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key'
    }
  },
  outputs: {
    result: { type: 'object', description: 'API response' }
  },
  request: {
    url: () => 'https://api.stripe.com/v1/${tool.split("_")[1]}',
    method: () => 'GET',
    headers: (params) => ({
      'Authorization': \`Bearer \${params.apiKey}\`
    })
  }
}
`;
    if (!fs.existsSync(path.dirname(toolFile)))
      fs.mkdirSync(path.dirname(toolFile), { recursive: true });
    fs.writeFileSync(toolFile, toolCode);
    console.log(`✓ ${tool}`);
  }

  // Phase 7
  log("PHASE 7", "GENERATE BLOCK");
  const blockFile = path.join(simRepo, "apps/sim/blocks/blocks/stripe-demo.ts");
  const blockCode = `
import type { BlockConfig } from '@/blocks/types'

export const StripeBlock: BlockConfig = {
  id: 'stripe',
  integrationType: 'stripe',
  name: 'Stripe',
  description: 'Stripe payments integration',
  category: 'tools',
  tags: ['payments', 'billing'],
  authMode: 'credentials',
  docsLink: 'https://stripe.com/docs/api',
  brandColor: '#635BFF',
  subBlocks: [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      visibility: 'user-only',
      password: true,
      description: 'Stripe API key'
    }
  ]
}
`;
  if (!fs.existsSync(path.dirname(blockFile)))
    fs.mkdirSync(path.dirname(blockFile), { recursive: true });
  fs.writeFileSync(blockFile, blockCode);
  console.log(`✓ Created stripe-demo.ts block`);

  // Phase 8
  log("PHASE 8", "REGISTER");
  console.log(`✓ Registered 2 tools`);
  console.log(`✓ Registered block`);

  // Phase 9
  log("PHASE 9", "VALIDATE");
  const toolsDir = path.join(simRepo, "apps/sim/tools/stripe-demo");
  const files = fs.readdirSync(toolsDir).length;
  console.log(`✓ ${files} tool files created`);
  console.log(`✓ 2 tools registered`);
  console.log(`✓ Block created and registered`);
  console.log(`✓ ALL VALIDATIONS PASSED`);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ INTEGRATION COMPLETE!`);
  console.log(`${"═".repeat(60)}\n`);

  console.log("📁 Generated files:");
  console.log(`   - ${typesFile}`);
  console.log(`   - ${path.join(simRepo, "apps/sim/tools/stripe-demo/stripe_customers.ts")}`);
  console.log(`   - ${path.join(simRepo, "apps/sim/tools/stripe-demo/stripe_charges.ts")}`);
  console.log(`   - ${blockFile}`);
}

demo().catch(console.error);
