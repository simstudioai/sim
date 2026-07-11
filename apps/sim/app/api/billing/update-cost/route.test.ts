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
  mockGetCachedAccountBillingDecision,
  mockGetCachedBillingAttribution,
  mockToBillingContext,
  MockCumulativeUsageContextMismatchError,
  billingState,
} = vi.hoisted(() => ({
  mockCheckInternalApiKey: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockRecordCumulativeUsage: vi.fn(),
  mockCheckAndBillOverageThreshold: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
  mockGetCachedAccountBillingDecision: vi.fn(),
  mockGetCachedBillingAttribution: vi.fn(),
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
  BILLING_REQUEST_ID_HEADER: 'x-sim-billing-request-id',
  COPILOT_BILLING_PROTOCOL: {
    attributed: 'attribution-v1',
    direct: 'direct-v1',
    legacy: 'legacy-v0',
  },
  COPILOT_BILLING_PROTOCOL_HEADER: 'x-sim-billing-protocol',
  toBillingContext: mockToBillingContext,
}))

vi.mock('@/lib/billing/core/billing-attribution-cache', () => ({
  getCachedAccountBillingDecision: mockGetCachedAccountBillingDecision,
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
    mockGetCachedAccountBillingDecision.mockResolvedValue(ACCOUNT_BILLING_DECISION)
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
    })
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

  it('returns the no-op success for a valid billing-disabled request', async () => {
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
    expect(mockCheckAndBillOverageThreshold).toHaveBeenCalledWith('user-1')
    expect(mockCheckAndBillPayerOverageThreshold).not.toHaveBeenCalled()
  })

  it('rejects a direct-v1 callback without its cached account decision', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
    mockGetCachedAccountBillingDecision.mockResolvedValueOnce(undefined)

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
    expect(res.status).toBe(500)
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('records cumulative cost via monotonic top-up when an idempotency key is present', async () => {
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
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith({
      type: 'organization',
      id: 'org-1',
    })
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
  })

  it('bills direct-v1 to the cached hosted account and ignores the local workspace', async () => {
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
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockGetCachedAccountBillingDecision).toHaveBeenCalledWith(billingRequestId)
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
    expect(mockCheckAndBillPayerOverageThreshold).toHaveBeenCalledWith({
      type: 'organization',
      id: 'account-org',
    })
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
  })

  it('rejects a direct-v1 callback that changes the cached hosted account', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
    mockGetCachedAccountBillingDecision.mockResolvedValueOnce({
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
    'returns a deterministic conflict for a cached %s mismatch',
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

      expect(res.status).toBe(409)
      await expect(res.json()).resolves.toMatchObject({
        success: false,
        code: 'BILLING_CONTEXT_MISMATCH',
        error: 'Idempotency key is already bound to a different billing context',
      })
      expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
    }
  )

  it('surfaces a cumulative ledger context mismatch as a deterministic conflict', async () => {
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

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'BILLING_CONTEXT_MISMATCH',
      error: 'Idempotency key is already bound to a different billing context',
    })
    expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
    expect(mockCheckAndBillPayerOverageThreshold).not.toHaveBeenCalled()
  })

  it('returns 409 and skips overage when the cumulative is not higher (duplicate flush)', async () => {
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
    expect(mockCheckAndBillPayerOverageThreshold).not.toHaveBeenCalled()
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
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockGetCachedBillingAttribution).toHaveBeenCalledWith(billingRequestId)
    expect(mockGetCachedAccountBillingDecision).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
        billingEntity: { type: 'organization', id: 'org-1' },
      })
    )
  })

  it('fails closed when a hosted attributed-v1 snapshot is missing from the cache', async () => {
    const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
    mockGetCachedBillingAttribution.mockResolvedValue(undefined)

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

    expect(res.status).toBe(500)
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })
})
