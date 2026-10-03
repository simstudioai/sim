import { resetEnvFlagsMock, resetUrlsMock, setEnvFlags, urlsMockFns } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/.well-known/oauth-protected-resource/api/mcp/serve/[serverId]/route'

beforeEach(() => {
  urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')
})

afterAll(() => {
  resetEnvFlagsMock()
  resetUrlsMock()
})

describe('workflow MCP protected-resource metadata', () => {
  it('names the workflow MCP server URL as a Sim API resource', async () => {
    setEnvFlags({ isAuthDisabled: false })
    const response = await GET(
      new NextRequest('https://sim.test/'),
      createRouteContext({ serverId: 'server-1' })
    )
    expect(await response.json()).toEqual({
      resource: 'https://sim.test/api/mcp/serve/server-1',
      resource_name: 'Sim workflow MCP server',
      authorization_servers: ['https://sim.test/api/auth'],
      scopes_supported: ['api:read', 'api:write'],
      bearer_methods_supported: ['header'],
    })
  })

  it('does not advertise disabled OAuth', async () => {
    setEnvFlags({ isAuthDisabled: true })
    const response = await GET(
      new NextRequest('https://sim.test/'),
      createRouteContext({ serverId: 'server-1' })
    )
    expect(response.status).toBe(404)
  })
})
