/** @vitest-environment node */
import * as workspaceAuthz from '@sim/platform-authz/workspace'
import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  envFlagsMockFns,
  resetDbChainMock,
  resetEnvFlagsMock,
  resetEnvMock,
  setEnv,
  setEnvFlags,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordUsage: vi.fn(),
  resolveBilling: vi.fn(),
  resolveOrganizationBilling: vi.fn(),
  checkUsage: vi.fn(),
  toBillingContext: vi.fn(),
  billOverage: vi.fn(),
  rateCheck: vi.fn(),
  organizationConfig: vi.fn(),
  workspaceContext: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({ recordUsage: mocks.recordUsage }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mocks.resolveBilling,
  resolveOrganizationBillingAttribution: mocks.resolveOrganizationBilling,
  checkAttributedUsageLimits: mocks.checkUsage,
  toBillingContext: mocks.toBillingContext,
}))
vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillPayerOverageThreshold: mocks.billOverage,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.rateCheck
  },
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.organizationConfig,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspaceContext,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createSpeechToken } from '@/lib/speech/application/create-token'
import { POST } from '@/app/api/speech/token/route'

const permission = vi.spyOn(workspaceAuthz, 'resolveEffectiveWorkspacePermission')
const principal = { kind: 'session', userId: 'member-1', sessionId: 'session-1' } as const
const billingEntity = { type: 'organization', id: 'org-1' } as const
const billingPeriod = { start: new Date('2026-07-01'), end: new Date('2026-08-01') }

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  setEnv({ ELEVENLABS_API_KEY: 'test-key' })
  setEnvFlags({ isBillingEnabled: true })
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: principal.userId },
    session: { id: principal.sessionId },
  })
  permission.mockResolvedValue('read')
  mocks.workspaceContext.mockImplementation(async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'owner-1',
  }))
  mocks.organizationConfig.mockResolvedValue(null)
  dbChainMockFns.limit.mockResolvedValue([{ role: 'member' }])
  mocks.recordUsage.mockResolvedValue(undefined)
  mocks.billOverage.mockResolvedValue(undefined)
  mocks.rateCheck.mockResolvedValue({ allowed: true })
  mocks.checkUsage.mockResolvedValue({ isExceeded: false })
  mocks.resolveBilling.mockImplementation(async (input) => ({ ...input, billingEntity }))
  mocks.resolveOrganizationBilling.mockImplementation(async (input) => ({
    ...input,
    workspaceId: null,
    billedAccountUserId: 'owner-1',
    billingEntity,
  }))
  mocks.toBillingContext.mockReturnValue({ billingEntity, billingPeriod })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ token: 'tok-123' })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetDbChainMock()
  resetEnvMock()
  resetEnvFlagsMock()
})

