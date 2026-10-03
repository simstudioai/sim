import { readFileSync } from 'node:fs'
import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import { billingPlanMock, billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
import {
  billingUsageLogMock,
  billingUsageLogMockFns,
} from '@sim/testing/mocks/billing-usage-log.mock'
import {
  billingUsageMonitorMock,
  billingUsageMonitorMockFns,
} from '@sim/testing/mocks/billing-usage-monitor.mock'
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing/mocks/copilot-http.mock'
import { mothershipOtelMock } from '@sim/testing/mocks/mothership-otel.mock'
import { sleep } from '@sim/utils/helpers'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckAndBillOverageThreshold,
  mockCheckAndBillPayerOverageThreshold,
  MockThresholdSettlementError,
} = vi.hoisted(() => ({
  mockCheckAndBillOverageThreshold: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
  MockThresholdSettlementError: class extends Error {
    readonly code: string
    get retryable() {
      return this.code !== 'billing_period_elapsed'
    }

    constructor(code: string) {
      super('Billing settlement temporarily unavailable')
      this.name = 'ThresholdSettlementError'
      this.code = code
    }
  },
}))

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)

vi.mock('@/lib/mothership/request/otel', () => mothershipOtelMock)

vi.mock('@/lib/billing/core/usage-log', () => billingUsageLogMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

vi.mock('@/lib/billing/core/plan', () => billingPlanMock)

vi.mock('@/lib/billing/calculations/usage-monitor', () => billingUsageMonitorMock)

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: mockCheckAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold: mockCheckAndBillPayerOverageThreshold,
  ThresholdSettlementError: MockThresholdSettlementError,
}))

import { resetMidRunUsageCaches } from '@/lib/billing/core/mid-run-usage'
import { resetUsageGateCache } from '@/lib/billing/core/usage-gate-cache'
import {
  BillingCallbackBody,
  BillingCallbackHeaders,
  BillingProtocol,
  BillingProtocolHeaders,
} from '@/lib/mothership/generated/billing'
import {
  BILLING_PROTOCOL_HEADERS,
  COPILOT_BILLING_PROTOCOL,
} from '@/lib/mothership/generated/billing-protocol-v1'
import { POST } from '@/app/api/billing/update-cost/route'

const { mockCheckInternalApiKey } = copilotHttpMockFns
const { mockRecordCumulativeUsage } = billingUsageLogMockFns

const mockRequireAccountBillingDecisionHeader =
  billingAttributionMockFns.mockRequireAccountBillingDecisionHeader
const mockRequireBillingAttributionHeader =
  billingAttributionMockFns.mockRequireBillingCallbackAttribution
const mockResolveLegacyV0BillingAttribution =
  billingAttributionMockFns.mockResolveLegacyV0BillingAttribution
const mockToBillingContext = billingAttributionMockFns.mockToBillingContext
const mockCheckAttributedUsageLimits = billingAttributionMockFns.mockCheckAttributedUsageLimits
const mockRefreshAttributionPeriod = billingAttributionMockFns.mockRefreshAttributionPeriod

afterAll(resetEnvFlagsMock)

