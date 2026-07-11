/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbLimit,
  mockCheckInternalApiKey,
  mockCheckAttributedUsageLimits,
  mockCheckOrgMemberUsageLimit,
  mockCheckServerSideUsageLimits,
  mockDeriveBillingContext,
  mockGetHighestPrioritySubscription,
  mockRequireBillingAttributionHeader,
  mockRequireBillingRequestIdHeader,
  mockResolveBillingAttribution,
  mockSerializeAccountBillingDecisionHeader,
  mockSerializeBillingAttributionHeader,
  mockGetUserEntityPermissions,
  mockGetWorkspaceBillingSettings,
  mockFlags,
} = vi.hoisted(() => ({
  mockDbLimit: vi.fn(),
  mockCheckInternalApiKey: vi.fn(),
  mockCheckAttributedUsageLimits: vi.fn(),
  mockCheckOrgMemberUsageLimit: vi.fn(),
  mockCheckServerSideUsageLimits: vi.fn(),
  mockDeriveBillingContext: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockRequireBillingRequestIdHeader: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockSerializeAccountBillingDecisionHeader: vi.fn(),
  mockSerializeBillingAttributionHeader: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockFlags: {
    isCopilotBillingAttributionV1Enabled: false,
    isHosted: true,
  },
}))

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

const ACCOUNT_SUBSCRIPTION = { id: 'account-subscription' }
const ACCOUNT_BILLING_DECISION = {
  userId: 'user-1',
  billingEntity: { type: 'organization' as const, id: 'account-org' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
}

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockDbLimit }) }) }),
  },
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  BILLING_ACCOUNT_DECISION_HEADER: 'x-sim-billing-account-decision',
  BILLING_ATTRIBUTION_HEADER: 'x-sim-billing-attribution',
  BILLING_REQUEST_ID_HEADER: 'x-sim-billing-request-id',
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  COPILOT_BILLING_PROTOCOL: {
    attributed: 'attribution-v1',
    direct: 'direct-v1',
    legacy: 'legacy-v0',
  },
  COPILOT_BILLING_PROTOCOL_HEADER: 'x-sim-billing-protocol',
  requireBillingAttributionHeader: mockRequireBillingAttributionHeader,
  requireBillingRequestIdHeader: mockRequireBillingRequestIdHeader,
  resolveBillingAttribution: mockResolveBillingAttribution,
  serializeAccountBillingDecisionHeader: mockSerializeAccountBillingDecisionHeader,
  serializeBillingAttributionHeader: mockSerializeBillingAttributionHeader,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkOrgMemberUsageLimit: mockCheckOrgMemberUsageLimit,
  checkServerSideUsageLimits: mockCheckServerSideUsageLimits,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  deriveBillingContext: mockDeriveBillingContext,
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

vi.mock('@/lib/core/config/env-flags', () => ({
  get isCopilotBillingAttributionV1Enabled() {
    return mockFlags.isCopilotBillingAttributionV1Enabled
  },
  get isHosted() {
    return mockFlags.isHosted
  },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBillingSettings: mockGetWorkspaceBillingSettings,
}))

import { POST } from '@/app/api/copilot/api-keys/validate/route'

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return createMockRequest('POST', body, { 'x-api-key': 'internal', ...headers })
}

