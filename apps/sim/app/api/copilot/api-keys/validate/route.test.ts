/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const {
  mockCheckInternalApiKey,
  mockCheckAttributedUsageLimits,
  mockCheckServerSideUsageLimits,
  mockDeriveBillingContext,
  mockGetHighestPrioritySubscription,
  mockIsEnterprisePlan,
  mockRequireBillingAttributionHeader,
  mockRequireBillingRequestIdHeader,
  mockResolveLegacyV0BillingAttribution,
  mockResolveBillingAttribution,
  mockSerializeAccountBillingDecisionHeader,
  mockSerializeBillingAttributionHeader,
  mockGetUserEntityPermissions,
  mockGetWorkspaceBillingSettings,
  mockAuthorizeOrganizationChat,
  mockAuthorizeCallback,
  mockCheckContinuationBilling,
} = vi.hoisted(() => ({
  mockCheckInternalApiKey: vi.fn(),
  mockCheckAttributedUsageLimits: vi.fn(),
  mockCheckServerSideUsageLimits: vi.fn(),
  mockDeriveBillingContext: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockIsEnterprisePlan: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockRequireBillingRequestIdHeader: vi.fn(),
  mockResolveLegacyV0BillingAttribution: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockSerializeAccountBillingDecisionHeader: vi.fn(),
  mockSerializeBillingAttributionHeader: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockAuthorizeOrganizationChat: vi.fn(),
  mockAuthorizeCallback: vi.fn(),
  mockCheckContinuationBilling: vi.fn(),
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
    source: 'reporting' as const,
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
    source: 'reporting' as const,
  },
}

const SELF_HOSTED_VALIDATE_BODY = {
  userId: 'user-1',
  workspaceId: 'ws-1',
} as const

const SELF_HOSTED_WORKSPACELESS_VALIDATE_BODY = {
  userId: 'user-1',
} as const

const SELF_HOSTED_OPAQUE_WORKSPACE_VALIDATE_BODY = {
  userId: 'user-1',
  workspaceId: 'local-self-hosted-workspace',
} as const

vi.mock('@/lib/billing/core/billing-attribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/core/billing-attribution')>()),
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
  resolveLegacyV0BillingAttribution: mockResolveLegacyV0BillingAttribution,
  resolveBillingAttribution: mockResolveBillingAttribution,
  serializeAccountBillingDecisionHeader: mockSerializeAccountBillingDecisionHeader,
  serializeBillingAttributionHeader: mockSerializeBillingAttributionHeader,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkServerSideUsageLimits: mockCheckServerSideUsageLimits,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  isEnterprisePlan: mockIsEnterprisePlan,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  deriveBillingContext: mockDeriveBillingContext,
}))

vi.mock('@/lib/copilot/application/authorize-chat-callback', () => ({
  authorizeCopilotChatCallback: mockAuthorizeCallback,
  checkCopilotContinuationBilling: mockCheckContinuationBilling,
}))

vi.mock('@/lib/copilot/chat/organization-chats', () => ({
  authorizeOrganizationChatDelegation: { execute: mockAuthorizeOrganizationChat },
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

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBillingSettings: mockGetWorkspaceBillingSettings,
}))

import { validateCopilotApiKeyBodySchema } from '@/lib/api/contracts/copilot'
import { POST } from '@/app/api/copilot/api-keys/validate/route'

afterAll(resetEnvFlagsMock)

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return createMockRequest('POST', body, { 'x-api-key': 'internal', ...headers })
}

