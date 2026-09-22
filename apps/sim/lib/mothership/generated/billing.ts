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

export const BillingCallbackBody = z
  .object({
    userId: z.string().min(1, "User ID is required"),
    cost: z.number().min(0, "Cost must be a non-negative number"),
    model: z.string().min(1, "Model is required"),
    inputTokens: z.number().min(0).default(0),
    outputTokens: z.number().min(0).default(0),
    source: z.enum(["copilot", "workspace-chat", "mcp_copilot", "mothership_block"]).default("copilot"),
    idempotencyKey: z.string().min(1, "Idempotency key is required"),
    workspaceId: z.string().min(1).optional(),
    organizationId: z.string().min(1).max(200).optional(),
  })
  .refine((body) => !(body.workspaceId && body.organizationId), {
    message: "workspaceId and organizationId are mutually exclusive",
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

/** Sim authors receipts at the paid execution boundary; tool output carries no billing authority. */
export const ServiceUsageReceipt = z.strictObject({
  id: z.uuid(),
  streamId: z.uuid(),
  toolCallId: z.string().min(1).max(500),
  service: z.string().min(1).max(100),
  costUsd: z.number().finite().nonnegative(),
});
export type ServiceUsageReceipt = z.infer<typeof ServiceUsageReceipt>;
export const ServiceUsageBatch = z.strictObject({ receipts: z.array(ServiceUsageReceipt).min(1).max(100) });
export const ServiceUsageAcknowledgment = z.strictObject({ accepted: z.array(z.uuid()).max(100) });
