import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { resetUrlsMock, urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { isOffAppHost, resolveSimMcpHostPath } from '@/lib/api/mcp/host-routing'
import { getSimMcpUrl } from '@/lib/api/mcp/urls'

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.ai')

afterAll(() => {
  resetEnvMock()
  resetUrlsMock()
})

describe('Sim MCP host routing', () => {
  beforeEach(() => {
    setEnv({ SIM_MCP_URL: undefined })
  })

  it('serves the MCP server from the app origin by default', () => {
    expect(getSimMcpUrl()).toBe('https://sim.ai/api/mcp')
    expect(resolveSimMcpHostPath('sim.ai', '/api/mcp')).toBe('/api/mcp')
    expect(resolveSimMcpHostPath('sim.ai', '/workspace')).toBeNull()
    expect(resolveSimMcpHostPath('mcp.sim.ai', '/mcp')).toBeNull()
  })

  describe('on a dedicated host', () => {
    beforeEach(() => {
      setEnv({ SIM_MCP_URL: 'https://mcp.sim.ai/mcp/' })
    })

    it.each([
      ['/mcp', '/api/mcp'],
      ['/mcp/openai', '/api/mcp/openai'],
      [
        '/.well-known/oauth-protected-resource/mcp/openai',
        '/.well-known/oauth-protected-resource/api/mcp/openai',
      ],
      ['/.well-known/openai-apps-challenge', '/.well-known/openai-apps-challenge'],
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

    it('tells the MCP host from an app on the same hostname but another port', () => {
      setEnv({ SIM_MCP_URL: 'http://localhost:3001/mcp' })
      expect(resolveSimMcpHostPath('localhost:3000', '/workspace')).toBeNull()
      expect(resolveSimMcpHostPath('localhost:3001', '/mcp')).toBe('/api/mcp')
      expect(resolveSimMcpHostPath('localhost:3001', '/workspace')).toBe('not_found')
    })

    it('serves the app host as before, without a second MCP URL', () => {
      expect(resolveSimMcpHostPath('sim.ai', '/mcp')).toBeNull()
      expect(resolveSimMcpHostPath('sim.ai', '/workspace')).toBeNull()
      expect(resolveSimMcpHostPath('sim.ai', '/api/mcp')).toBe('not_found')
      expect(resolveSimMcpHostPath('sim.ai', '/api/mcp/openai')).toBe('not_found')
      expect(
        resolveSimMcpHostPath('sim.ai', '/.well-known/oauth-protected-resource/api/mcp/openai')
      ).toBe('not_found')
      expect(resolveSimMcpHostPath('sim.ai', '/.well-known/oauth-protected-resource/api/mcp')).toBe(
        'not_found'
      )
      expect(resolveSimMcpHostPath('sim.ai', '/api/mcp/search/organizations/org-1')).toBeNull()
    })
  })
})

describe('routes the proxy does not run on', () => {
  const request = (host: string, path: string) => ({
    headers: new Headers({ host }),
    url: `https://${host}${path}`,
  })

  afterAll(() => {
    setEnv({ SIM_MCP_URL: undefined })
  })

  it('refuses the desktop upload routes on a dedicated MCP host, and serves them on the app host', () => {
    setEnv({ SIM_MCP_URL: 'https://mcp.sim.ai/mcp/' })

    expect(isOffAppHost(request('mcp.sim.ai', '/api/desktop/tool/import'))).toBe(true)
    expect(isOffAppHost(request('mcp.sim.ai', '/api/desktop/tool/file'))).toBe(true)
    expect(isOffAppHost(request('sim.ai', '/api/desktop/tool/import'))).toBe(false)
  })

  it('serves them everywhere while the MCP server shares the app host', () => {
    setEnv({ SIM_MCP_URL: undefined })

    expect(isOffAppHost(request('sim.ai', '/api/desktop/tool/import'))).toBe(false)
  })
})
