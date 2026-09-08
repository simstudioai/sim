/** @vitest-environment node */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))

import { GET as workspaceMetadata } from '@/app/.well-known/oauth-protected-resource/api/mcp/search/[workspaceId]/route'
import { GET as organizationMetadata } from '@/app/.well-known/oauth-protected-resource/api/mcp/search/organizations/[organizationId]/route'

afterAll(resetEnvFlagsMock)
describe('Search protected-resource metadata', () => {
  it('discovers an organization endpoint without disclosing any organization records', async () => {
    setEnvFlags({ isAuthDisabled: false })
    const response = await organizationMetadata(new NextRequest('https://sim.test/'), {
      params: Promise.resolve({ organizationId: 'org-1' }),
    })
    expect(await response.json()).toEqual({
      resource: 'https://sim.test/api/mcp/search/organizations/org-1',
      resource_name: 'Sim Search',
      authorization_servers: ['https://sim.test/api/auth'],
      scopes_supported: ['search:read', 'offline_access'],
      bearer_methods_supported: ['header'],
    })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('advertises the exact workspace resource', async () => {
    setEnvFlags({ isAuthDisabled: false })
    const response = await workspaceMetadata(new NextRequest('https://sim.test/'), {
      params: Promise.resolve({ workspaceId: 'workspace-1' }),
    })
    expect((await response.json()).resource).toBe('https://sim.test/api/mcp/search/workspace-1')
  })

  it('does not advertise disabled OAuth', async () => {
    setEnvFlags({ isAuthDisabled: true })
    const response = await workspaceMetadata(new NextRequest('https://sim.test/'), {
      params: Promise.resolve({ workspaceId: 'workspace-1' }),
    })
    expect(response.status).toBe(404)
  })
})