const ACCOUNT_BILLING_DECISION = {
  userId: 'user-1',
  billingEntity: { type: 'organization' as const, id: 'account-org' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
    source: 'reporting' as const,
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

const SELF_HOSTED_UPDATE_COST_BODY = {
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
  ...SELF_HOSTED_UPDATE_COST_BODY,
  idempotencyKey: 'explicit-legacy-billing-id',
} as const

const SELF_HOSTED_WORKSPACELESS_UPDATE_COST_BODY = {
  userId: 'user-1',
  cost: 0.5,
  model: 'gpt',
  inputTokens: 1,
  outputTokens: 2,
  source: 'copilot',
  idempotencyKey: 'random-old-go-direct-billing-id',
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
    setEnvFlags({ isBillingEnabled: true, isHosted: false })
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

  it('keeps the worker callback protocol aligned with the Go-produced wire constants', () => {
    expect(Object.values(BillingProtocol).sort()).toEqual(
      Object.values(COPILOT_BILLING_PROTOCOL).sort()
    )
    expect(BillingProtocolHeaders).toEqual(BILLING_PROTOCOL_HEADERS)
  })

  it.skipIf(!process.env.BILLING_WIRE_FIXTURE)(
    'accepts the actual worker HTTP callbacks through the Sim handler',
    async () => {
      const path = process.env.BILLING_WIRE_FIXTURE
      if (!path) throw new Error('Missing worker callback fixture')
      const receipts: { body: unknown; headers: Record<string, string> }[] = JSON.parse(
        readFileSync(path, 'utf8')
      )
      expect(receipts.length).toBeGreaterThan(5)
      setEnvFlags({ isBillingEnabled: true, isHosted: true })
      for (const receipt of receipts) {
        const body = BillingCallbackBody.parse(receipt.body)
        BillingCallbackHeaders.parse(receipt.headers)
        mockRequireBillingAttributionHeader.mockReturnValue({
          ...ATTRIBUTION,
          workspaceId: body.workspaceId,
        })
        const result = await POST(createMockRequest('POST', body, receipt.headers))
        expect(result.status, JSON.stringify(await result.clone().json())).toBe(200)
        expect(mockRecordCumulativeUsage).toHaveBeenLastCalledWith(
          expect.objectContaining({
            userId: body.userId,
            cost: body.cost,
            model: body.model,
            eventKey: `update-cost:${body.idempotencyKey}`,
            metadata: { inputTokens: body.inputTokens, outputTokens: body.outputTokens },
          })
        )
      }
    }
  )

  it('returns 401 for a billing-disabled request without valid internal auth', async () => {
    setEnvFlags({ isBillingEnabled: false })
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

  it('returns no-op success for markerless local self-hosted Go when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })

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

  it('rejects an idempotency key that could collide with a period row key', async () => {
    const res = await POST(
      createMockRequest(
        'POST',
        { ...SELF_HOSTED_UPDATE_COST_BODY, idempotencyKey: 'old-go-key@1' },
        { 'x-api-key': 'internal' }
      )
    )

    expect(res.status).toBe(400)
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

  it('bills the routed workspace payer for a markerless self-hosted callback', async () => {
    const res = await POST(
      createMockRequest('POST', SELF_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
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

  it('rejects markerless callbacks on hosted Sim', async () => {
    setEnvFlags({ isHosted: true })
    const res = await POST(
      createMockRequest('POST', SELF_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
    )

    expect(res.status).toBe(400)
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordCumulativeUsage).not.toHaveBeenCalled()
  })

  it('settles an organization charge from its immutable envelope with no workspace ID', async () => {
    const orgAttribution = { ...ATTRIBUTION, workspaceId: null }
    mockRequireBillingAttributionHeader.mockReturnValueOnce(orgAttribution)
    const id = '00000000-0000-4000-8000-000000000001'
    const response = await POST(
      createMockRequest(
        'POST',
        { ...SELF_HOSTED_WORKSPACELESS_UPDATE_COST_BODY, idempotencyKey: id },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'attribution-v1',
          'x-sim-billing-request-id': id,
          'x-sim-billing-attribution': 'serialized-org-attribution',
        }
      )
    )
    expect(response.status).toBe(200)
    expect(mockRecordCumulativeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: undefined,
        billingEntity: { type: 'organization', id: 'org-1' },
      })
    )
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
  })

  it('does not let markerless legacy traffic fall through to a modern attribution envelope', async () => {
    const res = await POST(
      createMockRequest('POST', SELF_HOSTED_UPDATE_COST_BODY, {
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
    setEnvFlags({ isHosted: true })
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
    setEnvFlags({ isHosted: true })
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
          source: 'reporting',
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
          source: 'reporting',
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

  it('preserves duplicate-compatible 409 semantics for markerless self-hosted callbacks', async () => {
    mockRecordCumulativeUsage.mockResolvedValue({ billed: false, delta: 0, total: 0.4662453 })
    const res = await POST(
      createMockRequest('POST', SELF_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })
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
      createMockRequest('POST', SELF_HOSTED_UPDATE_COST_BODY, { 'x-api-key': 'internal' })

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

  it.each(['legacy-v0', 'attribution-v1', 'direct-v1'])(
    'returns a distinct non-retryable conflict for an elapsed %s period and preserves usage attribution',
    async (protocol) => {
      const billingRequestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
      const direct = protocol === 'direct-v1'
      setEnvFlags({ isBillingEnabled: true, isHosted: true })
      mockCheckAndBillPayerOverageThreshold.mockRejectedValue(
        new MockThresholdSettlementError('billing_period_elapsed')
      )
      mockRecordCumulativeUsage
        .mockResolvedValueOnce({ billed: true, delta: 0.5, total: 0.5 })
        .mockResolvedValueOnce({ billed: false, delta: 0, total: 0.5 })

      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await POST(
          createMockRequest(
            'POST',
            {
              userId: 'user-1',
              cost: 0.5,
              model: 'claude-opus-4.8',
              source: 'copilot',
              idempotencyKey: billingRequestId,
              ...(direct ? {} : { workspaceId: 'ws-1' }),
            },
            {
              'x-api-key': 'internal',
              'x-sim-billing-protocol': protocol,
              ...(protocol === 'legacy-v0' ? {} : { 'x-sim-billing-request-id': billingRequestId }),
              ...(direct
                ? { 'x-sim-billing-account-decision': 'serialized-account-decision' }
                : { 'x-sim-billing-attribution': 'serialized-attribution' }),
            }
          )
        )
        expect(res.status).toBe(409)
        expect(res.headers.get('retry-after')).toBeNull()
        await expect(res.json()).resolves.toMatchObject({
          success: false,
          code: 'BILLING_PERIOD_ELAPSED',
          error: 'Billing period has elapsed; reconciliation required',
          retryable: false,
        })
      }
      expect(mockRecordCumulativeUsage).toHaveBeenCalledTimes(2)
      expect(mockRecordCumulativeUsage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          eventKey: `update-cost:${billingRequestId}`,
          billingPeriod: {
            start: new Date('2026-07-01T00:00:00.000Z'),
            end: new Date('2026-08-01T00:00:00.000Z'),
            ...(direct ? { source: 'reporting' } : {}),
          },
        })
      )
    }
  )

  it.each([
    ['23503', 'usage_log_user_id_user_id_fk', false, 409],
    ['23503', 'usage_log_workspace_id_workspace_id_fk', false, 500],
    ['40001', 'usage_log_user_id_user_id_fk', false, 500],
    ['23503', 'usage_log_user_id_user_id_fk', true, 500],
  ])(
    'classifies the exact missing-user constraint safely (%s, %s, markerless=%s)',
    async (code, constraint, markerless, status) => {
      mockRecordCumulativeUsage.mockRejectedValueOnce(
        new Error('Insert failed', {
          cause: { code, constraint_name: constraint },
        })
      )
      const res = await POST(
        createMockRequest('POST', SELF_HOSTED_UPDATE_COST_BODY, {
          'x-api-key': 'internal',
          ...(markerless
            ? {}
            : {
                'x-sim-billing-protocol': 'legacy-v0',
                'x-sim-billing-attribution': 'serialized-attribution',
              }),
        })
      )
      expect(res.status).toBe(status)
      expect(mockCheckAndBillPayerOverageThreshold).not.toHaveBeenCalled()
      expect(mockCheckAndBillOverageThreshold).not.toHaveBeenCalled()
      if (status === 409) {
        await expect(res.json()).resolves.toMatchObject({
          code: 'BILLING_USER_NOT_FOUND',
          retryable: false,
        })
      }
    }
  )

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
          source: 'reporting',
        },
      }
    )
  })

  it('preserves account-ledger ownership for a workspace-less self-hosted callback', async () => {
    const res = await POST(
      createMockRequest('POST', SELF_HOSTED_WORKSPACELESS_UPDATE_COST_BODY, {
        'x-api-key': 'internal',
      })
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

describe('POST /api/billing/update-cost — mid-run usage gate', () => {
  let callbackSequence = 0
  /** A Stripe-period payer admitted in a period that has since ended. */
  const STRIPE_ATTRIBUTION = {
    ...ATTRIBUTION,
    billingPeriod: { ...ATTRIBUTION.billingPeriod, source: 'stripe' as const },
  }
  const CURRENT_ATTRIBUTION = {
    ...ATTRIBUTION,
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2099-01-01T00:00:00.000Z',
      source: 'stripe' as const,
    },
  }

  function attributedCallback() {
    callbackSequence += 1
    const billingRequestId = `0190c03f-9f7d-4b79-8b58-${String(callbackSequence).padStart(12, '0')}`
    return createMockRequest(
      'POST',
      {
        userId: 'user-1',
        cost: 0.5 * callbackSequence,
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
  }

  beforeEach(() => {
    resetUsageGateCache()
    resetMidRunUsageCaches()
    setEnvFlags({ isBillingEnabled: true, isHosted: true })
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockRecordCumulativeUsage.mockResolvedValue({ billed: true, delta: 0.5, total: 0.5 })
    mockCheckAndBillPayerOverageThreshold.mockResolvedValue(undefined)
    mockRequireBillingAttributionHeader.mockReturnValue(CURRENT_ATTRIBUTION)
    mockRefreshAttributionPeriod.mockImplementation(async (attribution: unknown) => attribution)
    mockToBillingContext.mockReturnValue({
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    })
  })

  it('tells the worker when the run payer has crossed its usage limit', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })

    const res = await POST(attributedCallback())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      usageExceeded: true,
      usageUpgrade: {
        reason: 'usage_limit',
        action: 'upgrade_plan',
        message: expect.stringContaining('usage limit'),
      },
    })
  })

  it('offers a paid organization payer the increase-limit card', async () => {
    mockRequireBillingAttributionHeader.mockReturnValue({
      ...CURRENT_ATTRIBUTION,
      payerSubscription: { id: 'sub-1', plan: 'team', status: 'active', seats: 4 },
    })
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })

    const res = await POST(attributedCallback())

    const body = await res.json()
    expect(body.usageUpgrade).toMatchObject({
      action: 'increase_limit',
      message: expect.stringContaining('organization'),
    })
  })

  it('serves a cached admission to every step and re-reads a refusal', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })

    expect((await (await POST(attributedCallback())).json()).usageExceeded).toBe(false)
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })
    for (let step = 0; step < 4; step++) {
      const body = await (await POST(attributedCallback())).json()
      expect(body.usageExceeded).toBe(false)
      expect(body).not.toHaveProperty('usageUpgrade')
    }

    resetUsageGateCache()
    expect((await (await POST(attributedCallback())).json()).usageExceeded).toBe(true)
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    expect((await (await POST(attributedCallback())).json()).usageExceeded).toBe(false)
  })

  it('answers a duplicate retry with the verdict its lost first answer carried', async () => {
    mockRecordCumulativeUsage.mockResolvedValue({ billed: false, delta: 0, total: 0.5 })
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })

    const res = await POST(attributedCallback())

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      code: 'DUPLICATE_BILLING_EVENT',
      usageExceeded: true,
      usageUpgrade: { action: 'upgrade_plan' },
    })
  })

  describe('a direct-v1 run', () => {
    function directCallback() {
      callbackSequence += 1
      const billingRequestId = `0190c03f-9f7d-4b79-8b58-${String(callbackSequence).padStart(12, '0')}`
      return createMockRequest(
        'POST',
        {
          userId: 'user-1',
          cost: 0.5 * callbackSequence,
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
    }

    beforeEach(() => {
      mockRequireAccountBillingDecisionHeader.mockReturnValue(ACCOUNT_BILLING_DECISION)
      billingCoreMockFns.mockGetOrganizationSubscription.mockResolvedValue(null)
      billingPlanMockFns.mockGetHighestPrioritySubscription.mockResolvedValue(null)
      billingAttributionMockFns.mockCheckAccountBillingBlocks.mockResolvedValue({ blocked: false })
      billingUsageMonitorMockFns.mockCheckUsageStatus.mockResolvedValue({
        isExceeded: true,
        currentUsage: 12,
        limit: 10,
      })
    })

    it('tells the worker when its admitted payer has crossed its usage limit', async () => {
      const body = await (await POST(directCallback())).json()

      expect(body).toMatchObject({
        usageExceeded: true,
        usageUpgrade: { reason: 'usage_limit' },
      })
    })

    it("offers the card for its admitted payer's plan, not the actor's current one", async () => {
      billingCoreMockFns.mockGetOrganizationSubscription.mockResolvedValue({
        id: 'sub-account-org',
        referenceId: 'account-org',
        plan: 'team',
        status: 'active',
        seats: 4,
      })
      billingPlanMockFns.mockGetHighestPrioritySubscription.mockResolvedValue({
        id: 'sub-personal',
        referenceId: 'user-1',
        plan: 'pro',
        status: 'active',
      })

      const body = await (await POST(directCallback())).json()

      expect(body.usageUpgrade).toMatchObject({
        action: 'increase_limit',
        message: expect.stringContaining("organization's usage limit"),
      })
    })

    it('never pauses a blocked payer with the usage card', async () => {
      billingAttributionMockFns.mockCheckAccountBillingBlocks.mockResolvedValue({
        blocked: true,
        scope: 'payer',
      })

      const body = await (await POST(directCallback())).json()

      expect(body.usageExceeded).toBe(false)
    })
  })

  describe('a run that outlives its billing period', () => {
    const PAYER_SUBSCRIPTION = {
      id: 'sub-1',
      plan: 'team',
      status: 'active',
      seats: 4,
    }
    const ADMITTED_PERIOD = {
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-08-01T00:00:00.000Z'),
    }
    const CURRENT_PERIOD = {
      start: new Date('2026-08-01T00:00:00.000Z'),
      end: new Date('2026-09-01T00:00:00.000Z'),
    }

    function admittedWithSource(source: 'stripe' | 'reporting' | 'default') {
      mockToBillingContext.mockReturnValue({
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: { ...ADMITTED_PERIOD, source },
      })
    }

    /** Threshold settlement for a payer whose charges belong to `period` refuses any other. */
    function settlesOnlyAgainst(period: typeof ADMITTED_PERIOD) {
      mockCheckAndBillPayerOverageThreshold.mockImplementation(
        async (_payer: unknown, options: { expectedBillingPeriod: typeof ADMITTED_PERIOD }) => {
          if (options.expectedBillingPeriod.start.getTime() !== period.start.getTime()) {
            throw new Error('Settled against a period the charge did not land in')
          }
        }
      )
    }

    beforeEach(() => {
      mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
      mockRequireBillingAttributionHeader.mockReturnValue({
        ...CURRENT_ATTRIBUTION,
        payerSubscription: PAYER_SUBSCRIPTION,
      })
      // As the ledger behaves: a charge given the payer's subscription lands in its current
      // period, any other stays in the period it was admitted in.
      mockRecordCumulativeUsage.mockImplementation(
        async (params: {
          payerSubscriptionId?: string
          billingPeriod: typeof ADMITTED_PERIOD
        }) => ({
          billed: true,
          delta: 0.5,
          total: 1.5,
          billingPeriod: params.payerSubscriptionId
            ? CURRENT_PERIOD
            : { start: params.billingPeriod.start, end: params.billingPeriod.end },
        })
      )
    })

    it("records a Stripe payer's charge in its current period and settles it there", async () => {
      admittedWithSource('stripe')
      settlesOnlyAgainst(CURRENT_PERIOD)

      expect((await POST(attributedCallback())).status).toBe(200)
    })

    it('leaves a period that closed under a recorded charge to the cycle close', async () => {
      admittedWithSource('stripe')
      mockRecordCumulativeUsage.mockResolvedValue({
        billed: true,
        delta: 0.5,
        total: 1.5,
        billingPeriod: ADMITTED_PERIOD,
      })
      mockCheckAndBillPayerOverageThreshold.mockRejectedValue(
        new MockThresholdSettlementError('billing_period_elapsed')
      )

      const res = await POST(attributedCallback())

      expect(res.status).toBe(200)
    })

    it.each(['reporting', 'default'] as const)(
      'keeps a payer with a %s period on the period it was admitted in',
      async (source) => {
        admittedWithSource(source)
        settlesOnlyAgainst(ADMITTED_PERIOD)

        expect((await POST(attributedCallback())).status).toBe(200)
      }
    )
  })

  it.each([
    ['an unreadable ledger', { isExceeded: true, reason: 'usage_unavailable' }],
    ['a blocked account', { isExceeded: true, reason: 'billing_blocked', scope: 'payer' }],
  ])('does not pause a run for %s', async (_case, verdict) => {
    mockCheckAttributedUsageLimits.mockResolvedValue(verdict)

    const body = await (await POST(attributedCallback())).json()

    expect(body.usageExceeded).toBe(false)
    expect(body).not.toHaveProperty('usageUpgrade')
  })

  it('tells a member over the cap their organization set who can raise it', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'member' })

    const body = await (await POST(attributedCallback())).json()

    expect(body).toMatchObject({
      usageUpgrade: { message: expect.stringMatching(/limit your organization set for you/) },
    })
  })

  /** The gate refuses only when it judges the payer's current period. */
  function refuseOnlyCurrentPeriod() {
    mockCheckAttributedUsageLimits.mockImplementation(
      async (attribution: typeof CURRENT_ATTRIBUTION) => ({
        isExceeded: attribution.billingPeriod.end === CURRENT_ATTRIBUTION.billingPeriod.end,
        scope: 'payer',
      })
    )
  }

  it('judges a run past its admitted period against the payer current period', async () => {
    mockRequireBillingAttributionHeader.mockReturnValue(STRIPE_ATTRIBUTION)
    mockRefreshAttributionPeriod.mockResolvedValue(CURRENT_ATTRIBUTION)
    refuseOnlyCurrentPeriod()

    const body = await (await POST(attributedCallback())).json()

    expect(body.usageExceeded).toBe(true)
  })

  it('judges a run whose payer period moved early against the moved period', async () => {
    const moved = {
      ...CURRENT_ATTRIBUTION,
      billingPeriod: { start: '2026-07-15T00:00:00.000Z', end: '2099-02-01T00:00:00.000Z' },
    }
    mockRefreshAttributionPeriod.mockResolvedValue(moved)
    mockCheckAttributedUsageLimits.mockImplementation(async (attribution: typeof moved) => ({
      isExceeded: attribution.billingPeriod.start === moved.billingPeriod.start,
      scope: 'payer',
    }))

    const body = await (await POST(attributedCallback())).json()

    expect(body.usageExceeded).toBe(true)
  })

  it('judges a reporting-window run against its admitted window after that window ends', async () => {
    const admitted = {
      ...ATTRIBUTION,
      billingPeriod: { ...ATTRIBUTION.billingPeriod, source: 'reporting' as const },
    }
    mockRequireBillingAttributionHeader.mockReturnValue(admitted)
    mockRefreshAttributionPeriod.mockResolvedValue({
      ...CURRENT_ATTRIBUTION,
      billingPeriod: { ...CURRENT_ATTRIBUTION.billingPeriod, source: 'reporting' as const },
    })
    mockCheckAttributedUsageLimits.mockImplementation(async (attribution: typeof admitted) => ({
      isExceeded: attribution.billingPeriod.end === admitted.billingPeriod.end,
      scope: 'payer',
    }))

    const body = await (await POST(attributedCallback())).json()

    expect(body.usageExceeded).toBe(true)
  })

  it('keeps a run going when its current period cannot be read', async () => {
    mockRequireBillingAttributionHeader.mockReturnValue(STRIPE_ATTRIBUTION)
    mockRefreshAttributionPeriod.mockRejectedValue(new Error('subscription read timed out'))
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })

    const body = await (await POST(attributedCallback())).json()

    expect(body.usageExceeded).toBe(false)
  })

  it('answers not exceeded when the standing read outlasts the callback budget', async () => {
    mockCheckAttributedUsageLimits.mockImplementation(async () => {
      await sleep(1500)
      return { isExceeded: true, scope: 'payer' }
    })
    const startedAt = Date.now()

    const res = await POST(attributedCallback())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true, usageExceeded: false })
    expect(Date.now() - startedAt).toBeLessThan(1400)
  })

  it('does not pause a run on a verdict read across the end of its period', async () => {
    const straddling = {
      ...CURRENT_ATTRIBUTION,
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: new Date(Date.now() + 40).toISOString(),
        source: 'stripe' as const,
      },
    }
    mockRefreshAttributionPeriod.mockResolvedValue(straddling)
    mockCheckAttributedUsageLimits.mockImplementation(async () => {
      await sleep(80)
      return { isExceeded: true, scope: 'payer' }
    })

    const body = await (await POST(attributedCallback())).json()

    expect(body.usageExceeded).toBe(false)
  })

  it('reloads a cached current period once it has ended', async () => {
    const ending = {
      ...CURRENT_ATTRIBUTION,
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: new Date(Date.now() + 50).toISOString(),
      },
    }
    mockRefreshAttributionPeriod
      .mockResolvedValueOnce(ending)
      .mockResolvedValue(CURRENT_ATTRIBUTION)
    refuseOnlyCurrentPeriod()
    await POST(attributedCallback())
    await sleep(100)

    const body = await (await POST(attributedCallback())).json()

    expect(body.usageExceeded).toBe(true)
  })

  it('keeps a recorded charge successful when the gate read fails', async () => {
    mockCheckAttributedUsageLimits.mockRejectedValue(new Error('ledger read timed out'))

    const res = await POST(attributedCallback())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true, usageExceeded: false })
  })

  it('reports no exceeded usage when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false, isHosted: true })

    const res = await POST(attributedCallback())

    await expect(res.json()).resolves.toMatchObject({ usageExceeded: false })
  })
})