describe('POST /api/copilot/api-keys/validate billing protocols', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: false, isBillingEnabled: false })
    mockAuthorizeCallback.mockResolvedValue(undefined)
    mockCheckContinuationBilling.mockResolvedValue({ blocked: false })
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    queueTableRows(schemaMock.user, [{ id: 'user-1' }])
    mockResolveBillingAttribution.mockResolvedValue(ATTRIBUTION)
    mockResolveLegacyV0BillingAttribution.mockResolvedValue(ATTRIBUTION)
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
    mockIsEnterprisePlan.mockResolvedValue(false)
    mockDeriveBillingContext.mockReturnValue({
      billingEntity: ACCOUNT_BILLING_DECISION.billingEntity,
      billingPeriod: {
        start: new Date(ACCOUNT_BILLING_DECISION.billingPeriod.start),
        end: new Date(ACCOUNT_BILLING_DECISION.billingPeriod.end),
        source: ACCOUNT_BILLING_DECISION.billingPeriod.source,
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
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('keeps local self-hosted validate bodies contract-compatible', () => {
    expect(validateCopilotApiKeyBodySchema.safeParse(SELF_HOSTED_VALIDATE_BODY).success).toBe(true)
    expect(
      validateCopilotApiKeyBodySchema.safeParse(SELF_HOSTED_WORKSPACELESS_VALIDATE_BODY).success
    ).toBe(true)
    expect(
      validateCopilotApiKeyBodySchema.safeParse(SELF_HOSTED_OPAQUE_WORKSPACE_VALIDATE_BODY).success
    ).toBe(true)
  })

  it('checks the routed workspace payer pool for markerless self-hosted admission', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      payerUsage: { currentUsage: 200, limit: 100 },
      scope: 'payer',
    })
    const res = await POST(request(SELF_HOSTED_VALIDATE_BODY))

    expect(res.status).toBe(402)
    expect(mockResolveLegacyV0BillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledWith(ATTRIBUTION)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
  })

  it('preserves the actor member cap for markerless self-hosted admission', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      payerUsage: { currentUsage: 20, limit: 100 },
      memberUsage: { currentUsage: 5, limit: 4 },
      scope: 'member',
    })
    const res = await POST(request(SELF_HOSTED_VALIDATE_BODY))

    expect(res.status).toBe(402)
  })

  it('accepts markerless self-hosted admission under its routed workspace limits', async () => {
    const res = await POST(request(SELF_HOSTED_VALIDATE_BODY))

    expect(res.status).toBe(200)
    expect(res.headers.get('x-sim-billing-attribution')).toBeNull()
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledWith(ATTRIBUTION)
  })

  it('returns whether the validated key owner has an enterprise account', async () => {
    mockIsEnterprisePlan.mockResolvedValueOnce(true)

    const res = await POST(request(SELF_HOSTED_VALIDATE_BODY))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ isEnterprise: true })
    expect(mockIsEnterprisePlan).toHaveBeenCalledWith('user-1')
  })

  it('returns false when the validated key owner is not enterprise', async () => {
    const res = await POST(request(SELF_HOSTED_VALIDATE_BODY))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ isEnterprise: false })
  })

  it('preserves account admission for a workspace-less self-hosted body', async () => {
    const res = await POST(request(SELF_HOSTED_WORKSPACELESS_VALIDATE_BODY))

    expect(res.status).toBe(200)
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith('user-1')
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
  })

  it('preserves account admission for an opaque direct legacy workspace', async () => {
    mockResolveLegacyV0BillingAttribution.mockResolvedValueOnce(null)
    const res = await POST(request(SELF_HOSTED_OPAQUE_WORKSPACE_VALIDATE_BODY))

    expect(res.status).toBe(200)
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith('user-1')
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
  })

  it('rejects markerless admission on hosted Sim', async () => {
    setEnvFlags({ isHosted: true })
    const res = await POST(request(SELF_HOSTED_VALIDATE_BODY))

    expect(res.status).toBe(400)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
  })

  it('allows explicitly labeled legacy requests on hosted Sim', async () => {
    setEnvFlags({ isHosted: true })
    const res = await POST(
      request(SELF_HOSTED_VALIDATE_BODY, { 'x-sim-billing-protocol': 'legacy-v0' })
    )

    expect(res.status).toBe(200)
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledWith(ATTRIBUTION)
    expect(res.headers.get('x-sim-billing-attribution')).toBe('serialized-attribution')
    expect(mockResolveLegacyV0BillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
  })

  it('requires workspace attribution for explicitly labeled legacy requests', async () => {
    const res = await POST(request({ userId: 'user-1' }, { 'x-sim-billing-protocol': 'legacy-v0' }))

    expect(res.status).toBe(400)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
  })

  it('requires the current actor and canonical private chat for organization admission', async () => {
    const orgAttribution = { ...ATTRIBUTION, workspaceId: null }
    mockRequireBillingAttributionHeader.mockReturnValueOnce(orgAttribution)
    const response = await POST(
      createMockRequest(
        'POST',
        { userId: 'user-1', organizationId: 'org-1', chatId: 'chat-1' },
        {
          'x-api-key': 'internal',
          'x-sim-billing-protocol': 'attribution-v1',
          'x-sim-billing-request-id': '00000000-0000-4000-8000-000000000001',
          'x-sim-billing-attribution': 'serialized-attribution',
        }
      )
    )
    expect(response.status).toBe(200)
    expect(mockAuthorizeOrganizationChat).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'organization_delegated',
        subjectUserId: 'user-1',
        organizationId: 'org-1',
        resourceScope: { chatId: 'chat-1' },
      }),
    })
    expect(mockRequireBillingAttributionHeader).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: 'user-1',
      organizationId: 'org-1',
    })
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledWith(orgAttribution)
  })

  it('denies removed members before billing admission', async () => {
    mockAuthorizeOrganizationChat.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Conversation not found')
    )
    const response = await POST(
      createMockRequest(
        'POST',
        { userId: 'user-1', organizationId: 'org-1', chatId: 'chat-1' },
        { 'x-api-key': 'internal', 'x-sim-billing-protocol': 'attribution-v1' }
      )
    )
    expect(response.status).toBe(403)
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
  })

  it('rejects markerless organization admission rather than settling it as a personal account', async () => {
    const response = await POST(
      request({ userId: 'user-1', organizationId: 'org-1', chatId: 'chat-1' })
    )
    expect(response.status).toBe(400)
    expect(mockAuthorizeOrganizationChat).not.toHaveBeenCalled()
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
  })

  it('rejects an organization request missing its private chat', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        { userId: 'user-1', organizationId: 'org-1' },
        { 'x-api-key': 'internal', 'x-sim-billing-protocol': 'attribution-v1' }
      )
    )
    expect(response.status).toBe(400)
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
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
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith(
      'user-1',
      ACCOUNT_SUBSCRIPTION,
      expect.objectContaining({ billingEntity: ACCOUNT_BILLING_DECISION.billingEntity })
    )
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockGetWorkspaceBillingSettings).not.toHaveBeenCalled()
    expect(mockSerializeAccountBillingDecisionHeader).toHaveBeenCalledWith(ACCOUNT_BILLING_DECISION)
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
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith(
      'user-1',
      ACCOUNT_SUBSCRIPTION,
      expect.objectContaining({ billingEntity: ACCOUNT_BILLING_DECISION.billingEntity })
    )
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

