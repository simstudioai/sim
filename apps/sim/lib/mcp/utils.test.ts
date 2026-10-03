import { describe, expect, it } from 'vitest'
import {
  McpConnectionError,
  McpOauthAuthorizationRequiredError,
  McpServerCooldownError,
} from '@/lib/mcp/types'
import {
  categorizeError,
  createMcpToolId,
  generateManagedMcpConnectionId,
  generateMcpServerId,
  isManagedMcpConnectionId,
  parseMcpToolId,
  parseMcpToolTarget,
} from './utils'

describe('generateMcpServerId', () => {
  const workspaceId = 'ws-test-123'
  const url = 'https://my-mcp-server.com/mcp'

  it.concurrent('normalizes trailing slashes', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, `${url}/`)
    const id3 = generateMcpServerId(workspaceId, `${url}//`)
    expect(id1).toBe(id2)
    expect(id1).toBe(id3)
  })

  it.concurrent('is case insensitive for URL', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, 'https://MY-MCP-SERVER.com/mcp')
    const id3 = generateMcpServerId(workspaceId, 'HTTPS://My-Mcp-Server.COM/MCP')
    expect(id1).toBe(id2)
    expect(id1).toBe(id3)
  })

  it.concurrent('ignores query parameters', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, `${url}?token=abc123`)
    const id3 = generateMcpServerId(workspaceId, `${url}?foo=bar&baz=qux`)
    expect(id1).toBe(id2)
    expect(id1).toBe(id3)
  })

  it.concurrent('produces different IDs for different workspaces', () => {
    const id1 = generateMcpServerId('ws-123', url)
    const id2 = generateMcpServerId('ws-456', url)
    expect(id1).not.toBe(id2)
  })
})

describe('categorizeError', () => {
  it.concurrent('returns 401 for McpOauthAuthorizationRequiredError via instanceof', () => {
    const error = new McpOauthAuthorizationRequiredError('mcp-a', 'A')
    const result = categorizeError(error)
    expect(result.status).toBe(401)
    expect(result.message).toBe('Authentication required')
  })

  it.concurrent('returns 503 for the typed discovery-cooldown refusal', () => {
    const error = new McpServerCooldownError('mcp-a')
    const result = categorizeError(error)
    expect(result.status).toBe(503)
  })

  /**
   * `McpConnectionError` interpolates the server's display name into its
   * message, so selecting the cooldown branch by searching that message reports
   * a server named after the word as a transient 503 when its connection has
   * genuinely failed.
   */
  it.concurrent('does not read a cooldown out of a server display name', () => {
    const error = new McpConnectionError('connect ECONNREFUSED', 'Cooldown Docs')
    const result = categorizeError(error)
    expect(result.status).toBe(502)
  })

  it.concurrent('returns 502 for other McpConnectionError', () => {
    const error = new McpConnectionError('connect ECONNREFUSED', 'mcp-a')
    const result = categorizeError(error)
    expect(result.status).toBe(502)
    expect(result.message).toBe('Connection failed')
  })
})

describe('createMcpToolId', () => {
  it.concurrent('adds mcp- prefix if server ID does not have it', () => {
    const toolId = createMcpToolId('12345678', 'my-tool')
    expect(toolId).toBe('mcp-12345678-my-tool')
  })

  it.concurrent('does not double-prefix if server ID already has mcp-', () => {
    const toolId = createMcpToolId('mcp-server123', 'tool-name')
    expect(toolId).toBe('mcp-server123-tool-name')
  })
})

describe('parseMcpToolId', () => {
  it.concurrent('throws error for invalid format without mcp prefix', () => {
    expect(() => parseMcpToolId('invalid-tool-id')).toThrow(
      'Invalid MCP tool ID format: invalid-tool-id'
    )
  })

  it.concurrent('handles tool name with multiple hyphens correctly', () => {
    const result = parseMcpToolId('mcp-abc-tool-with-many-parts')
    expect(result.serverId).toBe('mcp-abc')
    expect(result.toolName).toBe('tool-with-many-parts')
  })
})

describe('parseMcpToolTarget', () => {
  it('preserves a managed connection ID even when its random segment contains hyphens', () => {
    const credentialId = 'mcp-cg-abcd-efghijklmnopqrst'
    const result = parseMcpToolTarget(`${credentialId}-fireflies-search-transcripts`)

    expect(result).toEqual({
      kind: 'managed_connection',
      credentialId,
      toolName: 'fireflies-search-transcripts',
    })
  })

  it('keeps existing shared MCP tool IDs unchanged', () => {
    expect(parseMcpToolTarget('mcp-12345678-search-transcripts')).toEqual({
      kind: 'shared_server',
      serverId: 'mcp-12345678',
      toolName: 'search-transcripts',
    })
  })

  it('rejects a managed connection ID without a tool name', () => {
    const credentialId = generateManagedMcpConnectionId()
    expect(() => parseMcpToolTarget(credentialId)).toThrow('Invalid managed MCP tool ID format')
  })
})

describe('isManagedMcpConnectionId', () => {
  it('accepts only a complete managed connection ID', () => {
    const credentialId = generateManagedMcpConnectionId()

    expect(isManagedMcpConnectionId(credentialId)).toBe(true)
    expect(isManagedMcpConnectionId(`${credentialId}-tool`)).toBe(false)
    expect(isManagedMcpConnectionId('mcp-cg-short')).toBe(false)
    expect(isManagedMcpConnectionId('mcp-shared')).toBe(false)
  })
})
