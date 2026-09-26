import type { OrganizationDelegatedPrincipal, Principal } from '@sim/auth/principal'
import { member, organization, session, ssoDomain } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  authorizedWorkspaceUseCaseMock,
  authorizedWorkspaceUseCaseMockFns,
} from '@sim/testing/mocks/authorized-workspace-use-case.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  dns: vi.fn(),
  invalidate: vi.fn(),
  invalidateSso: vi.fn(),
}))
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock(
  '@/lib/core/application/authorized-workspace-use-case',
  () => authorizedWorkspaceUseCaseMock
)
vi.mock('@/lib/auth/sso/domain-verification', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/sso/domain-verification')>()),
  checkDomainTxtRecord: hoisted.dns,
}))
vi.mock('@/lib/auth/sso-policy', () => ({ invalidateSsoPolicyCache: hoisted.invalidateSso }))
vi.mock('@/lib/auth/security-policy', () => ({
  invalidateSecurityPolicyVersionCache: hoisted.invalidate,
}))

import {
  addOrganizationDomain,
  listOrganizationDomains,
  projectOrganizationDomainForTool,
  removeOrganizationDomain,
  verifyOrganizationDomain,
} from '@/lib/organizations/application/domain-settings'
import { revokeOrganizationSessions } from '@/lib/organizations/application/revoke-sessions'
import { organizationSecurityOperations } from '@/lib/organizations/application/security-operations'

const mocks = {
  ...hoisted,
  audit: authorizedWorkspaceUseCaseMockFns.mockRecordProjectedUseCaseAuditEntries,
  enterprise: billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan,
}

setEnvFlags({ isBillingEnabled: true })
afterAll(resetEnvFlagsMock)

const delegated: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date('2020-01-01'),
  expiresAt: new Date('2099-01-01'),
  resourceScope: { chatId: 'chat' },
}
const principal = createSessionPrincipal({ userId: 'actor', sessionId: 'current-session' })
const row = {
  id: 'domain',
  organizationId: 'org',
  domain: 'example.com',
  status: 'pending' as const,
  verificationToken: 'secret',
  verifiedAt: null,
  createdBy: 'actor',
  createdAt: new Date(),
  updatedAt: new Date(),
}
beforeEach(() => {
  resetDbChainMock()
  mocks.enterprise.mockResolvedValue(true)
  mocks.dns.mockResolvedValue('present')
})

