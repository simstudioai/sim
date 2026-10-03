import { resetEnvFlagsMock, resetUrlsMock, setEnvFlags, urlsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/.well-known/oauth-protected-resource/api/mcp/route'

beforeEach(() => {
  urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')
})

afterAll(() => {
  resetEnvFlagsMock()
  resetUrlsMock()
})

describe('Sim MCP protected-resource metadata', () => {
  it('names the Sim MCP server as a Sim API resource', async () => {
    setEnvFlags({ isAuthDisabled: false })
    const response = await GET(new NextRequest('https://sim.test/'), undefined)
    expect(await response.json()).toEqual({
      resource: 'https://sim.test/api/mcp',
      resource_name: 'Sim',
      authorization_servers: ['https://sim.test/api/auth'],
      scopes_supported: ['api:read', 'api:write'],
      bearer_methods_supported: ['header'],
    })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('does not advertise disabled OAuth', async () => {
    setEnvFlags({ isAuthDisabled: true })
    const response = await GET(new NextRequest('https://sim.test/'), undefined)
    expect(response.status).toBe(404)
  })
})
