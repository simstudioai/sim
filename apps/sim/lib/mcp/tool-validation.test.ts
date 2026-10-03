import { describe, expect, it } from 'vitest'
import {
  type DiscoveredTool,
  getMcpToolIssue,
  hasSchemaChanged,
  type ServerState,
} from './tool-validation'
import type { StoredMcpToolReference } from './types'

describe('hasSchemaChanged', () => {
  it.concurrent('returns false when only description differs', () => {
    const stored = {
      type: 'object' as const,
      properties: { name: { type: 'string' } },
      description: 'Old description',
    }
    const server = {
      type: 'object' as const,
      properties: { name: { type: 'string' } },
      description: 'New description',
    }
    expect(hasSchemaChanged(stored, server)).toBe(false)
  })

  it.concurrent('returns true when properties differ', () => {
    const stored = { type: 'object' as const, properties: { name: { type: 'string' } } }
    const server = { type: 'object' as const, properties: { id: { type: 'number' } } }
    expect(hasSchemaChanged(stored, server)).toBe(true)
  })

  it.concurrent('returns false for deep equal schemas with different key order', () => {
    const stored = { type: 'object' as const, properties: { a: 1, b: 2 } }
    const server = { properties: { b: 2, a: 1 }, type: 'object' as const }
    expect(hasSchemaChanged(stored, server)).toBe(false)
  })

  it.concurrent('ignores description at property level', () => {
    const stored = {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'Old' } },
    }
    const server = {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'New' } },
    }
    // Only top-level description is ignored, not nested ones
    expect(hasSchemaChanged(stored, server)).toBe(true)
  })
})

describe('getMcpToolIssue', () => {
  const createStoredTool = (
    overrides?: Partial<StoredMcpToolReference>
  ): StoredMcpToolReference => ({
    serverId: 'server-1',
    serverUrl: 'https://api.example.com/mcp',
    toolName: 'test-tool',
    schema: { type: 'object' },
    ...overrides,
  })

  const createServerState = (overrides?: Partial<ServerState>): ServerState => ({
    id: 'server-1',
    url: 'https://api.example.com/mcp',
    connectionStatus: 'connected',
    ...overrides,
  })

  const createDiscoveredTool = (overrides?: Partial<DiscoveredTool>): DiscoveredTool => ({
    serverId: 'server-1',
    name: 'test-tool',
    inputSchema: { type: 'object' },
    ...overrides,
  })

  describe('server_not_found', () => {
    it.concurrent('returns server_not_found when server does not exist', () => {
      const storedTool = createStoredTool()
      const servers: ServerState[] = []
      const tools: DiscoveredTool[] = []

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toEqual({ type: 'server_not_found', message: 'Server not found' })
    })
  })

  describe('server_error', () => {
    it.concurrent('returns server_error when server has error status', () => {
      const storedTool = createStoredTool()
      const servers = [
        createServerState({ connectionStatus: 'error', lastError: 'Connection refused' }),
      ]
      const tools: DiscoveredTool[] = []

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toEqual({ type: 'server_error', message: 'Connection refused' })
    })

    it.concurrent('returns server_error when server is disconnected', () => {
      const storedTool = createStoredTool()
      const servers = [createServerState({ connectionStatus: 'disconnected' })]
      const tools: DiscoveredTool[] = []

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toEqual({ type: 'server_error', message: 'Server not connected' })
    })
  })

  describe('url_changed', () => {
    it.concurrent('returns url_changed when server URL has changed', () => {
      const storedTool = createStoredTool({ serverUrl: 'https://old.example.com/mcp' })
      const servers = [createServerState({ url: 'https://new.example.com/mcp' })]
      const tools = [createDiscoveredTool()]

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toEqual({
        type: 'url_changed',
        message: 'Server URL changed',
      })
    })

    it.concurrent('does not return url_changed when stored URL is undefined', () => {
      const storedTool = createStoredTool({ serverUrl: undefined })
      const servers = [createServerState({ url: 'https://new.example.com/mcp' })]
      const tools = [createDiscoveredTool()]

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toBeNull()
    })
  })

  describe('tool_not_found', () => {
    it.concurrent('returns tool_not_found when tool does not exist on server', () => {
      const storedTool = createStoredTool({ toolName: 'missing-tool' })
      const servers = [createServerState()]
      const tools = [createDiscoveredTool({ name: 'other-tool' })]

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toEqual({ type: 'tool_not_found', message: 'Tool not found on server' })
    })
  })

  describe('schema_changed', () => {
    it.concurrent('returns schema_changed when tool schema has changed', () => {
      const storedTool = createStoredTool({
        schema: { type: 'object', properties: { name: { type: 'string' } } },
      })
      const servers = [createServerState()]
      const tools = [
        createDiscoveredTool({
          inputSchema: { type: 'object', properties: { id: { type: 'number' } } },
        }),
      ]

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toEqual({ type: 'schema_changed', message: 'Tool schema changed' })
    })

    it.concurrent('does not return schema_changed when stored schema is undefined', () => {
      const storedTool = createStoredTool({ schema: undefined })
      const servers = [createServerState()]
      const tools = [createDiscoveredTool()]

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toBeNull()
    })
  })

  describe('no issues', () => {
    it.concurrent('returns null when everything is valid', () => {
      const storedTool = createStoredTool()
      const servers = [createServerState()]
      const tools = [createDiscoveredTool()]

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toBeNull()
    })
  })
})
