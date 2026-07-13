/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckInternalApiKey,
  mockRecordCumulativeUsage,
  mockCheckAndBillOverageThreshold,
  mockCheckAndBillPayerOverageThreshold,
  mockRequireAccountBillingDecisionHeader,
  mockRequireBillingAttributionHeader,
  mockResolveLegacyV0BillingAttribution,
  mockToBillingContext,
  MockCumulativeUsageContextMismatchError,
  MockThresholdSettlementError,
  billingState,
} = vi.hoisted(() => ({
  mockCheckInternalApiKey: vi.fn(),
  mockRecordCumulativeUsage: vi.fn(),
  mockCheckAndBillOverageThreshold: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
  mockRequireAccountBillingDecisionHeader: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockResolveLegacyV0BillingAttribution: vi.fn(),
  mockToBillingContext: vi.fn(),
  MockCumulativeUsageContextMismatchError: class extends Error {},
  MockThresholdSettlementError: class extends Error {
    readonly code: string
    readonly retryable = true

    constructor(code: string) {
      super('Billing settlement temporarily unavailable')
      this.name = 'ThresholdSettlementError'
      this.code = code
    }
  },
  billingState: {
    isBillingEnabled: true,
    isCopilotBillingProtocolRequired: false,
  },
}))

vi.mock('@/lib/copilot/request/http', () => ({
  checkInternalApiKey: mockCheckInternalApiKey,
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withIncomingGoSpan: (
    _headers: unknown,
    _span: unknown,
    _attrs: unknown,
    fn: (span: { setAttribute: () => void; setAttributes: () => void }) => unknown
  ) => fn({ setAttribute: vi.fn(), setAttributes: vi.fn() }),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  CumulativeUsageContextMismatchError: MockCumulativeUsageContextMismatchError,
  recordCumulativeUsage: mockRecordCumulativeUsage,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  BILLING_ACCOUNT_DECISION_HEADER: 'x-sim-billing-account-decision',
  BILLING_ATTRIBUTION_HEADER: 'x-sim-billing-attribution',
  BILLING_REQUEST_ID_HEADER: 'x-sim-billing-request-id',
  COPILOT_BILLING_PROTOCOL: {
    attributed: 'attribution-v1',
    direct: 'direct-v1',
    legacy: 'legacy-v0',
  },
  COPILOT_BILLING_PROTOCOL_HEADER: 'x-sim-billing-protocol',
  requireAccountBillingDecisionHeader: mockRequireAccountBillingDecisionHeader,
  requireBillingAttributionHeader: mockRequireBillingAttributionHeader,
  resolveLegacyV0BillingAttribution: mockResolveLegacyV0BillingAttribution,
  toBillingContext: mockToBillingContext,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: mockCheckAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold: mockCheckAndBillPayerOverageThreshold,
  ThresholdSettlementError: MockThresholdSettlementError,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return billingState.isBillingEnabled
  },
  get isCopilotBillingProtocolRequired() {
    return billingState.isCopilotBillingProtocolRequired
  },
}))

import { billingUpdateCostBodySchema } from '@/lib/api/contracts/subscription'
import { POST } from '@/app/api/billing/update-cost/route'

