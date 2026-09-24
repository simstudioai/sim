/** @vitest-environment node */
import { member, organizationSecret, organizationSecretSource } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, PUT } from '@/app/api/organizations/[id]/secret-source/route'
import { GET as getSecrets, PATCH } from '@/app/api/organizations/[id]/secret-source/secrets/route'

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: vi.fn().mockResolvedValue(null),
}))

const context = { params: Promise.resolve({ id: 'org' }) }
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'actor' },
    session: { id: 'session' },
  })
})
describe('Generic Secrets HTTP boundary', () => {
  it('requires a session before parsing a mutation', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await PATCH(createMockRequest('PATCH', { invalid: true }), context)
    expect(response.status).toBe(401)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
  it('returns the source to an organization member without caching', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organizationSecretSource, [{ id: 'source', mode: 'member' }])
    const response = await GET(createMockRequest('GET'), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ source: { id: 'source', mode: 'member' } })
  })
  it('refuses source changes by ordinary members', async () => {
    queueTableRows(member, [{ role: 'member' }])
    const response = await PUT(
      createMockRequest('PUT', { sourceId: null, mode: 'organization' }),
      context
    )
    expect(response.status).toBe(403)
    expect(dbChainMockFns.insert).not.toHaveBeenCalledWith(organizationSecretSource)
  })
  it('refuses the organization editor to an ordinary member before loading secrets', async () => {
    queueTableRows(member, [{ role: 'member' }])
    const response = await getSecrets(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/organizations/org/secret-source/secrets?mode=organization'
      ),
      context
    )
    expect(response.status).toBe(403)
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(organizationSecret)
  })
})
