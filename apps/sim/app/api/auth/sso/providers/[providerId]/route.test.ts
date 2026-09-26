import {
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Authorization and the primary switch are the use case's; its own tests and the PostgreSQL suite cover them. */
vi.mock('@/lib/auth/sso/application/set-primary-provider', () => ({
  setPrimarySsoProviderOperation: { id: 'organization.sso.set_primary_provider' },
  setPrimarySsoProvider: {
    operation: { id: 'organization.sso.set_primary_provider' },
    execute: vi.fn(),
  },
}))

import { DELETE } from '@/app/api/auth/sso/providers/[providerId]/route'

const mockGetSession = authMockFns.mockGetSession

const context = createRouteContext({ providerId: 'acme-okta' })
const request = () => createMockRequest('DELETE')

describe('DELETE /api/auth/sso/providers/[providerId]', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'row-1' }])
  })

  it('clears the name of a domain that made the deleted provider primary', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', userId: 'u1', domain: 'acme.com' },
    ])
    queueTableRows(schemaMock.member, [{ role: 'owner' }])
    const res = await DELETE(request(), context)
    expect(res.status).toBe(200)
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.ssoDomain)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ primaryProviderId: null })
    )
  })

  it('leaves domains alone when deleting a personal provider', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: null, userId: 'u1', domain: 'acme.com' },
    ])
    const res = await DELETE(request(), context)
    expect(res.status).toBe(200)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it("refuses an organization provider to a member who is not the organization's admin", async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: 'org1', userId: 'u-other', domain: 'acme.com' },
    ])
    queueTableRows(schemaMock.member, [{ role: 'member' }])
    const res = await DELETE(request(), context)
    expect(res.status).toBe(403)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('lets only the creator delete a personal provider', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: null, userId: 'u-other', domain: 'acme.com' },
    ])
    const refused = await DELETE(request(), context)
    expect(refused.status).toBe(403)

    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'row-1' }])
    queueTableRows(schemaMock.ssoProvider, [
      { id: 'row-1', organizationId: null, userId: 'u1', domain: 'acme.com' },
    ])
    const allowed = await DELETE(request(), context)
    expect(allowed.status).toBe(200)
  })
})
