/** @vitest-environment node */
import type {
  OrganizationDelegatedPrincipal,
  Principal,
  SessionPrincipal,
} from '@sim/auth/principal'
import { member, organization } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  setEnvFlags,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  entitled: vi.fn(),
  foreignTargets: vi.fn(),
  clamp: vi.fn(),
  invalidateSession: vi.fn(),
  invalidateSecurity: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationFeatureEntitled: mocks.entitled,
  isOrganizationOnEnterprisePlan: mocks.entitled,
}))
vi.mock('@/lib/billing/retention', () => ({
  getForeignWorkspaceTargetsReason: mocks.foreignTargets,
}))
vi.mock('@/lib/auth/session-policy', () => ({
  eagerClampOrgSessions: mocks.clamp,
  invalidateSessionPolicyCache: mocks.invalidateSession,
}))
vi.mock('@/lib/auth/security-policy', () => ({
  invalidateSecurityPolicyVersionCache: mocks.invalidateSecurity,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: vi.fn().mockResolvedValue(null),
}))
vi.mock('@sim/audit', () => ({
  recordAudit: mocks.audit,
  AuditAction: {
    ORGANIZATION_UPDATED: 'organization.updated',
    ORGANIZATION_SESSION_POLICY_UPDATED: 'organization.session_policy.updated',
  },
  AuditResourceType: { ORGANIZATION: 'organization' },
}))

import {
  getOrganizationDataRetention,
  getOrganizationSessionPolicy,
  getOrganizationWhitelabel,
  updateOrganizationDataRetention,
  updateOrganizationSessionPolicy,
  updateOrganizationWhitelabel,
} from '@/lib/organizations/application/configuration'
import {
  GET as getRetentionRoute,
  PUT as updateRetentionRoute,
} from '@/app/api/organizations/[id]/data-retention/route'
import {
  GET as getWhitelabelRoute,
  PUT as updateWhitelabelRoute,
} from '@/app/api/organizations/[id]/whitelabel/route'

const session: SessionPrincipal = { kind: 'session', userId: 'actor', sessionId: 'session' }
function delegated(): OrganizationDelegatedPrincipal {
  return {
    kind: 'organization_delegated',
    serviceId: 'copilot',
    subjectUserId: 'actor',
    organizationId: 'org',
    delegationId: 'tool-call',
    audience: 'sim:settings',
    issuedAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { chatId: 'chat' },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  setEnvFlags({ isBillingEnabled: true })
  mocks.entitled.mockResolvedValue(true)
  mocks.foreignTargets.mockResolvedValue(null)
  mocks.clamp.mockResolvedValue(undefined)
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'actor' },
    session: { id: 'session' },
  })
})

