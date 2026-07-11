/**
 * @vitest-environment node
 */
import { createMockRequest, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckInternalApiKey,
  mockRecordUsage,
  mockRecordCumulativeUsage,
  mockCheckAndBillOverageThreshold,
  mockCheckAndBillPayerOverageThreshold,
  mockGetCachedBillingAttribution,
  mockRequireAccountBillingDecisionHeader,
  mockRequireBillingAttributionHeader,
  mockToBillingContext,
  MockCumulativeUsageContextMismatchError,
  billingState,
} = vi.hoisted(() => ({
  mockCheckInternalApiKey: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockRecordCumulativeUsage: vi.fn(),
  mockCheckAndBillOverageThreshold: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
  mockGetCachedBillingAttribution: vi.fn(),
  mockRequireAccountBillingDecisionHeader: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockToBillingContext: vi.fn(),
  MockCumulativeUsageContextMismatchError: class extends Error {},
  billingState: {
    isBillingEnabled: true,
    isCopilotBillingAttributionV1Enabled: false,
  },
}))

vi.mock('@sim/db', () => dbChainMock)

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
  recordUsage: mockRecordUsage,
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
  toBillingContext: mockToBillingContext,
}))

vi.mock('@/lib/billing/core/billing-attribution-cache', () => ({
  getCachedBillingAttribution: mockGetCachedBillingAttribution,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: mockCheckAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold: mockCheckAndBillPayerOverageThreshold,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return billingState.isBillingEnabled
  },
  get isCopilotBillingAttributionV1Enabled() {
    return billingState.isCopilotBillingAttributionV1Enabled
  },
}))

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