describe('POST /api/speech/token', () => {
  it.each(['read', 'write', 'admin'] as const)(
    'allows workspace %s members and bills the acting user',
    async (role) => {
      permission.mockResolvedValue(role)
      envFlagsMockFns.getCostMultiplier.mockReturnValue(2)
      const response = await POST(createMockRequest('POST', { workspaceId: 'ws-1' }))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ token: 'tok-123' })
      expect(permission).toHaveBeenCalledWith('member-1', 'ws-1', null, undefined, {
        forUpdate: undefined,
      })
      expect(mocks.resolveBilling).toHaveBeenCalledWith({
        actorUserId: 'member-1',
        workspaceId: 'ws-1',
      })
      expect(mocks.recordUsage).toHaveBeenCalledWith({
        userId: 'member-1',
        workspaceId: 'ws-1',
        billingEntity,
        billingPeriod,
        entries: [
          {
            category: 'fixed',
            source: 'voice-input',
            description: 'Voice input session (3 min)',
            cost: 0.048,
            sourceReference: expect.stringMatching(/^voice-input:[a-f0-9]{64}$/),
          },
        ],
      })
      expect(mocks.billOverage).toHaveBeenCalledWith(billingEntity)
    }
  )

  it.each(['member', 'admin', 'owner'])(
    'allows organization %s members without inventing a workspace',
    async (role) => {
      dbChainMockFns.limit.mockResolvedValue([{ role }])
      const response = await POST(createMockRequest('POST', { organizationId: 'org-1' }))

      expect(response.status).toBe(200)
      expect(mocks.resolveOrganizationBilling).toHaveBeenCalledWith({
        actorUserId: 'member-1',
        organizationId: 'org-1',
      })
      expect(mocks.resolveBilling).not.toHaveBeenCalled()
      expect(mocks.workspaceContext).not.toHaveBeenCalled()
      expect(mocks.recordUsage.mock.calls[0][0]).toMatchObject({
        userId: 'member-1',
        billingEntity,
        billingPeriod,
      })
      expect(mocks.recordUsage.mock.calls[0][0]).not.toHaveProperty('workspaceId')
    }
  )

  it('authenticates before reading an oversized body', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await POST(createMockRequest('POST', { workspaceId: 'x'.repeat(64 * 1024) }))
    expect(response.status).toBe(401)
    expect(mocks.rateCheck).not.toHaveBeenCalled()
    expect(mocks.workspaceContext).not.toHaveBeenCalled()
  })

  it('caps authenticated bodies before protected loading', async () => {
    const response = await POST(createMockRequest('POST', { workspaceId: 'x'.repeat(64 * 1024) }))
    expect(response.status).toBe(413)
    expect(mocks.workspaceContext).not.toHaveBeenCalled()
    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { workspaceId: 'ws-1', organizationId: 'org-1' },
    { organizationId: '' },
    { workspaceId: 1 },
  ])('rejects absent, ambiguous or invalid scope %j', async (body) => {
    const response = await POST(createMockRequest('POST', body))
    expect(response.status).toBe(400)
    expect(mocks.workspaceContext).not.toHaveBeenCalled()
    expect(mocks.resolveOrganizationBilling).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('conceals a workspace the caller cannot access', async () => {
    permission.mockResolvedValue(null)
    const response = await POST(createMockRequest('POST', { workspaceId: 'ws-other' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'Workspace or organization context is required.',
    })
    expect(mocks.resolveBilling).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects removed organization members before billing or token creation', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    const response = await POST(createMockRequest('POST', { organizationId: 'org-other' }))
    expect(response.status).toBe(400)
    expect(mocks.resolveOrganizationBilling).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects inactive workspaces before billing', async () => {
    mocks.workspaceContext.mockRejectedValue(
      new OrchestrationError('not_found', 'Workspace not found')
    )
    const response = await POST(createMockRequest('POST', { workspaceId: 'ws-archived' }))
    expect(response.status).toBe(400)
    expect(mocks.resolveBilling).not.toHaveBeenCalled()
  })

  it('rates by actor with the existing bucket and retry header before parsing', async () => {
    mocks.rateCheck.mockResolvedValue({ allowed: false, retryAfterMs: 1501 })
    const response = await POST(createMockRequest('POST', {}))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('2')
    expect(mocks.rateCheck).toHaveBeenCalledWith('stt-token:user:member-1', {
      maxTokens: 30,
      refillRate: 3,
      refillIntervalMs: 72000,
    })
    expect(mocks.resolveOrganizationBilling).not.toHaveBeenCalled()
  })

  it('preserves the rate exemption when billing is disabled', async () => {
    setEnvFlags({ isBillingEnabled: false })
    const response = await POST(createMockRequest('POST', { organizationId: 'org-1' }))
    expect(response.status).toBe(200)
    expect(mocks.rateCheck).not.toHaveBeenCalled()
  })

  it.each(['actor', 'payer', 'member'])(
    'enforces the %s usage cap before contacting the provider',
    async (scope) => {
      mocks.checkUsage.mockResolvedValue({ isExceeded: true, message: 'Usage cap reached', scope })
      const response = await POST(createMockRequest('POST', { organizationId: 'org-1' }))
      expect(response.status).toBe(402)
      expect(await response.json()).toMatchObject({ error: 'Usage cap reached', scope })
      expect(fetch).not.toHaveBeenCalled()
      expect(mocks.recordUsage).not.toHaveBeenCalled()
    }
  )

  it('does not conceal membership infrastructure failures as missing membership', async () => {
    dbChainMockFns.limit.mockRejectedValue(new Error('database unavailable'))
    const response = await POST(createMockRequest('POST', { organizationId: 'org-1' }))
    expect(response.status).toBe(500)
    expect(mocks.resolveOrganizationBilling).not.toHaveBeenCalled()
  })

  it('does not issue tokens after billing attribution fails', async () => {
    mocks.resolveOrganizationBilling.mockRejectedValue(new Error('billing unavailable'))
    const response = await POST(createMockRequest('POST', { organizationId: 'org-1' }))
    expect(response.status).toBe(500)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves service-not-configured and upstream errors', async () => {
    setEnv({ ELEVENLABS_API_KEY: '' })
    expect((await POST(createMockRequest('POST', { organizationId: 'org-1' }))).status).toBe(503)
    setEnv({ ELEVENLABS_API_KEY: 'key' })
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ detail: 'Provider unavailable' }, { status: 503 })
    )
    const response = await POST(createMockRequest('POST', { organizationId: 'org-1' }))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'Provider unavailable' })
    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })

  it.each(['recordUsage', 'billOverage'] as const)(
    'keeps an issued token available when %s fails',
    async (failure) => {
      mocks[failure].mockRejectedValue(new Error('billing write failed'))
      const response = await POST(createMockRequest('POST', { organizationId: 'org-1' }))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ token: 'tok-123' })
      if (failure === 'recordUsage') expect(mocks.billOverage).not.toHaveBeenCalled()
    }
  )

  it('rejects non-session principals before any protected loading', async () => {
    for (const input of [{ workspaceId: 'ws-1' }, { organizationId: 'org-1' }]) {
      await expect(
        createSpeechToken.execute({
          principal: { kind: 'personal_api_key', userId: 'member-1', keyId: 'key-1' },
          input,
        })
      ).rejects.toThrow('cannot perform operation speech.token.create')
    }
    expect(mocks.workspaceContext).not.toHaveBeenCalled()
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
