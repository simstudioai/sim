import { member, organizationSecret, organizationSecretSource } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PUT } from '@/app/api/organizations/[id]/secret-source/route'
import { GET as getSecrets } from '@/app/api/organizations/[id]/secret-source/secrets/route'

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

const context = createRouteContext({ id: 'org' })
beforeEach(() => {
  resetDbChainMock()
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'actor' },
    session: { id: 'session' },
  })
})
describe('Generic Secrets HTTP boundary', () => {
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
