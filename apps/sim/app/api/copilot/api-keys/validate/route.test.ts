import {
  createMockRequest,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import { billingPlanMock, billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  billingUsageLogMock,
  billingUsageLogMockFns,
} from '@sim/testing/mocks/billing-usage-log.mock'
import {
  billingUsageMonitorMock,
  billingUsageMonitorMockFns,
} from '@sim/testing/mocks/billing-usage-monitor.mock'
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing/mocks/copilot-http.mock'
import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import { mothershipOtelMock } from '@sim/testing/mocks/mothership-otel.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspacesUtilsMock,
  workspacesUtilsMockFns,
} from '@sim/testing/mocks/workspaces-utils.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const {
  mockCheckAttributedUsageLimits,
  mockRequireBillingAttributionHeader,
  mockRequireBillingRequestIdHeader,
  mockResolveLegacyV0BillingAttribution,
  mockResolveBillingAttribution,
  mockSerializeAccountBillingDecisionHeader,
  mockSerializeBillingAttributionHeader,
  mockAuthorizeCallback,
  mockCheckContinuationBilling,
} = vi.hoisted(() => ({
  mockCheckAttributedUsageLimits: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockRequireBillingRequestIdHeader: vi.fn(),
  mockResolveLegacyV0BillingAttribution: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockSerializeAccountBillingDecisionHeader: vi.fn(),
  mockSerializeBillingAttributionHeader: vi.fn(),
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
    end: '2099-01-01T00:00:00.000Z',
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
    end: '2099-01-01T00:00:00.000Z',
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

vi.mock('@/lib/billing/calculations/usage-monitor', () => billingUsageMonitorMock)

vi.mock('@/lib/billing/core/plan', () => billingPlanMock)

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

vi.mock('@/lib/billing/core/usage-log', () => billingUsageLogMock)

vi.mock('@/lib/mothership/application/authorize-chat-callback', () => ({
  authorizeCopilotChatCallback: mockAuthorizeCallback,
  checkCopilotContinuationBilling: mockCheckContinuationBilling,
}))

vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)

vi.mock('@/lib/mothership/request/otel', () => mothershipOtelMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)

import {
  validateCopilotApiKeyBodySchema,
  validateCopilotApiKeyContract,
} from '@/lib/api/contracts/copilot'
import { resetMidRunUsageCaches } from '@/lib/billing/core/mid-run-usage'
import { resetUsageGateCache } from '@/lib/billing/core/usage-gate-cache'
import { POST } from '@/app/api/copilot/api-keys/validate/route'

const { mockGetWorkspaceBillingSettings } = workspacesUtilsMockFns
const { mockCheckInternalApiKey } = copilotHttpMockFns
const { mockAuthorizeOrganizationChatDelegation: mockAuthorizeOrganizationChat } =
  mothershipOrganizationChatsMockFns
const { mockDeriveBillingContext } = billingUsageLogMockFns
const { mockGetHighestPrioritySubscription } = billingPlanMockFns
const { mockGetOrganizationSubscription } = billingCoreMockFns
const {
  mockCheckBillingBlocked,
  mockCheckBillingEntityBlocked,
  mockCheckServerSideUsageLimits,
  mockCheckUsageStatus,
} = billingUsageMonitorMockFns

const mockIsEnterprisePlan = billingSubscriptionMockFns.mockIsEnterprisePlan
const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

afterAll(resetEnvFlagsMock)

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return createMockRequest('POST', body, { 'x-api-key': 'internal', ...headers })
}

describe('POST /api/copilot/api-keys/validate billing protocols', () => {
  beforeEach(() => {
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

  it("sends a new turn's usage refusal as the empty 402 its contract declares", async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })

    const res = await POST(request(SELF_HOSTED_VALIDATE_BODY))

    expect(res.status).toBe(402)
    expect(await res.text()).toBe('')
    const refusalSchema = validateCopilotApiKeyContract.response.statusSchemas?.[402]
    expect(refusalSchema?.safeParse(undefined).success).toBe(true)
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

  it('returns whether the validated key owner has an enterprise account', async () => {
    mockIsEnterprisePlan.mockResolvedValueOnce(true)

    const res = await POST(request(SELF_HOSTED_VALIDATE_BODY))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ isEnterprise: true })
    expect(mockIsEnterprisePlan).toHaveBeenCalledWith('user-1')
  })

  it('preserves account admission for a workspace-less self-hosted body', async () => {
    const res = await POST(request(SELF_HOSTED_WORKSPACELESS_VALIDATE_BODY))

    expect(res.status).toBe(200)
    expect(mockCheckServerSideUsageLimits).toHaveBeenCalledWith('user-1')
    expect(mockResolveLegacyV0BillingAttribution).not.toHaveBeenCalled()
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
  })

  it('rejects markerless admission on hosted Sim', async () => {
    setEnvFlags({ isHosted: true })
    const res = await POST(request(SELF_HOSTED_VALIDATE_BODY))

    expect(res.status).toBe(400)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
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
    mockSerializeAccountBillingDecisionHeader.mockImplementation((decision: object) =>
      encodeURIComponent(JSON.stringify(decision))
    )
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
    expect(
      JSON.parse(decodeURIComponent(res.headers.get('x-sim-billing-account-decision') ?? ''))
    ).toEqual({ ...ACCOUNT_BILLING_DECISION, payerSubscriptionId: ACCOUNT_SUBSCRIPTION.id })
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
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    for (let call = 0; call < 3; call++) queueTableRows(schemaMock.user, [{ id: 'user-1' }])
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockAuthorizeCallback.mockReset().mockResolvedValue(undefined)
    mockCheckContinuationBilling.mockReset().mockResolvedValue({ blocked: false })
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    mockCheckUsageStatus.mockResolvedValue({ isExceeded: false, currentUsage: 1, limit: 10 })
    mockCheckBillingBlocked.mockResolvedValue({ blocked: false })
    mockCheckBillingEntityBlocked.mockResolvedValue({ blocked: false })
    mockIsEnterprisePlan.mockResolvedValue(false)
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-org-1',
      referenceId: 'org-1',
      plan: 'enterprise',
      status: 'active',
      periodStart: new Date(ATTRIBUTION.billingPeriod.start),
      periodEnd: new Date(ATTRIBUTION.billingPeriod.end),
    })
    resetUsageGateCache()
    resetMidRunUsageCaches()
  })

  it('defaults older callers to full admission and rejects unknown purposes', () => {
    expect(validateCopilotApiKeyBodySchema.parse({ userId: 'user-1' }).purpose).toBe('new-turn')
    expect(
      validateCopilotApiKeyBodySchema.safeParse({ userId: 'user-1', purpose: 'skip' }).success
    ).toBe(false)
  })

  it('checks original payer, current scope, and the original payer spend', async () => {
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

  it('refuses a direct-v1 continuation whose account is over its usage limit', async () => {
    mockCheckUsageStatus.mockResolvedValue({ isExceeded: true, currentUsage: 12, limit: 10 })

    const response = await POST(request(body, directHeaders))

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      code: 'USAGE_LIMIT_EXCEEDED',
      usageUpgrade: { reason: 'usage_limit' },
    })
  })

  it("refuses a direct-v1 continuation with the card for its admitted payer's plan", async () => {
    mockCheckUsageStatus.mockResolvedValue({ isExceeded: true, currentUsage: 12, limit: 10 })
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-account-org',
      referenceId: 'account-org',
      plan: 'team',
      status: 'active',
      seats: 4,
    })
    mockGetHighestPrioritySubscription.mockResolvedValue(null)

    const response = await POST(request(body, directHeaders))

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      usageUpgrade: {
        action: 'increase_limit',
        message: expect.stringContaining("organization's usage limit"),
      },
    })
  })

  it('admits a direct-v1 continuation whose usage cannot be read', async () => {
    mockCheckUsageStatus.mockResolvedValue({ isExceeded: true, unavailable: true })
    expect((await POST(request(body, directHeaders))).status).toBe(200)
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

  it('fails closed on scope or account-standing infrastructure errors', async () => {
    mockAuthorizeCallback.mockRejectedValueOnce(new Error('database unavailable'))
    expect((await POST(request(body, attributedHeaders))).status).toBe(500)
    mockCheckContinuationBilling.mockRejectedValueOnce(new Error('database unavailable'))
    expect((await POST(request(body, attributedHeaders))).status).toBe(500)
  })

  it.each(['actor', 'payer'])('refuses a newly blocked %s on continuation', async (scope) => {
    mockCheckContinuationBilling.mockResolvedValueOnce({
      blocked: true,
      scope,
      message: 'Billing account frozen.',
    })
    const response = await POST(request(body, attributedHeaders))
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      code: 'BILLING_BLOCKED',
      error: 'Billing account frozen.',
    })
    expect(mockCheckAttributedUsageLimits).not.toHaveBeenCalled()
  })

  it('refuses a payer the usage gate finds blocked as blocked, without the usage card', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      reason: 'billing_blocked',
      message: 'Organization billing issue.',
      scope: 'payer',
    })
    const response = await POST(request(body, attributedHeaders))
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      code: 'BILLING_BLOCKED',
      error: 'Organization billing issue.',
    })
  })

  it('admits a polled continuation whose spend cannot be read', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      reason: 'usage_unavailable',
    })
    expect((await POST(request(body, attributedHeaders))).status).toBe(200)
    mockCheckAttributedUsageLimits.mockRejectedValue(new Error('ledger read timed out'))
    expect((await POST(request(body, attributedHeaders))).status).toBe(200)
  })

  it('refuses a continuation over its usage limit with the card the worker writes', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })

    const response = await POST(request(body, attributedHeaders))

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      code: 'USAGE_LIMIT_EXCEEDED',
      error: expect.stringContaining('usage limit'),
      usageUpgrade: {
        reason: 'usage_limit',
        action: 'upgrade_plan',
        message: expect.stringContaining('usage limit'),
      },
    })
  })

  it('answers a polled re-check from the cached admission and always re-reads a refusal', async () => {
    for (let call = 0; call < 2; call++) queueTableRows(schemaMock.user, [{ id: 'user-1' }])
    expect((await POST(request(body, attributedHeaders))).status).toBe(200)
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })
    for (let poll = 0; poll < 2; poll++) {
      expect((await POST(request(body, attributedHeaders))).status).toBe(200)
    }

    resetUsageGateCache()
    expect((await POST(request(body, attributedHeaders))).status).toBe(402)
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    expect((await POST(request(body, attributedHeaders))).status).toBe(200)
  })

  it('checks the payer saved at admission for a direct-v1 run whose actor changed orgs', async () => {
    const endedDecision = {
      ...ACCOUNT_BILLING_DECISION,
      billingPeriod: { start: '2026-06-01T00:00:00.000Z', end: '2026-07-01T00:00:00.000Z' },
    }
    mockGetHighestPrioritySubscription.mockResolvedValue({
      id: 'sub-new-org',
      referenceId: 'new-org',
      plan: 'team',
      status: 'active',
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2099-01-01T00:00:00.000Z'),
    })
    mockGetOrganizationSubscription.mockResolvedValue({
      id: 'sub-account-org',
      referenceId: 'account-org',
      plan: 'team',
      status: 'active',
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2099-01-01T00:00:00.000Z'),
    })
    mockCheckUsageStatus.mockImplementation(
      async (
        _userId: string,
        _subscription: unknown,
        context?: { billingEntity: { id: string } }
      ) => ({
        isExceeded: context?.billingEntity.id === 'account-org',
        currentUsage: 12,
        limit: 10,
      })
    )

    const response = await POST(
      request(body, { ...directHeaders, 'x-sim-billing-account-decision': encode(endedDecision) })
    )

    expect(response.status).toBe(402)
  })

  it('answers repeated direct-v1 continuations from the cached admission and re-reads a refusal', async () => {
    for (let call = 0; call < 2; call++) queueTableRows(schemaMock.user, [{ id: 'user-1' }])
    expect((await POST(request(body, directHeaders))).status).toBe(200)
    mockCheckUsageStatus.mockResolvedValue({ isExceeded: true, currentUsage: 12, limit: 10 })
    for (let leg = 0; leg < 2; leg++) {
      expect((await POST(request(body, directHeaders))).status).toBe(200)
    }

    resetMidRunUsageCaches()
    expect((await POST(request(body, directHeaders))).status).toBe(402)
    mockCheckUsageStatus.mockResolvedValue({ isExceeded: false, currentUsage: 1, limit: 10 })
    expect((await POST(request(body, directHeaders))).status).toBe(200)
  })

  it('never reads the usage gate for an attributed continuation when billing is off', async () => {
    setEnvFlags({ isHosted: false, isBillingEnabled: false })
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })

    expect((await POST(request(body, attributedHeaders))).status).toBe(200)
  })

  it('never reads the ledger for a direct-v1 continuation when billing is off', async () => {
    setEnvFlags({ isHosted: false, isBillingEnabled: false })
    mockCheckUsageStatus.mockResolvedValue({ isExceeded: true, currentUsage: 12, limit: 10 })

    expect((await POST(request(body, directHeaders))).status).toBe(200)
  })

  it('judges a direct-v1 reporting-window run against its admitted window after it ends', async () => {
    const admittedWindow = {
      ...ACCOUNT_BILLING_DECISION,
      billingPeriod: {
        start: '2026-06-01T00:00:00.000Z',
        end: '2026-07-01T00:00:00.000Z',
        source: 'reporting' as const,
      },
    }
    mockCheckUsageStatus.mockImplementation(
      async (
        _userId: string,
        _subscription: unknown,
        context?: { billingPeriod: { start: Date } }
      ) => ({
        isExceeded:
          context?.billingPeriod.start.toISOString() === admittedWindow.billingPeriod.start,
        currentUsage: 12,
        limit: 10,
      })
    )

    const response = await POST(
      request(body, { ...directHeaders, 'x-sim-billing-account-decision': encode(admittedWindow) })
    )

    expect(response.status).toBe(402)
  })

  it('judges a direct-v1 organization payer without a subscription as that organization', async () => {
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockCheckUsageStatus.mockImplementation(
      async (_userId: string, subscription: { referenceId?: string } | null) => ({
        isExceeded: subscription?.referenceId === 'account-org',
        currentUsage: 12,
        limit: 10,
      })
    )

    expect((await POST(request(body, directHeaders))).status).toBe(402)
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
    expect((await POST(request({ ...body, purpose: 'new-turn' }, directHeaders))).status).toBe(400)
    expect(mockCheckServerSideUsageLimits).not.toHaveBeenCalled()
  })
})