describe('organization domain Settings operations', () => {
  it('allows member metadata reads but removes TXT proof even for delegated admins', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(ssoDomain, [row])
    const result = await listOrganizationDomains.execute({
      principal: delegated,
      input: { organizationId: 'org' },
    })
    expect(result.domains[0].verificationToken).toBeNull()
    expect(JSON.stringify(projectOrganizationDomainForTool(result.domains[0]))).not.toContain(
      'secret'
    )
  })
  it('bounds delegated domain enumeration to the organization cap', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(
      ssoDomain,
      Array.from({ length: 26 }, (_, i) => ({ ...row, id: `domain-${i}` }))
    )
    const result = await listOrganizationDomains.execute({
      principal: delegated,
      input: { organizationId: 'org' },
    })
    expect(result.domains).toHaveLength(25)
    expect(result.truncated).toBe(true)
    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(26)
  })
  it.each<Principal>([
    { ...delegated, audience: 'sim:knowledge' },
    { ...delegated, organizationId: 'other' },
    { ...delegated, expiresAt: new Date(0) },
    createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }),
  ])('refuses invalid delegated scope before domain access', async (caller) => {
    await expect(
      listOrganizationDomains.execute({ principal: caller, input: { organizationId: 'org' } })
    ).rejects.toThrow()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
  it('keeps all mutations administrator-only', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(member, [{ role: 'member' }])
    await expect(
      addOrganizationDomain.execute({
        principal: delegated,
        input: { organizationId: 'org', domain: 'example.com' },
      })
    ).rejects.toThrow('administrator')
    await expect(
      verifyOrganizationDomain.execute({
        principal: delegated,
        input: { organizationId: 'org', domainId: 'domain' },
      })
    ).rejects.toThrow('administrator')
    await expect(
      removeOrganizationDomain.execute({
        principal: delegated,
        input: { organizationId: 'org', domainId: 'domain' },
      })
    ).rejects.toThrow('administrator')
    expect(mocks.dns).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('does not give non-enterprise members any domains or proof', async () => {
    queueTableRows(member, [{ role: 'member' }])
    mocks.enterprise.mockResolvedValue(false)
    await expect(
      listOrganizationDomains.execute({ principal: delegated, input: { organizationId: 'org' } })
    ).resolves.toEqual({ isEnterprise: false, domains: [], truncated: false })
  })
  it.each(['remove', 'verify'] as const)(
    'invalidates the SSO requirement after a committed domain %s',
    async (action) => {
      queueTableRows(member, [{ role: 'admin' }])
      if (action === 'verify') {
        queueTableRows(ssoDomain, [row])
        queueTableRows(ssoDomain, [])
      }
      dbChainMockFns.returning.mockResolvedValueOnce(
        action === 'remove' ? [{ domain: row.domain }] : [{ ...row, status: 'verified' }]
      )
      const operation = action === 'remove' ? removeOrganizationDomain : verifyOrganizationDomain
      await operation.execute({ principal, input: { organizationId: 'org', domainId: 'domain' } })
      expect(mocks.invalidateSso).toHaveBeenCalledExactlyOnceWith('org')
      expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    }
  )
  it('does not invalidate SSO when domain removal rolls back', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    dbChainMockFns.transaction.mockRejectedValueOnce(new Error('rollback'))
    await expect(
      removeOrganizationDomain.execute({
        principal,
        input: { organizationId: 'org', domainId: 'domain' },
      })
    ).rejects.toThrow('rollback')
    expect(mocks.invalidateSso).not.toHaveBeenCalled()
  })
  it('does not mark a domain verified on unavailable DNS', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(ssoDomain, [row])
    mocks.dns.mockResolvedValue('unavailable')
    await expect(
      verifyOrganizationDomain.execute({
        principal: delegated,
        input: { organizationId: 'org', domainId: 'domain' },
      })
    ).rejects.toMatchObject({ status: 503 })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})

describe('organization session revocation', () => {
  it('requires genuine current browser session rather than inventing one for Copilot', async () => {
    expect(organizationSecurityOperations.revokeSessions.principalKinds).toEqual(['session'])
    await expect(
      revokeOrganizationSessions.execute({ principal: delegated, input: { organizationId: 'org' } })
    ).rejects.toThrow()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
  it('refuses a missing current session before destructive work', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(organization, [{ name: 'Org' }])
    queueTableRows(session, [])
    await expect(
      revokeOrganizationSessions.execute({ principal, input: { organizationId: 'org' } })
    ).rejects.toThrow('Current session')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
  it('spares the current session, impersonation sessions and impersonator while atomically bumping policy', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(organization, [{ name: 'Org' }])
    queueTableRows(session, [{ impersonatedBy: 'platform-admin' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'revoked' }])
    await expect(
      revokeOrganizationSessions.execute({ principal, input: { organizationId: 'org' } })
    ).resolves.toEqual({ revokedSessions: 1, organizationName: 'Org' })
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    const predicates = JSON.stringify(dbChainMockFns.where.mock.calls)
    expect(predicates).toContain('current-session')
    expect(predicates).toContain('platform-admin')
    expect(predicates).toContain('impersonatedBy')
    expect(mocks.invalidate).toHaveBeenCalledWith('org')
    expect(mocks.audit).toHaveBeenCalledWith(
      organizationSecurityOperations.revokeSessions,
      null,
      principal,
      undefined,
      [expect.objectContaining({ metadata: { revokedSessions: 1 } })],
      'org'
    )
  })
})
