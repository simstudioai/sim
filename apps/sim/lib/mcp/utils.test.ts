import { describe, expect, it } from 'vitest'
import { generateMcpServerId } from './utils'

describe('generateMcpServerId', () => {
  const workspaceId = 'ws-test-123'
  const url = 'https://my-mcp-server.com/mcp'

  it('produces deterministic IDs for the same input', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, url)
    expect(id1).toBe(id2)
  })

  it('normalizes trailing slashes', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, `${url}/`)
    const id3 = generateMcpServerId(workspaceId, `${url}//`)
    expect(id1).toBe(id2)
    expect(id1).toBe(id3)
  })

  it('is case insensitive for URL', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, 'https://MY-MCP-SERVER.com/mcp')
    const id3 = generateMcpServerId(workspaceId, 'HTTPS://My-Mcp-Server.COM/MCP')
    expect(id1).toBe(id2)
    expect(id1).toBe(id3)
  })

  it('ignores query parameters', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, `${url}?token=abc123`)
    const id3 = generateMcpServerId(workspaceId, `${url}?foo=bar&baz=qux`)
    expect(id1).toBe(id2)
    expect(id1).toBe(id3)
  })

  it('ignores fragments', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, `${url}#section`)
    expect(id1).toBe(id2)
  })

  it('produces different IDs for different workspaces', () => {
    const id1 = generateMcpServerId('ws-123', url)
    const id2 = generateMcpServerId('ws-456', url)
    expect(id1).not.toBe(id2)
  })

  it('produces different IDs for different URLs', () => {
    const id1 = generateMcpServerId(workspaceId, 'https://server1.com/mcp')
    const id2 = generateMcpServerId(workspaceId, 'https://server2.com/mcp')
    expect(id1).not.toBe(id2)
  })

  it('produces IDs in the correct format', () => {
    const id = generateMcpServerId(workspaceId, url)
    expect(id).toMatch(/^mcp-[a-f0-9]{8}$/)
  })

  it('handles URLs with ports', () => {
    const id1 = generateMcpServerId(workspaceId, 'https://localhost:3000/mcp')
    const id2 = generateMcpServerId(workspaceId, 'https://localhost:3000/mcp/')
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^mcp-[a-f0-9]{8}$/)
  })

  it('handles invalid URLs gracefully', () => {
    // Should not throw, should produce some ID
    const id = generateMcpServerId(workspaceId, 'not-a-valid-url')
    expect(id).toMatch(/^mcp-[a-f0-9]{8}$/)
  })
})
