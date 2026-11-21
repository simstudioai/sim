// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/billing-protocol-v1.ts
// Regenerate with `bun run contracts:sync` in the worker.

// The trusted Sim-to-worker billing protocol: header names, protocol modes, bounds, safe
// API-key denials, and callback and analytics outcomes. The names, modes, bounds and codes the
// worker also uses come from ./billing; only Sim's extras are defined here.

import {
  BillingAccountDecisionHeaderMaxBytes,
  BillingAttributionHeaderMaxBytes,
  BillingDuplicateCode,
  BillingProtocol,
  BillingProtocolHeaders,
} from "./billing";

export const BILLING_PROTOCOL_HEADERS = {
  accountDecision: BillingProtocolHeaders.accountDecision,
  attribution: BillingProtocolHeaders.attribution,
  protocol: BillingProtocolHeaders.protocol,
  requestId: BillingProtocolHeaders.requestId,
} as const;

export const BILLING_ACCOUNT_DECISION_HEADER = BILLING_PROTOCOL_HEADERS.accountDecision;
export const BILLING_ATTRIBUTION_HEADER = BILLING_PROTOCOL_HEADERS.attribution;
export const COPILOT_BILLING_PROTOCOL_HEADER = BILLING_PROTOCOL_HEADERS.protocol;
export const BILLING_REQUEST_ID_HEADER = BILLING_PROTOCOL_HEADERS.requestId;

export const COPILOT_BILLING_PROTOCOL = {
  attributed: BillingProtocol.attributed,
  direct: BillingProtocol.direct,
  legacy: BillingProtocol.previous,
} as const;

export type CopilotBillingProtocol = (typeof COPILOT_BILLING_PROTOCOL)[keyof typeof COPILOT_BILLING_PROTOCOL];

export const COPILOT_BILLING_PROTOCOL_VALUES = [
  COPILOT_BILLING_PROTOCOL.attributed,
  COPILOT_BILLING_PROTOCOL.direct,
  COPILOT_BILLING_PROTOCOL.legacy,
] as const;

export const COPILOT_VALIDATION_PURPOSE = {
  newTurn: "new-turn",
  continuation: "continuation",
  cancellation: "cancellation",
} as const;

export const COPILOT_VALIDATION_PURPOSE_VALUES = ["new-turn", "continuation", "cancellation"] as const;

export type CopilotValidationPurpose = (typeof COPILOT_VALIDATION_PURPOSE_VALUES)[number];

export const BILLING_ATTRIBUTION_HEADER_MAX_BYTES = BillingAttributionHeaderMaxBytes;
export const BILLING_ACCOUNT_DECISION_HEADER_MAX_BYTES = BillingAccountDecisionHeaderMaxBytes;

export const BILLING_CALLBACK_OUTCOME = {
  billingContextMismatch: {
    code: "BILLING_CONTEXT_MISMATCH",
    message: "Idempotency key is already bound to a different billing context",
  },
  billingPeriodElapsed: {
    code: "BILLING_PERIOD_ELAPSED",
    message: "Billing period has elapsed; reconciliation required",
  },
  billingUserNotFound: {
    code: "BILLING_USER_NOT_FOUND",
    message: "Billing user no longer exists; reconciliation required",
  },
  duplicateBillingEvent: {
    code: BillingDuplicateCode,
    message: "Duplicate request: cumulative cost already recorded",
  },
} as const;

export const BillingAnalyticsOutcome = {
  DeadLettered: "dead_lettered",
  Duplicate: "duplicate",
  NotBillable: "not_billable",
  RetriesExhausted: "retries_exhausted",
  Success: "success",
  Unknown: "unknown",
} as const;

export type BillingAnalyticsOutcomeValue =
  (typeof BillingAnalyticsOutcome)[keyof typeof BillingAnalyticsOutcome];
