/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { assertValidMcpServerToolBindings } from '@/lib/mcp/shared'

describe('assertValidMcpServerToolBindings', () => {
  it('accepts distinct server-wide bindings and unrelated individual tools', () => {
    expect(() =>
      assertValidMcpServerToolBindings([
        { type: 'mcp-server-advanced', params: { serverId: 'mcp-a' } },
        { type: 'mcp-server-advanced', params: { serverId: 'mcp-b' } },
        { type: 'mcp', params: { serverId: 'mcp-c', toolName: 'lookup' } },
      ])
    ).not.toThrow()
  })

  it('rejects duplicate server-wide bindings', () => {
    expect(() =>
      assertValidMcpServerToolBindings([
        { type: 'mcp-server-advanced', params: { serverId: 'mcp-a' } },
        { type: 'mcp-server-advanced', params: { serverId: 'mcp-a' } },
      ])
    ).toThrow('Duplicate MCP Server (Advanced) binding for mcp-a')
  })

  it('rejects mixing a server-wide binding with individual tools from that server', () => {
    expect(() =>
      assertValidMcpServerToolBindings([
        { type: 'mcp', params: { serverId: 'mcp-a', toolName: 'lookup' } },
        { type: 'mcp-server-advanced', params: { serverId: 'mcp-a' } },
      ])
    ).toThrow('cannot be attached as both an advanced server and individual tools')
  })

  it('ignores disabled bindings when checking conflicts', () => {
    expect(() =>
      assertValidMcpServerToolBindings([
        { type: 'mcp', params: { serverId: 'mcp-a', toolName: 'lookup' } },
        {
          type: 'mcp-server-advanced',
          params: { serverId: 'mcp-a' },
          usageControl: 'none',
        },
      ])
    ).not.toThrow()
  })

  it('fails fast on a malformed active server-wide binding', () => {
    expect(() =>
      assertValidMcpServerToolBindings([{ type: 'mcp-server-advanced', params: { serverId: '' } }])
    ).toThrow('requires params.serverId')
  })
})
