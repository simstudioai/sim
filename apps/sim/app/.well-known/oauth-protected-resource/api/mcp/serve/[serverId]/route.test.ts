/** @vitest-environment node */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))

import { GET } from '@/app/.well-known/oauth-protected-resource/api/mcp/serve/[serverId]/route'

afterAll(resetEnvFlagsMock)

describe('workflow MCP protected-resource metadata', () => {
  it('names the workflow MCP server URL as a Sim API resource', async () => {
    setEnvFlags({ isAuthDisabled: false })
    const response = await GET(new NextRequest('https://sim.test/'), {
      params: Promise.resolve({ serverId: 'server-1' }),
    })
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
    const response = await GET(new NextRequest('https://sim.test/'), {
      params: Promise.resolve({ serverId: 'server-1' }),
    })
    expect(response.status).toBe(404)
  })
})
