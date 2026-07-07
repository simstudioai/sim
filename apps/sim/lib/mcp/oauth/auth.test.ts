/**
 * @vitest-environment node
 */
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuth, mockCreateSsrfGuardedMcpFetch, mockGuardedFetch } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCreateSsrfGuardedMcpFetch: vi.fn(),
  mockGuardedFetch: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: mockAuth,
}))
vi.mock('@/lib/mcp/pinned-fetch', () => ({
  createSsrfGuardedMcpFetch: mockCreateSsrfGuardedMcpFetch,
}))

import { mcpAuthGuarded } from '@/lib/mcp/oauth/auth'

describe('mcpAuthGuarded', () => {
  const provider = {} as OAuthClientProvider

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateSsrfGuardedMcpFetch.mockReturnValue(mockGuardedFetch)
    mockAuth.mockResolvedValue('AUTHORIZED')
  })

  it('defaults fetchFn to the SSRF-guarded fetch', async () => {
    await mcpAuthGuarded(provider, { serverUrl: 'https://mcp.example.com/mcp' })

    expect(mockCreateSsrfGuardedMcpFetch).toHaveBeenCalledTimes(1)
    expect(mockAuth).toHaveBeenCalledWith(provider, {
      serverUrl: 'https://mcp.example.com/mcp',
      fetchFn: mockGuardedFetch,
    })
  })

  it('lets a caller-supplied fetchFn override the default', async () => {
    const overrideFetch = vi.fn()

    await mcpAuthGuarded(provider, {
      serverUrl: 'https://mcp.example.com/mcp',
      fetchFn: overrideFetch,
    })

    expect(mockAuth).toHaveBeenCalledWith(provider, {
      serverUrl: 'https://mcp.example.com/mcp',
      fetchFn: overrideFetch,
    })
  })

  it('falls back to the SSRF-guarded fetch when fetchFn is explicitly undefined', async () => {
    await mcpAuthGuarded(provider, {
      serverUrl: 'https://mcp.example.com/mcp',
      fetchFn: undefined,
    })

    expect(mockCreateSsrfGuardedMcpFetch).toHaveBeenCalledTimes(1)
    expect(mockAuth).toHaveBeenCalledWith(provider, {
      serverUrl: 'https://mcp.example.com/mcp',
      fetchFn: mockGuardedFetch,
    })
  })
})
