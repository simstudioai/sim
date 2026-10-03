import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { GET as organizationMetadata } from '@/app/.well-known/oauth-protected-resource/api/mcp/search/organizations/[organizationId]/route'

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')

afterAll(resetEnvFlagsMock)
describe('Search protected-resource metadata', () => {
  it('discovers an organization endpoint without disclosing any organization records', async () => {
    setEnvFlags({ isAuthDisabled: false })
    const response = await organizationMetadata(
      new NextRequest('https://sim.test/'),
      createRouteContext({ organizationId: 'org-1' })
    )
    expect(await response.json()).toEqual({
      resource: 'https://sim.test/api/mcp/search/organizations/org-1',
      resource_name: 'Sim Search',
      authorization_servers: ['https://sim.test/api/auth'],
      scopes_supported: ['search:read', 'offline_access'],
      bearer_methods_supported: ['header'],
    })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('does not advertise disabled OAuth', async () => {
    setEnvFlags({ isAuthDisabled: true })
    const response = await organizationMetadata(
      new NextRequest('https://sim.test/'),
      createRouteContext({ organizationId: 'org-1' })
    )
    expect(response.status).toBe(404)
  })
})
