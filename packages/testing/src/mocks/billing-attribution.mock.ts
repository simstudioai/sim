import { vi } from 'vitest'

/** Header names from the generated billing protocol (`billing-protocol-v1`). */
const BILLING_ACCOUNT_DECISION_HEADER = 'x-sim-billing-account-decision'
const BILLING_ATTRIBUTION_HEADER = 'x-sim-billing-attribution'
const COPILOT_BILLING_PROTOCOL_HEADER = 'x-sim-billing-protocol'
const BILLING_REQUEST_ID_HEADER = 'x-sim-billing-request-id'
const BILLING_ACCOUNT_DECISION_HEADER_MAX_BYTES = 2048

/** Copilot billing protocol markers, identical to the generated constant. */
const COPILOT_BILLING_PROTOCOL = {
  attributed: 'attribution-v1',
  direct: 'direct-v1',
  legacy: 'legacy-v0',
} as const

/** Metadata key the real module reads from `@/lib/billing/core/reporting-period`. */
const ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY = 'reportingPeriodAnchorDate'

interface MockPayerSubscriptionSnapshot {
  referenceId: string
  plan: string
  status: string | null
  seats: number | null
  periodStart: string | null
  periodEnd: string | null
  billingInterval?: 'month' | 'year'
  enterpriseReportingPeriodAnchorDate?: string
}

interface MockBillingAttributionSnapshot {
  organizationId: string | null
  billingEntity: { type: 'user' | 'organization'; id: string }
  billingPeriod: { start: string; end: string; source?: string }
  payerSubscription: MockPayerSubscriptionSnapshot | null
}

/** Real serialization without the snapshot validation step. */
function serializeHeader(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value))
}

let billingRequestSequence = 0

/**
 * Sequential UUID-shaped request ids. Not `@sim/utils/id`: a mock must never import
 * a module tests themselves mock, or a file that mocks it hits a hoisting TDZ error.
 */
function nextBillingRequestId(): string {
  billingRequestSequence += 1
  return `00000000-0000-4000-8000-${String(billingRequestSequence).padStart(12, '0')}`
}

/** Real envelope shape: protocol marker, fresh UUID request id, URI-encoded attribution. */
function createAttributedBillingRequestEnvelope(attribution: unknown) {
  const billingRequestId = nextBillingRequestId()
  const serializedAttribution = serializeHeader(attribution)
  return {
    billingRequestId,
    serializedAttribution,
    headers: {
      [COPILOT_BILLING_PROTOCOL_HEADER]: COPILOT_BILLING_PROTOCOL.attributed,
      [BILLING_REQUEST_ID_HEADER]: billingRequestId,
      [BILLING_ATTRIBUTION_HEADER]: serializedAttribution,
    },
  }
}

/** Real conversion to the usage-ledger billing context, minus validation. */
function toBillingContext(attribution: MockBillingAttributionSnapshot) {
  return {
    billingEntity: { type: attribution.billingEntity.type, id: attribution.billingEntity.id },
    billingPeriod: {
      start: new Date(attribution.billingPeriod.start),
      end: new Date(attribution.billingPeriod.end),
      ...(attribution.billingPeriod.source ? { source: attribution.billingPeriod.source } : {}),
    },
  }
}

/** Faithful copy of the real `toUsageLimitSubscription`. */
function toUsageLimitSubscription(attribution: MockBillingAttributionSnapshot) {
  const snapshot = attribution.payerSubscription
  if (!snapshot) {
    if (!attribution.organizationId) return null
    return {
      referenceId: attribution.organizationId,
      plan: 'free',
      status: null,
      seats: null,
      periodStart: new Date(attribution.billingPeriod.start),
      periodEnd: new Date(attribution.billingPeriod.end),
    }
  }
  return {
    referenceId: snapshot.referenceId,
    plan: snapshot.plan,
    status: snapshot.status,
    seats: snapshot.seats,
    periodStart: snapshot.periodStart ? new Date(snapshot.periodStart) : null,
    periodEnd: snapshot.periodEnd ? new Date(snapshot.periodEnd) : null,
    billingInterval: snapshot.billingInterval ?? null,
    metadata: snapshot.enterpriseReportingPeriodAnchorDate
      ? {
          [ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY]:
            snapshot.enterpriseReportingPeriodAnchorDate,
        }
      : null,
    usagePeriod: {
      start: new Date(attribution.billingPeriod.start),
      end: new Date(attribution.billingPeriod.end),
      source:
        attribution.billingPeriod.source ??
        (snapshot.enterpriseReportingPeriodAnchorDate ? 'reporting' : 'stripe'),
      anchorDate: snapshot.enterpriseReportingPeriodAnchorDate ?? null,
      interval: snapshot.billingInterval ?? null,
    },
  }
}

