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

export const BillingCallbackHeaders = z
  .object({
    [BillingProtocolHeaders.protocol]: z.enum(Object.values(BillingProtocol)).optional(),
    [BillingProtocolHeaders.requestId]: z.string().uuid().optional(),
    [BillingProtocolHeaders.attribution]: z.string().min(1).max(8192).optional(),
    [BillingProtocolHeaders.accountDecision]: z.string().min(1).max(2048).optional(),
  })
  .superRefine((headers, context) => {
    const protocol = headers[BillingProtocolHeaders.protocol];
    const requestId = headers[BillingProtocolHeaders.requestId];
    const attribution = headers[BillingProtocolHeaders.attribution];
    const decision = headers[BillingProtocolHeaders.accountDecision];
    let valid = false;
    switch (protocol) {
      case undefined:
        valid = !requestId && !attribution && !decision;
        break;
      case BillingProtocol.attributed:
        valid = Boolean(requestId && attribution && !decision);
        break;
      case BillingProtocol.direct:
        valid = Boolean(requestId && decision && !attribution);
        break;
      case BillingProtocol.previous:
        valid = Boolean(attribution && !requestId && !decision);
        break;
    }
    if (!valid)
      context.addIssue({ code: "custom", message: "Incomplete or conflicting billing protocol headers" });
  });

/** Sim's plan-aware usage card: the JSON body of the `<usage_upgrade>` tag its chat renders. */
export const UsageUpgrade = z.object({
  reason: z.literal("usage_limit"),
  action: z.enum(["upgrade_plan", "increase_limit"]),
  message: z.string().min(1).max(1_000),
});
export type UsageUpgrade = z.infer<typeof UsageUpgrade>;

export const BillingCallbackResult = z.object({
  success: z.boolean(),
  code: z.string().optional(),
  /** The payer is over its plan usage limit after this charge. Absent (older Sim) means not over. */
  usageExceeded: z.boolean().optional(),
  /** The card for an over-limit payer; a malformed card never turns a settled charge into a retry. */
  usageUpgrade: UsageUpgrade.optional().catch(undefined),
});

/**
 * A continuation refused for the usage limit. A body-less 402 is a blocked account instead.
 * The code decides; a malformed card falls back to the default one.
 */
export const UsageLimitRefusal = z.object({
  code: z.literal("USAGE_LIMIT_EXCEEDED"),
  usageUpgrade: UsageUpgrade.optional().catch(undefined),
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
