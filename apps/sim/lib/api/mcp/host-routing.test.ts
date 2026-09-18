/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mcpUrl: undefined as string | undefined }))

vi.mock('@/lib/core/config/env', () => ({
  getEnv: (name: string) => (name === 'SIM_MCP_URL' ? mocks.mcpUrl : undefined),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.ai' }))

import { resolveSimMcpHostPath } from '@/lib/api/mcp/host-routing'
import { getSimMcpUrl } from '@/lib/api/mcp/urls'

describe('Sim MCP host routing', () => {
  beforeEach(() => {
    mocks.mcpUrl = undefined
  })

  it('serves the MCP server from the app origin by default', () => {
    expect(getSimMcpUrl()).toBe('https://sim.ai/api/mcp')
    expect(resolveSimMcpHostPath('sim.ai', '/api/mcp')).toBe('/api/mcp')
    expect(resolveSimMcpHostPath('sim.ai', '/workspace')).toBeNull()
    expect(resolveSimMcpHostPath('mcp.sim.ai', '/mcp')).toBeNull()
  })

  describe('on a dedicated host', () => {
    beforeEach(() => {
      mocks.mcpUrl = 'https://mcp.sim.ai/mcp/'
    })

    it('uses the configured URL as the canonical resource', () => {
      expect(getSimMcpUrl()).toBe('https://mcp.sim.ai/mcp')
    })

    it.each([
      ['/mcp', '/api/mcp'],
      [
        '/.well-known/oauth-protected-resource/mcp',
        '/.well-known/oauth-protected-resource/api/mcp',
      ],
      ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server'],
    ])('maps %s to %s', (pathname, target) => {
      expect(resolveSimMcpHostPath('mcp.sim.ai', pathname)).toBe(target)
      expect(resolveSimMcpHostPath('MCP.SIM.AI', pathname)).toBe(target)
    })

    it.each(['/', '/login', '/workspace/ws-1', '/api/mcp', '/api/v2/workspaces', '/mcp/'])(
      'exposes nothing else: %s',
      (pathname) => {
        expect(resolveSimMcpHostPath('mcp.sim.ai', pathname)).toBe('not_found')
      }
    )

    it.each(['mcp.sim.ai:443', 'mcp.sim.ai.', 'MCP.SIM.AI.:443'])(
      'recognizes the host spelled %s',
      (host) => {
        expect(resolveSimMcpHostPath(host, '/login')).toBe('not_found')
        expect(resolveSimMcpHostPath(host, '/mcp')).toBe('/api/mcp')
      }
    )

    it('serves the app host as before, without a second MCP URL', () => {
      expect(resolveSimMcpHostPath('sim.ai', '/mcp')).toBeNull()
      expect(resolveSimMcpHostPath('sim.ai', '/workspace')).toBeNull()
      expect(resolveSimMcpHostPath('sim.ai', '/api/mcp')).toBe('not_found')
      expect(resolveSimMcpHostPath('sim.ai', '/.well-known/oauth-protected-resource/api/mcp')).toBe(
        'not_found'
      )
      expect(resolveSimMcpHostPath('sim.ai', '/api/mcp/search/organizations/org-1')).toBeNull()
    })
  })
})