/**
 * Controllable mock functions for `@/lib/billing/core/billing-attribution`.
 *
 * Resolvers, usage/block checks, and header `require*` readers are bare `vi.fn()`s.
 * Pure transforms default to the real logic without the snapshot validator:
 * `assertBillingAttributionSnapshot` is identity, `serialize*Header` URI-encodes the JSON,
 * `createAttributedBillingRequestEnvelope` builds the real envelope with a fresh UUID,
 * `toBillingContext` / `toUsageLimitSubscription` convert like production, and
 * `billingAttributionsEqual` compares JSON.
 *
 * @example
 * ```ts
 * import { billingAttributionMockFns } from '@sim/testing/mocks/billing-attribution.mock'
 *
 * billingAttributionMockFns.mockResolveBillingAttribution.mockResolvedValue(attribution)
 * billingAttributionMockFns.mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
 * ```
 */
export const billingAttributionMockFns = {
  mockAssertBillingAttributionSnapshot: vi.fn(<T>(value: T): T => value),
  mockSerializeBillingAttributionHeader: vi.fn(serializeHeader),
  mockCreateAttributedBillingRequestEnvelope: vi.fn(createAttributedBillingRequestEnvelope),
  mockRequireBillingRequestIdHeader: vi.fn(),
  mockRequireBillingCallbackAttribution: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockRequireWorkspaceBillingAttributionHeader: vi.fn(),
  mockBillingAttributionsEqual: vi.fn(
    (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
  ),
  mockSerializeAccountBillingDecisionHeader: vi.fn(serializeHeader),
  mockRequireAccountBillingDecisionHeader: vi.fn(),
  mockToUsageLimitSubscription: vi.fn(toUsageLimitSubscription),
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
  mockResolveWorkspaceBillingPayer: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockResolveOrganizationBillingPayer: vi.fn(),
  mockResolveOrganizationBillingAttribution: vi.fn(),
  mockResolveSystemOrganizationBillingAttribution: vi.fn(),
  mockAssertBillingAttributionOwner: vi.fn(),
  mockResolveLegacyV0BillingAttribution: vi.fn(),
  mockResolveSystemBillingAttribution: vi.fn(),
  mockToBillingContext: vi.fn(toBillingContext),
  mockCheckAttributedBillingBlocks: vi.fn(),
  mockCheckAttributedUsageLimits: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/core/billing-attribution`, including the
 * billing-protocol header constants it re-exports.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
 * ```
 */
export const billingAttributionMock = {
  BILLING_ACCOUNT_DECISION_HEADER,
  BILLING_ACCOUNT_DECISION_HEADER_MAX_BYTES,
  BILLING_ATTRIBUTION_HEADER,
  BILLING_REQUEST_ID_HEADER,
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
  assertBillingAttributionSnapshot: billingAttributionMockFns.mockAssertBillingAttributionSnapshot,
  serializeBillingAttributionHeader:
    billingAttributionMockFns.mockSerializeBillingAttributionHeader,
  createAttributedBillingRequestEnvelope:
    billingAttributionMockFns.mockCreateAttributedBillingRequestEnvelope,
  requireBillingRequestIdHeader: billingAttributionMockFns.mockRequireBillingRequestIdHeader,
  requireBillingCallbackAttribution:
    billingAttributionMockFns.mockRequireBillingCallbackAttribution,
  requireBillingAttributionHeader: billingAttributionMockFns.mockRequireBillingAttributionHeader,
  requireWorkspaceBillingAttributionHeader:
    billingAttributionMockFns.mockRequireWorkspaceBillingAttributionHeader,
  billingAttributionsEqual: billingAttributionMockFns.mockBillingAttributionsEqual,
  serializeAccountBillingDecisionHeader:
    billingAttributionMockFns.mockSerializeAccountBillingDecisionHeader,
  requireAccountBillingDecisionHeader:
    billingAttributionMockFns.mockRequireAccountBillingDecisionHeader,
  toUsageLimitSubscription: billingAttributionMockFns.mockToUsageLimitSubscription,
  getWorkspaceBilledAccountUserId: billingAttributionMockFns.mockGetWorkspaceBilledAccountUserId,
  resolveWorkspaceBillingPayer: billingAttributionMockFns.mockResolveWorkspaceBillingPayer,
  resolveBillingAttribution: billingAttributionMockFns.mockResolveBillingAttribution,
  resolveOrganizationBillingPayer: billingAttributionMockFns.mockResolveOrganizationBillingPayer,
  resolveOrganizationBillingAttribution:
    billingAttributionMockFns.mockResolveOrganizationBillingAttribution,
  resolveSystemOrganizationBillingAttribution:
    billingAttributionMockFns.mockResolveSystemOrganizationBillingAttribution,
  assertBillingAttributionOwner: billingAttributionMockFns.mockAssertBillingAttributionOwner,
  resolveLegacyV0BillingAttribution:
    billingAttributionMockFns.mockResolveLegacyV0BillingAttribution,
  resolveSystemBillingAttribution: billingAttributionMockFns.mockResolveSystemBillingAttribution,
  toBillingContext: billingAttributionMockFns.mockToBillingContext,
  checkAttributedBillingBlocks: billingAttributionMockFns.mockCheckAttributedBillingBlocks,
  checkAttributedUsageLimits: billingAttributionMockFns.mockCheckAttributedUsageLimits,
}