describe('POST /api/copilot/api-keys/validate billing protocols', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isCopilotBillingAttributionV1Enabled = false
    mockFlags.isHosted = true
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockDbLimit.mockResolvedValue([{ id: 'user-1' }])
    mockResolveBillingAttribution.mockResolvedValue(ATTRIBUTION)
    mockSerializeBillingAttributionHeader.mockReturnValue('serialized-attribution')
    mockSerializeAccountBillingDecisionHeader.mockReturnValue('serialized-account-decision')
    mockRequireBillingRequestIdHeader.mockImplementation((headers: Headers) => {
      const value = headers.get('x-sim-billing-request-id')
      if (!value) throw new Error('missing billing request ID')
      return value
    })
    mockRequireBillingAttributionHeader.mockImplementation((headers: Headers) => {
      if (!headers.get('x-sim-billing-attribution')) {
        throw new Error('missing billing attribution')
      }
      return ATTRIBUTION
    })
    mockGetHighestPrioritySubscription.mockResolvedValue(ACCOUNT_SUBSCRIPTION)
    mockDeriveBillingContext.mockReturnValue({
      billingEntity: ACCOUNT_BILLING_DECISION.billingEntity,
      billingPeriod: {
        start: new Date(ACCOUNT_BILLING_DECISION.billingPeriod.start),
        end: new Date(ACCOUNT_BILLING_DECISION.billingPeriod.end),
      },
    })
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceBillingSettings.mockResolvedValue({
      billedAccountUserId: 'owner-1',
      allowPersonalApiKeys: true,
    })
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 0, limit: 100 },
    })
    mockCheckServerSideUsageLimits.mockResolvedValue({
      isExceeded: false,
      currentUsage: 0,
      limit: 100,
    })
    mockCheckOrgMemberUsageLimit.mockResolvedValue({
      isExceeded: false,
      currentUsage: 0,
      limit: null,
    })
  })

  it('preserves legacy account admission when the hosted account is exceeded', async () => {
    mockCheckServerSideUsageLimits.mockResolvedValue({
      isExceeded: true,
      currentUsage: 200,
      limit: 100,
    })
    const res = await POST(request({ userId: 'user-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(402)
  })

  it('preserves the legacy hosted per-member gate', async () => {
    mockCheckOrgMemberUsageLimit.mockResolvedValue({
      isExceeded: true,
      currentUsage: 5,
      limit: 4,
    })
    const res = await POST(request({ userId: 'user-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(402)
  })

  it('returns 200 when under both limits', async () => {
    const res = await POST(request({ userId: 'user-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(200)
  })

  it('keeps old markerless Go admission working when workspaceId is omitted', async () => {
    const res = await POST(request({ userId: 'user-1' }))
    expect(res.status).toBe(200)
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith('user-1')
    expect(mockCheckOrgMemberUsageLimit).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
  })

  it('preserves markerless legacy account and member admission', async () => {
    const res = await POST(request({ userId: 'user-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-sim-billing-attribution')).toBeNull()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith('user-1')
    expect(mockCheckOrgMemberUsageLimit).toHaveBeenCalledWith('user-1', 'ws-1')
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
  })

  it('keeps old markerless Go admission compatible with a foreign workspace ID', async () => {
    const res = await POST(
      request({ userId: 'user-1', workspaceId: 'local-self-hosted-workspace' })
    )

    expect(res.status).toBe(200)
    expect(mockCheckOrgMemberUsageLimit).toHaveBeenCalledWith(
      'user-1',
      'local-self-hosted-workspace'
    )
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
  })

  it('rejects markerless callbacks after the attributed-v1 cutover', async () => {
    mockFlags.isCopilotBillingAttributionV1Enabled = true

    const res = await POST(request({ userId: 'user-1', workspaceId: 'ws-1' }))

    expect(res.status).toBe(400)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
  })

  it('allows explicitly labeled legacy requests to drain after cutover', async () => {
    mockFlags.isCopilotBillingAttributionV1Enabled = true

    const res = await POST(
      request({ userId: 'user-1', workspaceId: 'ws-1' }, { 'x-sim-billing-protocol': 'legacy-v0' })
    )

    expect(res.status).toBe(200)
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith('user-1')
    expect(mockCheckOrgMemberUsageLimit).toHaveBeenCalledWith('user-1', 'ws-1')
    expect(res.headers.get('x-sim-billing-attribution')).toBe('serialized-attribution')
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
  })

  it('requires workspace attribution for explicitly labeled legacy requests', async () => {
    const res = await POST(request({ userId: 'user-1' }, { 'x-sim-billing-protocol': 'legacy-v0' }))

    expect(res.status).toBe(400)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
  })

  it('uses the exact frozen attribution for attributed-v1 admission', async () => {
    const res = await POST(
      request(
        { userId: 'user-1', workspaceId: 'ws-1' },
        {
          'x-sim-billing-protocol': 'attribution-v1',
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
          'x-sim-billing-attribution': 'serialized-attribution',
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockRequireBillingAttributionHeader).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledWith(ATTRIBUTION)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
    expect(mockCheckOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('fails attributed-v1 closed when attribution is missing', async () => {
    const res = await POST(
      request(
        { userId: 'user-1', workspaceId: 'ws-1' },
        {
          'x-sim-billing-protocol': 'attribution-v1',
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
        }
      )
    )

    expect(res.status).toBe(400)
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
  })

  it('fails attributed-v1 closed when attribution mismatches actor or workspace', async () => {
    mockRequireBillingAttributionHeader.mockImplementationOnce(() => {
      throw new Error('billing attribution mismatch')
    })

    const res = await POST(
      request(
        { userId: 'user-1', workspaceId: 'ws-1' },
        {
          'x-sim-billing-protocol': 'attribution-v1',
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
          'x-sim-billing-attribution': 'serialized-attribution',
        }
      )
    )

    expect(res.status).toBe(400)
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
  })

  it('admits a direct-v1 key without Redis while ignoring a local workspace ID', async () => {
    mockGetUserEntityPermissions.mockResolvedValueOnce(null)
    mockGetWorkspaceBillingSettings.mockResolvedValueOnce({
      billedAccountUserId: 'different-owner',
      allowPersonalApiKeys: false,
    })

    const res = await POST(
      request(
        { userId: 'user-1', workspaceId: 'local-self-hosted-workspace' },
        {
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith('user-1', ACCOUNT_SUBSCRIPTION)
    expect(mockCheckOrgMemberUsageLimit).not.toHaveBeenCalled()
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockGetWorkspaceBillingSettings).not.toHaveBeenCalled()
    expect(res.headers.get('x-sim-billing-account-decision')).toBe('serialized-account-decision')
  })

  it('admits direct-v1 account billing when workspaceId is omitted', async () => {
    const res = await POST(
      request(
        { userId: 'user-1' },
        {
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
        }
      )
    )

    expect(res.status).toBe(200)
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith('user-1', ACCOUNT_SUBSCRIPTION)
    expect(mockCheckOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('fails direct-v1 admission closed when its payer cannot be resolved', async () => {
    mockGetHighestPrioritySubscription.mockRejectedValueOnce(new Error('database unavailable'))

    const res = await POST(
      request(
        { userId: 'user-1' },
        {
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
        }
      )
    )

    expect(res.status).toBe(500)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
  })

  it('does not return a direct-v1 account decision when usage admission returns 402', async () => {
    mockCheckServerSideUsageLimits.mockResolvedValueOnce({
      isExceeded: true,
      currentUsage: 200,
      limit: 100,
    })

    const res = await POST(
      request(
        { userId: 'user-1', workspaceId: 'ws-1' },
        {
          'x-sim-billing-protocol': 'direct-v1',
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
        }
      )
    )

    expect(res.status).toBe(402)
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(res.headers.get('x-sim-billing-account-decision')).toBeNull()
  })

  it('rejects trusted billing material before parsing for an untrusted caller', async () => {
    mockCheckInternalApiKey.mockReturnValueOnce({
      success: false,
      response: new Response(null, { status: 401 }),
    })

    const res = await POST(
      request(
        { userId: 'user-1', workspaceId: 'ws-1' },
        {
          'x-sim-billing-protocol': 'attribution-v1',
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
          'x-sim-billing-attribution': 'serialized-attribution',
        }
      )
    )

    expect(res.status).toBe(401)
    await expect(res.text()).resolves.toBe('')
    expect(mockRequireBillingAttributionHeader).not.toHaveBeenCalled()
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockGetWorkspaceBillingSettings).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
  })
})