const ACCOUNT_BILLING_DECISION = {
  userId: 'user-1',
  billingEntity: { type: 'organization' as const, id: 'account-org' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
}

const ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'ws-1',
  billedAccountUserId: 'owner-1',
  organizationId: 'org-1',
  billingEntity: { type: 'organization' as const, id: 'org-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

const OLD_GO_HOSTED_UPDATE_COST_BODY = {
  userId: 'user-1',
  cost: 0.4662453,
  model: 'claude-opus-4.8',
  inputTokens: 461371,
  outputTokens: 1686,
  source: 'workspace-chat',
  idempotencyKey: 'random-old-go-billing-id',
  workspaceId: 'ws-1',
} as const

const EXPLICIT_LEGACY_HOSTED_UPDATE_COST_BODY = {
  ...OLD_GO_HOSTED_UPDATE_COST_BODY,
  idempotencyKey: 'explicit-legacy-billing-id',
} as const

const OLD_GO_WORKSPACELESS_UPDATE_COST_BODY = {
  userId: 'user-1',
  cost: 0.5,
  model: 'gpt',
  inputTokens: 1,
  outputTokens: 2,
  source: 'copilot',
  idempotencyKey: 'random-old-go-direct-billing-id',
} as const

const OLD_GO_OPAQUE_WORKSPACE_UPDATE_COST_BODY = {
  ...OLD_GO_WORKSPACELESS_UPDATE_COST_BODY,
  workspaceId: 'local-self-hosted-workspace',
} as const

const KEYLESS_UPDATE_COST_BODY = {
  userId: 'user-1',
  cost: 0.5,
  model: 'gpt',
  inputTokens: 1,
  outputTokens: 2,
  source: 'copilot',
} as const

describe('POST /api/billing/update-cost — workspaceId attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingState.isBillingEnabled = true
    billingState.isCopilotBillingProtocolRequired = false
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockRecordCumulativeUsage.mockResolvedValue({ billed: true, delta: 0.5, total: 0.5 })
    mockCheckAndBillOverageThreshold.mockResolvedValue(undefined)
    mockCheckAndBillPayerOverageThreshold.mockResolvedValue(undefined)
    mockRequireBillingAttributionHeader.mockReturnValue(ATTRIBUTION)
    mockRequireAccountBillingDecisionHeader.mockReturnValue(ACCOUNT_BILLING_DECISION)
    mockResolveLegacyV0BillingAttribution.mockResolvedValue(ATTRIBUTION)
    mockToBillingContext.mockReturnValue({
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    })
  })

  it('returns 401 for a billing-disabled request without valid internal auth', async () => {
    billingState.isBillingEnabled = false
    mockCheckInternalApiKey.mockReturnValue({ success: false, error: 'Invalid internal API key' })

    const res = await POST(
      createMockRequest('POST', {
        userId: 'user-1',
        cost: 0.5,
        model: 'gpt',
        source: 'copilot',
      })
    )

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Invalid internal API key',
    })
    expect(mockCheckInternalApiKey).toHaveBeenCalledTimes(1)
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('returns no-op success for old markerless Go when billing is disabled', async () => {
    billingState.isBillingEnabled = false

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'gpt',
          source: 'copilot',
        },
        { 'x-api-key': 'internal' }
      )
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      message: 'Billing disabled, cost update skipped',
      data: { billingEnabled: false },
    })
    expect(mockCheckInternalApiKey).toHaveBeenCalledTimes(1)
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('keeps the exact old-Go callback bodies contract-compatible', () => {
    expect(billingUpdateCostBodySchema.safeParse(OLD_GO_HOSTED_UPDATE_COST_BODY).success).toBe(true)
    expect(
      billingUpdateCostBodySchema.safeParse(OLD_GO_WORKSPACELESS_UPDATE_COST_BODY).success
    ).toBe(true)
    expect(
      billingUpdateCostBodySchema.safeParse(OLD_GO_OPAQUE_WORKSPACE_UPDATE_COST_BODY).success
    ).toBe(true)
  })

  it('rejects billing-enabled callbacks without a stable idempotency key', async () => {
    const res = await POST(
      createMockRequest('POST', KEYLESS_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
    )

    expect(res.status).toBe(400)
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
    expect(mockCheckAndBillPayerOverageThreshold).not.toHaveBeenCalled()
  })

  it('bills the routed workspace payer for the exact markerless hosted callback', async () => {
    const res = await POST(
      createMockRequest('POST', OLD_GO_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
    )

    expect(res.status).toBe(200)
    expect(mockResolveLegacyV0BillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
      source: 'workspace-chat',
      model: 'claude-opus-4.8',
      cost: 0.4662453,
      eventKey: 'update-cost:random-old-go-billing-id',
      metadata: { inputTokens: 461371, outputTokens: 1686 },
    })
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith(
      { type: 'organization', id: 'org-1' },
      {
        onError: 'throw',
        expectedBillingPeriod: {
          start: new Date('2026-07-01T00:00:00.000Z'),
          end: new Date('2026-08-01T00:00:00.000Z'),
        },
      }
    )
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
  })

  it('returns a retryable 503 when markerless legacy workspace settlement fails', async () => {
    mockCheckAndBillPayerOverageThreshold.mockRejectedValueOnce(
      new MockThresholdSettlementError('required_state_missing')
    )

    const res = await POST(
      createMockRequest('POST', OLD_GO_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
    )

    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('1')
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'BILLING_SETTLEMENT_RETRYABLE',
      error: 'Billing settlement temporarily unavailable',
      retryable: true,
    })
  })

  it('rejects markerless callbacks only when protocol-required is explicitly enabled', async () => {
    billingState.isCopilotBillingProtocolRequired = true
    const res = await POST(
      createMockRequest('POST', OLD_GO_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
    )

    expect(res.status).toBe(400)
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('does not let markerless legacy traffic fall through to a modern attribution envelope', async () => {
    const res = await POST(
      createMockRequest('POST', OLD_GO_HOSTED_UPDATE_COST_BODY, {
        'x-api-key': 'internal',
        'x-sim-billing-attribution': 'serialized-attribution',
      })
    )

    expect(res.status).toBe(400)
    expect(mockRequireBillingAttributionHeader).not.toHaveBeenCalled()
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('rejects explicitly labeled legacy callbacks without admission attribution', async () => {
    billingState.isCopilotBillingProtocolRequired = true
    const res = await POST(
      createMockRequest('POST', EXPLICIT_LEGACY_HOSTED_UPDATE_COST_BODY, {
        'x-api-key': 'internal',
        'x-sim-billing-protocol': 'legacy-v0',
      })
    )

    expect(res.status).toBe(400)
    expect(mockRequireBillingAttributionHeader).not.toHaveBeenCalled()
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('bills explicitly labeled legacy callbacks from their admission attribution', async () => {
    billingState.isCopilotBillingProtocolRequired = true
    const res = await POST(
      createMockRequest('POST', EXPLICIT_LEGACY_HOSTED_UPDATE_COST_BODY, {
        'x-api-key': 'internal',
        'x-sim-billing-protocol': 'legacy-v0',
        'x-sim-billing-attribution': 'serialized-attribution',
      })
    )

    expect(res.status).toBe(200)
    expect(mockRequireBillingAttributionHeader).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
        billingEntity: { type: 'organization', id: 'org-1' },
        eventKey: 'update-cost:explicit-legacy-billing-id',
      })
    )
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith(
      { type: 'organization', id: 'org-1' },
      expect.objectContaining({ onError: 'throw' })
    )
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
  })

  it('rejects a direct-v1 callback without its immutable account decision envelope', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'gpt',
          source: 'mcp_copilot',
          workspaceId: 'local-self-hosted-workspace',
          idempotencyKey: billingRequestId,
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': billingRequestId,
        }
      )
    )
    expect(res.status).toBe(400)
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('bills direct-v1 from its envelope and ignores the local workspace', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          workspaceId: 'local-self-hosted-workspace',
          idempotencyKey: billingRequestId,
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': billingRequestId,
          'x-sim-billing-account-decision': 'serialized-account-decision',
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: undefined,
        billingEntity: { type: 'organization', id: 'account-org' },
        billingPeriod: {
          start: new Date('2026-07-01T00:00:00.000Z'),
          end: new Date('2026-08-01T00:00:00.000Z'),
        },
      })
    )
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith(
      {
        type: 'organization',
        id: 'account-org',
      },
      {
        onError: 'throw',
        expectedBillingPeriod: {
          start: new Date('2026-07-01T00:00:00.000Z'),
          end: new Date('2026-08-01T00:00:00.000Z'),
        },
      }
    )
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
  })

  it('keeps direct-v1 isolated from legacy callback-time resolution', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          idempotencyKey: billingRequestId,
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': billingRequestId,
          'x-sim-billing-account-decision': 'serialized-account-decision',
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockRequireAccountBillingDecisionHeader).toHaveBeenCalled()
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        billingEntity: ACCOUNT_BILLING_DECISION.billingEntity,
      })
    )
  })

  it('rejects a direct-v1 callback whose envelope changes the admitted actor', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
    mockRequireAccountBillingDecisionHeader.mockReturnValueOnce({
      ...ACCOUNT_BILLING_DECISION,
      userId: 'different-user',
    })

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          idempotencyKey: billingRequestId,
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': billingRequestId,
          'x-sim-billing-account-decision': 'different-account-decision',
        }
      )
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      code: 'BILLING_CONTEXT_MISMATCH',
      error: 'Idempotency key is already bound to a different billing context',
    })
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('does not expose context-mismatch 409 to markerless old Go', async () => {
    mockRecordCumulativeUsage.mockRejectedValue(
      new MockCumulativeUsageContextMismatchError('different billing context')
    )

    const res = await POST(
      createMockRequest('POST', OLD_GO_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
    )

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: 'Internal server error',
    })
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
    expect(mockCheckAndBillPayerOverageThreshold).not.toHaveBeenCalled()
  })

  it('preserves old Go duplicate-compatible 409 semantics for markerless callbacks', async () => {
    mockRecordCumulativeUsage.mockResolvedValue({ billed: false, delta: 0, total: 0.4662453 })
    const res = await POST(
      createMockRequest('POST', OLD_GO_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
    )
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      code: 'DUPLICATE_BILLING_EVENT',
    })
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith(
      {
        type: 'organization',
        id: 'org-1',
      },
      {
        onError: 'throw',
        expectedBillingPeriod: {
          start: new Date('2026-07-01T00:00:00.000Z'),
          end: new Date('2026-08-01T00:00:00.000Z'),
        },
      }
    )
  })

  it('retries settlement without adding usage again and then returns the duplicate outcome', async () => {
    mockRecordCumulativeUsage
      .mockResolvedValueOnce({ billed: true, delta: 0.4662453, total: 0.4662453 })
      .mockResolvedValueOnce({ billed: false, delta: 0, total: 0.4662453 })
    mockCheckAndBillPayerOverageThreshold
      .mockRejectedValueOnce(new Error('Threshold settlement unavailable'))
      .mockResolvedValueOnce(undefined)
    const createRequest = () =>
      createMockRequest('POST', OLD_GO_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })

    const firstResponse = await POST(createRequest())
    const retryResponse = await POST(createRequest())

    expect(firstResponse.status).toBe(500)
    expect(retryResponse.status).toBe(409)
    await expect(retryResponse.json()).resolves.toMatchObject({
      code: 'DUPLICATE_BILLING_EVENT',
    })
    expect(mockRecordCumulativeUsage).toHaveBeenCalledTimes(2)
    expect(mockResolveLegacyV0BillingAttribution).toHaveBeenCalledTimes(2)
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledTimes(2)
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenNthCalledWith(
      2,
      {
        type: 'organization',
        id: 'org-1',
      },
      {
        onError: 'throw',
        expectedBillingPeriod: {
          start: new Date('2026-07-01T00:00:00.000Z'),
          end: new Date('2026-08-01T00:00:00.000Z'),
        },
      }
    )
  })

  it('returns a stable retryable 503 when modern threshold settlement fails', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
    mockCheckAndBillPayerOverageThreshold.mockRejectedValueOnce(
      new MockThresholdSettlementError('provider_failure')
    )

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          idempotencyKey: billingRequestId,
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': billingRequestId,
          'x-sim-billing-account-decision': 'serialized-account-decision',
        }
      )
    )

    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('1')
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'BILLING_SETTLEMENT_RETRYABLE',
      error: 'Billing settlement temporarily unavailable',
      retryable: true,
    })
  })

  it('retries modern settlement on a duplicate cumulative callback before returning 409', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
    mockRecordCumulativeUsage
      .mockResolvedValueOnce({ billed: true, delta: 0.5, total: 0.5 })
      .mockResolvedValueOnce({ billed: false, delta: 0, total: 0.5 })
    mockCheckAndBillPayerOverageThreshold
      .mockRejectedValueOnce(new MockThresholdSettlementError('required_state_missing'))
      .mockResolvedValueOnce({ status: 'no-op', reason: 'already-settled' })
    const createRequest = () =>
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          idempotencyKey: billingRequestId,
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': billingRequestId,
          'x-sim-billing-account-decision': 'serialized-account-decision',
        }
      )

    const firstResponse = await POST(createRequest())
    const retryResponse = await POST(createRequest())

    expect(firstResponse.status).toBe(503)
    expect(retryResponse.status).toBe(409)
    expect(mockRecordCumulativeUsage).toHaveBeenCalledTimes(2)
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledTimes(2)
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenNthCalledWith(
      2,
      { type: 'organization', id: 'account-org' },
      {
        onError: 'throw',
        expectedBillingPeriod: {
          start: new Date('2026-07-01T00:00:00.000Z'),
          end: new Date('2026-08-01T00:00:00.000Z'),
        },
      }
    )
  })

  it('preserves account-ledger ownership for the exact workspace-less old-Go callback', async () => {
    const res = await POST(
      createMockRequest('POST', OLD_GO_WORKSPACELESS_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
    )

    expect(res.status).toBe(200)
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordCumulativeUsage.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      workspaceId: undefined,
      eventKey: 'update-cost:random-old-go-direct-billing-id',
    })
    expect(mockRecordCumulativeUsage.mock.calls[0][0]).not.toHaveProperty('billingEntity')
    expect(mockCheckAndBillOverageThreshold).toHaveBeenCalledWith('user-1', undefined, {
      onError: 'throw',
    })
  })

  it('preserves account-ledger ownership for an opaque direct legacy workspace', async () => {
    mockResolveLegacyV0BillingAttribution.mockResolvedValueOnce(null)
    const res = await POST(
      createMockRequest('POST', OLD_GO_OPAQUE_WORKSPACE_UPDATE_COST_BODY, {
        'x-api-key': 'internal',
      })
    )

    expect(res.status).toBe(200)
    expect(mockRecordCumulativeUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordCumulativeUsage.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      workspaceId: undefined,
      eventKey: 'update-cost:random-old-go-direct-billing-id',
    })
    expect(mockRecordCumulativeUsage.mock.calls[0][0]).not.toHaveProperty('billingEntity')
    expect(mockCheckAndBillOverageThreshold).toHaveBeenCalledWith('user-1', undefined, {
      onError: 'throw',
    })
  })

  it('binds an attributed-v1 callback to the exact hosted actor and workspace snapshot', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: billingRequestId,
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'attribution-v1',
          'x-sim-billing-request-id': billingRequestId,
          'x-sim-billing-attribution': 'serialized-attribution',
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
        billingEntity: { type: 'organization', id: 'org-1' },
      })
    )
  })

  it('keeps attributed-v1 isolated from legacy callback-time resolution', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: billingRequestId,
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'attribution-v1',
          'x-sim-billing-request-id': billingRequestId,
          'x-sim-billing-attribution': 'serialized-attribution',
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockRequireBillingAttributionHeader).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockToBillingContext).toHaveBeenCalledWith(ATTRIBUTION)
  })

  it('fails closed when a hosted attributed-v1 envelope is missing', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: billingRequestId,
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'attribution-v1',
          'x-sim-billing-request-id': billingRequestId,
        }
      )
    )

    expect(res.status).toBe(400)
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })
})
