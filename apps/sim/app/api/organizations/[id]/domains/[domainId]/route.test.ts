import { member } from '@sim/db/schema'
import { createMockRequest, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

vi.mock('@sim/audit', () => auditMock)

import { DELETE } from '@/app/api/organizations/[id]/domains/[domainId]/route'

const mockGetSession = authMockFns.mockGetSession
const mockIsEnterprise = billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan
const mockRecordAudit = auditMockFns.mockRecordAudit

const routeContext = createRouteContext({ id: 'org-1', domainId: 'd1' })

describe('remove org domain route', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: true })
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Admin', email: 'admin@acme.dev' },
      session: { id: 'session-1' },
    })
    mockIsEnterprise.mockResolvedValue(true)
  })

  it('403s for non-admins', async () => {
    queueTableRows(member, [{ role: 'member' }])
    const res = await DELETE(createMockRequest('DELETE'), routeContext)
    expect(res.status).toBe(403)
  })

  it('403s for non-Enterprise orgs', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    mockIsEnterprise.mockResolvedValue(false)
    const res = await DELETE(createMockRequest('DELETE'), routeContext)
    expect(res.status).toBe(403)
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  /**
   * `domainVerified` on a provider is what authorizes auto-linking an SSO sign-in
   * to an existing same-email account. Removing the proof has to withdraw that
   * trust in the same transaction, or the authorization outlives the ownership.
   */
  it('revokes SSO domain trust for providers on the removed domain', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ domain: 'acme.com' }])
    const res = await DELETE(createMockRequest('DELETE'), routeContext)
    expect(res.status).toBe(200)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ domainVerified: false })
  })

  /**
   * Migration 0268 grandfathered providers by stripping a leading `*.`, so a
   * provider can be stored as `*.acme.com` while its verified row holds
   * `acme.com`. A naive equality match would leave that provider trusted after
   * the proof was deleted.
   */
  it('matches the provider domain the way it was grandfathered (wildcard-tolerant)', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ domain: 'acme.com' }])
    await DELETE(createMockRequest('DELETE'), routeContext)
    const revokeWhere = dbChainMockFns.where.mock.calls.find(([condition]) =>
      JSON.stringify(condition ?? '').includes('regexp_replace')
    )
    expect(revokeWhere).toBeDefined()
  })

  it('does not revoke trust when no domain was removed', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    dbChainMockFns.returning.mockResolvedValueOnce([]) // delete matched nothing
    const res = await DELETE(createMockRequest('DELETE'), routeContext)
    expect(res.status).toBe(404)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })
})
