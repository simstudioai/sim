/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { hasMcpServerConnectionChanged } from '@/lib/mcp/orchestration/server-lifecycle'

const currentConnection = {
  url: 'https://memory.example.com/mcp',
  transport: 'streamable-http',
  headers: {
    Authorization: 'Bearer {{MEMORY_KEY}}',
    'X-Workspace': 'workspace-1',
  },
  timeout: 30000,
  retries: 3,
  enabled: true,
  authType: 'headers',
}

describe('hasMcpServerConnectionChanged', () => {
  it('treats echoed connection settings as unchanged regardless of header key order', () => {
    expect(
      hasMcpServerConnectionChanged(currentConnection, {
        url: currentConnection.url,
        transport: currentConnection.transport,
        headers: {
          'X-Workspace': 'workspace-1',
          Authorization: 'Bearer {{MEMORY_KEY}}',
        },
        timeout: currentConnection.timeout ?? undefined,
        retries: currentConnection.retries ?? undefined,
        enabled: currentConnection.enabled,
        authType: currentConnection.authType as 'headers',
      })
    ).toBe(false)
  })

  it.each([
    [{ url: 'https://other.example.com/mcp' }],
    [{ transport: 'sse' }],
    [{ headers: { Authorization: 'Bearer changed' } }],
    [{ timeout: 15000 }],
    [{ retries: 1 }],
    [{ enabled: false }],
    [{ authType: 'oauth' as const }],
  ])('detects an actual connection setting change', (updates) => {
    expect(hasMcpServerConnectionChanged(currentConnection, updates)).toBe(true)
  })

  it('detects an OAuth credential change', () => {
    expect(hasMcpServerConnectionChanged(currentConnection, {}, true)).toBe(true)
  })
})