describe('organization configuration HTTP adapters', () => {
  const routeContext = { params: Promise.resolve({ id: 'org' }) }

  it.each([getWhitelabelRoute, getRetentionRoute])(
    'authenticates member reads before data access',
    async (route) => {
      authMockFns.mockGetSession.mockResolvedValue(null)
      const response = await route(createMockRequest('GET'), routeContext)
      expect(response.status).toBe(401)
      expect(dbChainMockFns.from).not.toHaveBeenCalled()
    }
  )

  it.each([updateWhitelabelRoute, updateRetentionRoute])(
    'authenticates updates before parsing invalid bodies',
    async (route) => {
      authMockFns.mockGetSession.mockResolvedValue(null)
      const response = await route(createMockRequest('PUT', []), routeContext)
      expect(response.status).toBe(401)
      expect(dbChainMockFns.from).not.toHaveBeenCalled()
    }
  )

  it('retains the whitelabel envelope, trims incoming names and clears only explicit nulls', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organization, [{ settings: { brandName: 'Old' } }])
    const read = await getWhitelabelRoute(createMockRequest('GET'), routeContext)
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ success: true, data: { brandName: 'Old' } })
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(organization, [
      { name: 'Acme', settings: { brandName: 'Old', logoUrl: '/logo' } },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ settings: { brandName: 'New' } }])
    const response = await updateWhitelabelRoute(
      createMockRequest('PUT', { brandName: '  New  ', logoUrl: null }),
      routeContext
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { brandName: 'New' } })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ whitelabelSettings: { brandName: 'New' } })
    )
  })

  it('preserves retention member read and enterprise denial before update', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organization, [{ settings: { logRetentionHours: 24 } }])
    mocks.entitled.mockResolvedValue(false)
    const read = await getRetentionRoute(createMockRequest('GET'), routeContext)
    expect(read.status).toBe(200)
    const body = await read.json()
    expect(body.success).toBe(true)
    expect(body.data.configured.logRetentionHours).toBe(24)
    expect(body.data.effective).toEqual(body.data.defaults)
    queueTableRows(member, [{ role: 'owner' }])
    const response = await updateRetentionRoute(
      createMockRequest('PUT', { logRetentionHours: null }),
      routeContext
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: 'Data Retention is available on Enterprise plans only',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('organization configuration authorization', () => {
  it.each([getOrganizationWhitelabel, getOrganizationSessionPolicy, getOrganizationDataRetention])(
    'preserves member reads and 403 membership refusal for $operation.id',
    async (useCase) => {
      queueTableRows(member, [])
      await expect(
        useCase.execute({ principal: session, input: { organizationId: 'org' } })
      ).rejects.toMatchObject({
        code: 'forbidden',
        message: 'Forbidden - Not a member of this organization',
      })
      expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
      expect(mocks.audit).not.toHaveBeenCalled()
    }
  )

  it('keeps missing canonical organization distinct from missing membership', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organization, [])
    await expect(
      getOrganizationWhitelabel.execute({ principal: session, input: { organizationId: 'org' } })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it.each<Principal>([
    { kind: 'workspace_api_key', workspaceId: 'workspace', keyId: 'key' },
    { ...delegated(), audience: 'sim:search' },
    { ...delegated(), organizationId: 'foreign' },
    { ...delegated(), expiresAt: new Date(0) },
  ])('rejects invalid authority before protected reads', async (principal) => {
    await expect(
      getOrganizationWhitelabel.execute({ principal, input: { organizationId: 'org' } })
    ).rejects.toBeInstanceOf(Error)
    expect(dbChainMockFns.from).not.toHaveBeenCalled()
  })

  it('reauthorizes delegated current membership on every call', async () => {
    const principal = delegated()
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organization, [{ settings: { brandName: 'Acme' } }])
    await expect(
      getOrganizationWhitelabel.execute({ principal, input: { organizationId: 'org' } })
    ).resolves.toEqual({ brandName: 'Acme' })
    queueTableRows(member, [])
    await expect(
      getOrganizationWhitelabel.execute({ principal, input: { organizationId: 'org' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses member writes before entitlement or mutation', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await expect(
      updateOrganizationWhitelabel.execute({
        principal: session,
        input: { organizationId: 'org', settings: { brandName: 'New' } },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Forbidden - Only organization owners and admins can update whitelabel settings',
    })
    expect(mocks.entitled).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('organization configuration behavior', () => {
  it('merges whitelabel omissions, deletes nulls, and audits the delegated actor', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(organization, [
      { name: 'Acme', settings: { brandName: 'Old', logoUrl: '/logo', hidePoweredBySim: true } },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { settings: { brandName: 'New', hidePoweredBySim: true } },
    ])
    const result = await updateOrganizationWhitelabel.execute({
      principal: delegated(),
      input: { organizationId: 'org', settings: { brandName: 'New', logoUrl: null } },
    })
    expect(result.data).toEqual({ brandName: 'New', hidePoweredBySim: true })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        whitelabelSettings: { brandName: 'New', hidePoweredBySim: true },
      })
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor',
        resourceId: 'org',
        resourceName: 'Acme',
        metadata: expect.objectContaining({
          changes: ['brandName', 'logoUrl'],
          operation: 'organizations.whitelabel.update',
        }),
      })
    )
  })

  it('retains untouched retention values and rejects foreign targets before update', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(organization, [
      { name: 'Acme', settings: { logRetentionHours: 240, taskCleanupHours: 72 } },
    ])
    mocks.foreignTargets.mockResolvedValueOnce('Workspace targets must belong to this organization')
    await expect(
      updateOrganizationDataRetention.execute({
        principal: session,
        input: { organizationId: 'org', settings: { logRetentionHours: null } },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()

    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(organization, [
      { name: 'Acme', settings: { logRetentionHours: 240, taskCleanupHours: 72 } },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { settings: { logRetentionHours: null, taskCleanupHours: 72 } },
    ])
    const result = await updateOrganizationDataRetention.execute({
      principal: session,
      input: { organizationId: 'org', settings: { logRetentionHours: null } },
    })
    expect(result.data.configured).toMatchObject({ logRetentionHours: null, taskCleanupHours: 72 })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        dataRetentionSettings: expect.objectContaining({
          logRetentionHours: null,
          taskCleanupHours: 72,
        }),
      })
    )
  })

  it('keeps session clamp in the policy transaction and suppresses post-success effects on failure', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(organization, [{ name: 'Acme' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'org' }])
    mocks.clamp.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(
      updateOrganizationSessionPolicy.execute({
        principal: session,
        input: { organizationId: 'org', settings: { maxSessionHours: 72, idleTimeoutHours: 48 } },
      })
    ).rejects.toThrow('database unavailable')
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.clamp).toHaveBeenCalledWith(
      'org',
      { maxSessionHours: 72, idleTimeoutHours: 48 },
      expect.anything()
    )
    expect(mocks.invalidateSession).not.toHaveBeenCalled()
    expect(mocks.invalidateSecurity).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('reports non-enterprise configured retention separately from effective defaults', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organization, [{ settings: { logRetentionHours: 24 } }])
    mocks.entitled.mockResolvedValue(false)
    const result = await getOrganizationDataRetention.execute({
      principal: session,
      input: { organizationId: 'org' },
    })
    expect(result.isEnterprise).toBe(false)
    expect(result.configured.logRetentionHours).toBe(24)
    expect(result.effective).toEqual(result.defaults)
  })
})
