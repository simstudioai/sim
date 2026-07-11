/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * Source: copilot/copilot/contracts/billing-protocol-v1.schema.json
 * Regenerate with: bun run billing-protocol-contract:generate
 */

export const BILLING_PROTOCOL_HEADERS = {
  accountDecision: 'x-sim-billing-account-decision',
  attribution: 'x-sim-billing-attribution',
  protocol: 'x-sim-billing-protocol',
  requestId: 'x-sim-billing-request-id',
} as const

export const BILLING_ACCOUNT_DECISION_HEADER = BILLING_PROTOCOL_HEADERS.accountDecision
export const BILLING_ATTRIBUTION_HEADER = BILLING_PROTOCOL_HEADERS.attribution
export const COPILOT_BILLING_PROTOCOL_HEADER = BILLING_PROTOCOL_HEADERS.protocol
export const BILLING_REQUEST_ID_HEADER = BILLING_PROTOCOL_HEADERS.requestId

export const COPILOT_BILLING_PROTOCOL = {
  attributed: 'attribution-v1',
  direct: 'direct-v1',
  legacy: 'legacy-v0',
} as const

export type CopilotBillingProtocol =
  (typeof COPILOT_BILLING_PROTOCOL)[keyof typeof COPILOT_BILLING_PROTOCOL]

export const COPILOT_BILLING_PROTOCOL_VALUES = [
  COPILOT_BILLING_PROTOCOL.attributed,
  COPILOT_BILLING_PROTOCOL.direct,
  COPILOT_BILLING_PROTOCOL.legacy,
] as const

export const BILLING_ATTRIBUTION_HEADER_MAX_BYTES = 8192
export const BILLING_ACCOUNT_DECISION_HEADER_MAX_BYTES = 2048

export const BILLING_CALLBACK_OUTCOME = {
  billingContextMismatch: {
    code: 'BILLING_CONTEXT_MISMATCH',
    message: 'Idempotency key is already bound to a different billing context',
  },
  duplicateBillingEvent: {
    code: 'DUPLICATE_BILLING_EVENT',
    message: 'Duplicate request: cumulative cost already recorded',
  },
} as const

export const BillingAnalyticsOutcome = {
  DeadLettered: 'dead_lettered',
  Duplicate: 'duplicate',
  NotBillable: 'not_billable',
  RetriesExhausted: 'retries_exhausted',
  Success: 'success',
  Unknown: 'unknown',
} as const

export type BillingAnalyticsOutcomeValue =
  (typeof BillingAnalyticsOutcome)[keyof typeof BillingAnalyticsOutcome]
