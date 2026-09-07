// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/billing.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const BillingProtocol = {
  attributed: "attribution-v1",
  direct: "direct-v1",
  previous: "legacy-v0",
} as const;

export const BillingProtocolHeaders = {
  protocol: "x-sim-billing-protocol",
  requestId: "x-sim-billing-request-id",
  attribution: "x-sim-billing-attribution",
  accountDecision: "x-sim-billing-account-decision",
} as const;

export const BillingCallbackBody = z.object({
  userId: z.string().min(1, "User ID is required"),
  cost: z.number().min(0, "Cost must be a non-negative number"),
  model: z.string().min(1, "Model is required"),
  inputTokens: z.number().min(0).default(0),
  outputTokens: z.number().min(0).default(0),
  source: z.enum(["copilot", "workspace-chat", "mcp_copilot", "mothership_block"]).default("copilot"),
  idempotencyKey: z.string().min(1, "Idempotency key is required"),
  workspaceId: z.string().min(1).optional(),
});
export type BillingCallbackBody = z.infer<typeof BillingCallbackBody>;

export const BillingCallbackHeaders = z.object({
  [BillingProtocolHeaders.protocol]: z.enum(Object.values(BillingProtocol)).optional(),
  [BillingProtocolHeaders.requestId]: z.string().uuid().optional(),
  [BillingProtocolHeaders.attribution]: z.string().max(8192).optional(),
  [BillingProtocolHeaders.accountDecision]: z.string().max(2048).optional(),
});

export const BillingCallbackResult = z.object({
  success: z.boolean(),
  code: z.string().optional(),
});
export const BillingDuplicateCode = "DUPLICATE_BILLING_EVENT";