describe('validation lifecycle purposes', () => {
  const requestId = '0190c03f-9f7d-4b79-8b58-e7f779fd29e1'
  const encode = (value: object) => encodeURIComponent(JSON.stringify(value))
  const attributedHeaders = {
    'x-sim-billing-protocol': 'attribution-v1',
    'x-sim-billing-request-id': requestId,
    'x-sim-billing-attribution': encode(ATTRIBUTION),
  }
  const directHeaders = {
    'x-sim-billing-protocol': 'direct-v1',
    'x-sim-billing-request-id': requestId,
    'x-sim-billing-account-decision': encode(ACCOUNT_BILLING_DECISION),
  }
  const body = { userId: 'user-1', workspaceId: 'ws-1', chatId: 'chat-1', purpose: 'continuation' }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    for (let call = 0; call < 3; call++) queueTableRows(schemaMock.user, [{ id: 'user-1' }])
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockAuthorizeCallback.mockReset().mockResolvedValue(undefined)
    mockCheckContinuationBilling.mockReset().mockResolvedValue({ blocked: false })
    mockIsEnterprisePlan.mockResolvedValue(false)
  })

  it('defaults older callers to full admission and rejects unknown purposes', () => {
    expect(validateCopilotApiKeyBodySchema.parse({ userId: 'user-1' }).purpose).toBe('new-turn')
    expect(
      validateCopilotApiKeyBodySchema.safeParse({ userId: 'user-1', purpose: 'skip' }).success
    ).toBe(false)
  })

  it.each(['continuation', 'cancellation'])(
    'authenticates before processing %s',
    async (purpose) => {
      mockCheckInternalApiKey.mockReturnValueOnce({ success: false })
      expect((await POST(request({ ...body, purpose }, attributedHeaders))).status).toBe(401)
      expect(mockAuthorizeCallback).not.toHaveBeenCalled()
      expect(mockCheckContinuationBilling).not.toHaveBeenCalled()
    }
  )

  it('checks original payer and current scope without repeating spend admission', async () => {
    const response = await POST(request(body, attributedHeaders))
    expect(response.status).toBe(200)
    expect(mockAuthorizeCallback).toHaveBeenCalledWith({ ...body, delegationId: requestId })
    expect(mockCheckContinuationBilling).toHaveBeenCalledWith({
      kind: 'attributed',
      attribution: ATTRIBUTION,
    })
    expect(mockAuthorizeCallback.mock.invocationCallOrder[0]).toBeLessThan(
      mockCheckContinuationBilling.mock.invocationCallOrder[0]
    )
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(response.headers.get('x-sim-billing-attribution')).toBeNull()
    expect(response.headers.get('x-sim-billing-account-decision')).toBeNull()
  })

  it('refreshes entitlement with the stored account payer and opaque direct scope', async () => {
    mockIsEnterprisePlan.mockResolvedValueOnce(true)
    const response = await POST(
      request({ ...body, workspaceId: 'opaque-local-workspace' }, directHeaders)
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ isEnterprise: true })
    expect(mockCheckContinuationBilling).toHaveBeenCalledWith({
      kind: 'account',
      decision: ACCOUNT_BILLING_DECISION,
    })
    expect(mockAuthorizeCallback).not.toHaveBeenCalled()
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(mockDeriveBillingContext).not.toHaveBeenCalled()
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
    expect(response.headers.get('x-sim-billing-account-decision')).toBeNull()
  })

  it.each([
    ['missing attribution', { ...attributedHeaders, 'x-sim-billing-attribution': '' }],
    [
      'malformed attribution',
      { ...attributedHeaders, 'x-sim-billing-attribution': 'invalid-json' },
    ],
    ['missing id', { ...attributedHeaders, 'x-sim-billing-request-id': '' }],
    [
      'conflicting material',
      { ...attributedHeaders, 'x-sim-billing-account-decision': encode(ACCOUNT_BILLING_DECISION) },
    ],
    [
      'another actor',
      {
        ...attributedHeaders,
        'x-sim-billing-attribution': encode({ ...ATTRIBUTION, actorUserId: 'other-user' }),
      },
    ],
    [
      'another workspace',
      {
        ...attributedHeaders,
        'x-sim-billing-attribution': encode({ ...ATTRIBUTION, workspaceId: 'other-workspace' }),
      },
    ],
    ['missing account decision', { ...directHeaders, 'x-sim-billing-account-decision': '' }],
    [
      'malformed account decision',
      { ...directHeaders, 'x-sim-billing-account-decision': 'invalid-json' },
    ],
    [
      'different account actor',
      {
        ...directHeaders,
        'x-sim-billing-account-decision': encode({
          ...ACCOUNT_BILLING_DECISION,
          userId: 'other-user',
        }),
      },
    ],
    [
      'direct conflicting material',
      { ...directHeaders, 'x-sim-billing-attribution': encode(ATTRIBUTION) },
    ],
  ])('rejects %s before authorization or billing', async (_label, headers) => {
    expect((await POST(request(body, headers))).status).toBe(400)
    expect(mockAuthorizeCallback).not.toHaveBeenCalled()
    expect(mockCheckContinuationBilling).not.toHaveBeenCalled()
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
  })

  it('binds organization continuation to original actor, scope and private chat', async () => {
    const attribution = { ...ATTRIBUTION, workspaceId: null }
    const orgBody = {
      userId: 'user-1',
      organizationId: 'org-1',
      chatId: 'chat-1',
      purpose: 'continuation',
    }
    const headers = { ...attributedHeaders, 'x-sim-billing-attribution': encode(attribution) }
    expect((await POST(request(orgBody, headers))).status).toBe(200)
    expect(mockAuthorizeCallback).toHaveBeenCalledWith({ ...orgBody, delegationId: requestId })
    expect(mockCheckContinuationBilling).toHaveBeenCalledWith({ kind: 'attributed', attribution })
    expect((await POST(request({ ...orgBody, organizationId: 'other-org' }, headers))).status).toBe(
      400
    )
  })

  it.each(['continuation', 'cancellation'])('rejects a deleted actor on %s', async (purpose) => {
    resetDbChainMock()
    queueTableRows(schemaMock.user, [])
    expect((await POST(request({ ...body, purpose }, attributedHeaders))).status).toBe(403)
    expect(mockAuthorizeCallback).not.toHaveBeenCalled()
    expect(mockCheckContinuationBilling).not.toHaveBeenCalled()
  })

  it.each(['continuation', 'cancellation'])(
    'rejects revoked scope on %s before billing',
    async (purpose) => {
      mockAuthorizeCallback.mockRejectedValueOnce(
        new OrchestrationError('forbidden', 'Access revoked')
      )
      expect((await POST(request({ ...body, purpose }, attributedHeaders))).status).toBe(403)
      expect(mockCheckContinuationBilling).not.toHaveBeenCalled()
    }
  )

  it('fails closed on scope or account-standing infrastructure errors', async () => {
    mockAuthorizeCallback.mockRejectedValueOnce(new Error('database unavailable'))
    expect((await POST(request(body, attributedHeaders))).status).toBe(500)
    mockCheckContinuationBilling.mockRejectedValueOnce(new Error('database unavailable'))
    expect((await POST(request(body, attributedHeaders))).status).toBe(500)
  })

  it.each(['actor', 'payer'])('refuses a newly blocked %s on continuation', async (scope) => {
    mockCheckContinuationBilling.mockResolvedValueOnce({ blocked: true, scope })
    expect((await POST(request(body, attributedHeaders))).status).toBe(402)
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
  })

  it('allows cancellation without billing material or spending/standing/plan checks', async () => {
    const response = await POST(
      request({ ...body, purpose: 'cancellation' }, { 'x-sim-billing-protocol': 'attribution-v1' })
    )
    expect(response.status).toBe(200)
    expect(mockAuthorizeCallback).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'cancellation', workspaceId: 'ws-1' })
    )
    expect(mockCheckContinuationBilling).not.toHaveBeenCalled()
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
    expect(mockIsEnterprisePlan).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ isEnterprise: false })
  })

  it('reuses a legacy checkpoint snapshot without selecting a new payer', async () => {
    const response = await POST(
      request(body, {
        'x-sim-billing-protocol': 'legacy-v0',
        'x-sim-billing-attribution': encode(ATTRIBUTION),
      })
    )
    expect(response.status).toBe(200)
    expect(mockCheckContinuationBilling).toHaveBeenCalledWith({
      kind: 'attributed',
      attribution: ATTRIBUTION,
    })
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'rejects a legacy organization snapshot with omitted scope even when hosted=%s',
    async (isHosted) => {
      setEnvFlags({ isHosted, isBillingEnabled: isHosted })
      const response = await POST(
        request(
          { userId: 'user-1', purpose: 'continuation' },
          {
            'x-sim-billing-protocol': 'legacy-v0',
            'x-sim-billing-attribution': encode({ ...ATTRIBUTION, workspaceId: null }),
          }
        )
      )
      expect(response.status).toBe(400)
      expect(mockAuthorizeCallback).not.toHaveBeenCalled()
      expect(mockCheckContinuationBilling).not.toHaveBeenCalled()
    }
  )

  it.each([
    [true, true, 400],
    [false, true, 400],
    [false, false, 200],
  ])(
    'allows missing legacy material only for unbilled self-hosting (%s, %s)',
    async (isHosted, isBillingEnabled, status) => {
      setEnvFlags({ isHosted, isBillingEnabled })
      expect((await POST(request(body, { 'x-sim-billing-protocol': 'legacy-v0' }))).status).toBe(
        status
      )
      expect(mockCheckContinuationBilling).not.toHaveBeenCalled()
      expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    }
  )

  it.each(['continuation', 'cancellation'])(
    'preserves markerless unbilled local %s with an opaque workspace',
    async (purpose) => {
      setEnvFlags({ isHosted: false, isBillingEnabled: false })
      expect(
        (await POST(request({ ...body, workspaceId: 'opaque-local-workspace', purpose }))).status
      ).toBe(200)
      expect(mockAuthorizeCallback).not.toHaveBeenCalled()
      expect(mockCheckContinuationBilling).not.toHaveBeenCalled()
      expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    }
  )

  it.each(['continuation', 'cancellation'])(
    'still checks snapshot scope on unbilled local %s',
    async (purpose) => {
      setEnvFlags({ isHosted: false, isBillingEnabled: false })
      const headers = {
        'x-sim-billing-protocol': 'legacy-v0',
        'x-sim-billing-attribution': encode(ATTRIBUTION),
      }
      expect((await POST(request({ ...body, purpose }, headers))).status).toBe(200)
      expect(mockAuthorizeCallback).toHaveBeenCalledWith(
        expect.objectContaining({ purpose, workspaceId: 'ws-1' })
      )
    }
  )

  it.each([
    ['attribution-v1', false, false],
    ['legacy-v0', true, true],
    ['legacy-v0', true, false],
    ['legacy-v0', false, true],
  ])(
    'checks cancellation scope for %s (hosted=%s, billing=%s)',
    async (protocol, isHosted, isBillingEnabled) => {
      setEnvFlags({ isHosted, isBillingEnabled })
      expect(
        (
          await POST(
            request({ ...body, purpose: 'cancellation' }, { 'x-sim-billing-protocol': protocol })
          )
        ).status
      ).toBe(200)
      expect(mockAuthorizeCallback).toHaveBeenCalled()
    }
  )

  it('refuses hosted cancellation without a protocol or resource scope', async () => {
    expect((await POST(request({ ...body, purpose: 'cancellation' }))).status).toBe(400)
    expect(
      (
        await POST(
          request(
            { userId: 'user-1', purpose: 'cancellation' },
            { 'x-sim-billing-protocol': 'attribution-v1' }
          )
        )
      ).status
    ).toBe(400)
    expect(mockAuthorizeCallback).not.toHaveBeenCalled()
  })

  it('checks fresh spending on the next new turn and refuses supplied account decisions', async () => {
    expect((await POST(request(body, attributedHeaders))).status).toBe(200)
    mockCheckAttributedUsageLimits.mockResolvedValueOnce({
      isExceeded: true,
      payerUsage: { currentUsage: 120, limit: 100 },
    })
    expect((await POST(request({ ...body, purpose: 'new-turn' }, attributedHeaders))).status).toBe(
      402
    )
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledTimes(1)
    expect((await POST(request({ ...body, purpose: 'new-turn' }, directHeaders))).status).toBe(400)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
  })
})