describe('POST /api/billing/update-cost — workspaceId attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    billingState.isBillingEnabled = true
    billingState.isCopilotBillingAttributionV1Enabled = false
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockRecordUsage.mockResolvedValue(undefined)
    mockRecordCumulativeUsage.mockResolvedValue({ billed: true, delta: 0.5, total: 0.5 })
    mockCheckAndBillOverageThreshold.mockResolvedValue(undefined)
    mockCheckAndBillPayerOverageThreshold.mockResolvedValue(undefined)
    mockGetCachedBillingAttribution.mockResolvedValue(ATTRIBUTION)
    mockRequireBillingAttributionHeader.mockReturnValue(ATTRIBUTION)
    mockRequireAccountBillingDecisionHeader.mockReturnValue(ACCOUNT_BILLING_DECISION)
    mockToBillingContext.mockReturnValue({
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    })
    dbChainMockFns.limit.mockResolvedValue([{ id: 'ws-1' }])
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
    expect(mockRecordUsage).not.toHaveBeenCalled()
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
    expect(mockRecordUsage).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('accepts markerless legacy callbacks only during the Sim-first rollout stage', async () => {
    mockGetCachedBillingAttribution.mockResolvedValueOnce(undefined)

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'gpt',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: 'legacy-message-billing',
        },
        { 'x-api-key': 'internal' }
      )
    )

    expect(res.status).toBe(200)
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
      })
    )
    expect(mockRecordCumulativeUsage.mock.calls[0][0]).not.toHaveProperty('billingEntity')
  })

  it('rejects markerless callbacks after the attribution rollout flag is enabled', async () => {
    billingState.isCopilotBillingAttributionV1Enabled = true

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'gpt',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: 'markerless-modern',
        },
        { 'x-api-key': 'internal' }
      )
    )

    expect(res.status).toBe(400)
    expect(mockGetCachedBillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('allows explicitly labeled legacy callbacks to drain after strict attribution rollout', async () => {
    billingState.isCopilotBillingAttributionV1Enabled = true
    mockGetCachedBillingAttribution.mockResolvedValueOnce(undefined)

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'gpt',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: 'legacy-title-billing',
        },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'legacy-v0',
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockRecordCumulativeUsage).toHaveBeenCalledTimes(1)
    expect(mockCheckAndBillOverageThreshold).toHaveBeenCalledWith('user-1', undefined, {
      onError: 'throw',
    })
    expect(mockCheckAndBillPayerOverageThreshold).not.toHaveBeenCalled()
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

  it('bills old markerless Go from its legacy Redis attribution alias', async () => {
    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.4662453,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: 'msg-1-billing',
          inputTokens: 461371,
          outputTokens: 1686,
        },
        { 'x-api-key': 'internal' }
      )
    )
    expect(res.status).toBe(200)
    expect(mockGetCachedBillingAttribution).toHaveBeenCalledWith('msg-1-billing')
    expect(mockRecordUsage).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordCumulativeUsage.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      workspaceId: 'ws-1',
      source: 'workspace-chat',
      model: 'claude-opus-4.8',
      cost: 0.4662453,
      eventKey: 'update-cost:msg-1-billing',
      billingEntity: { type: 'organization', id: 'org-1' },
    })
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith(
      {
        type: 'organization',
        id: 'org-1',
      },
      { onError: 'throw' }
    )
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
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
    expect(mockGetCachedBillingAttribution).not.toHaveBeenCalled()
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
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
      { onError: 'throw' }
    )
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
  })

  it('bills direct-v1 when Redis is unavailable', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
    mockGetCachedBillingAttribution.mockRejectedValue(new Error('Redis unavailable'))

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
    expect(mockGetCachedBillingAttribution).not.toHaveBeenCalled()
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

  it('reuses the pre-hosted-work snapshot for cumulative cost flushes', async () => {
    mockGetCachedBillingAttribution.mockResolvedValue({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
      billedAccountUserId: 'owner-1',
      organizationId: 'org-original',
      billingEntity: { type: 'organization', id: 'org-original' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    })
    mockToBillingContext.mockReturnValue({
      billingEntity: { type: 'organization', id: 'org-original' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    })

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          idempotencyKey: 'msg-1-billing',
        },
        { 'x-api-key': 'internal' }
      )
    )

    expect(res.status).toBe(200)
    expect(mockGetCachedBillingAttribution).toHaveBeenCalledWith('msg-1-billing')
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        billingEntity: { type: 'organization', id: 'org-original' },
      })
    )
  })

  it.each([
    ['actor', { actorUserId: 'different-user' }, 'ws-1'],
    ['workspace', {}, 'different-workspace'],
  ])(
    'returns a retryable failure for a markerless cached %s mismatch',
    async (_, override, requestWorkspaceId) => {
      mockGetCachedBillingAttribution.mockResolvedValue({
        actorUserId: 'user-1',
        workspaceId: 'ws-1',
        billedAccountUserId: 'owner-1',
        organizationId: 'org-1',
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-08-01T00:00:00.000Z',
        },
        payerSubscription: null,
        ...override,
      })

      const res = await POST(
        createMockRequest(
          'POST',
          {
            userId: 'user-1',
            cost: 0.5,
            model: 'claude-opus-4.8',
            source: 'workspace-chat',
            workspaceId: requestWorkspaceId,
            idempotencyKey: 'msg-1-billing',
          },
          { 'x-api-key': 'internal' }
        )
      )

      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toMatchObject({
        success: false,
        error: 'Internal server error',
      })
      expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
    }
  )

  it('does not expose context-mismatch 409 to markerless old Go', async () => {
    mockRecordCumulativeUsage.mockRejectedValue(
      new MockCumulativeUsageContextMismatchError('different billing context')
    )

    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: 'msg-1-billing',
        },
        { 'x-api-key': 'internal' }
      )
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
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.4662453,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: 'msg-1-billing',
        },
        { 'x-api-key': 'internal' }
      )
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
      { onError: 'throw' }
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
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.4662453,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          workspaceId: 'ws-1',
          idempotencyKey: 'msg-1-billing',
        },
        { 'x-api-key': 'internal' }
      )

    const firstResponse = await POST(createRequest())
    const retryResponse = await POST(createRequest())

    expect(firstResponse.status).toBe(500)
    expect(retryResponse.status).toBe(409)
    await expect(retryResponse.json()).resolves.toMatchObject({
      code: 'DUPLICATE_BILLING_EVENT',
    })
    expect(mockRecordCumulativeUsage).toHaveBeenCalledTimes(2)
    expect(mockRecordUsage).not.toHaveBeenCalled()
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledTimes(2)
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenNthCalledWith(
      2,
      {
        type: 'organization',
        id: 'org-1',
      },
      { onError: 'throw' }
    )
  })

  it('records unattributed when workspaceId is omitted (headless client)', async () => {
    const res = await POST(
      createMockRequest(
        'POST',
        { userId: 'user-1', cost: 0.5, model: 'gpt', source: 'copilot' },
        { 'x-api-key': 'internal' }
      )
    )
    expect(res.status).toBe(200)
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
    expect(mockRecordUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordUsage.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      workspaceId: undefined,
    })
  })

  it('records unattributed when the workspace does not exist in this deployment (self-hosted client)', async () => {
    mockGetCachedBillingAttribution.mockResolvedValue(undefined)
    dbChainMockFns.limit.mockResolvedValue([])
    const res = await POST(
      createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5,
          model: 'claude-opus-4.8',
          source: 'workspace-chat',
          workspaceId: 'self-hosted-ws',
          idempotencyKey: 'msg-1-billing',
        },
        { 'x-api-key': 'internal' }
      )
    )
    expect(res.status).toBe(200)
    expect(mockRecordCumulativeUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordCumulativeUsage.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      workspaceId: undefined,
      eventKey: 'update-cost:msg-1-billing',
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
    expect(mockGetCachedBillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
        billingEntity: { type: 'organization', id: 'org-1' },
      })
    )
  })

  it('bills attributed-v1 from its envelope when Redis is unavailable', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
    mockGetCachedBillingAttribution.mockRejectedValue(new Error('Redis unavailable'))

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
    expect(mockGetCachedBillingAttribution).not.toHaveBeenCalled()
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
