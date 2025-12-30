import { describe, expect, it } from 'vitest'
import {
  type DiscoveredTool,
  getIssueBadgeLabel,
  getMcpToolIssue,
  hasSchemaChanged,
  isToolUnavailable,
  type McpToolIssue,
  type ServerState,
} from './tool-validation'
import type { StoredMcpToolReference } from './types'

describe('hasSchemaChanged', () => {
  it.concurrent('returns false when both schemas are undefined', () => {
    expect(hasSchemaChanged(undefined, undefined)).toBe(false)
  })

  it.concurrent('returns false when stored schema is undefined', () => {
    expect(hasSchemaChanged(undefined, { type: 'object' })).toBe(false)
  })

  it.concurrent('returns false when server schema is undefined', () => {
    expect(hasSchemaChanged({ type: 'object' }, undefined)).toBe(false)
  })

  it.concurrent('returns false for identical schemas', () => {
    const schema = { type: 'object' as const, properties: { name: { type: 'string' } } }
    expect(hasSchemaChanged(schema, { ...schema })).toBe(false)
  })

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

  it.concurrent('returns true when required fields differ', () => {
    const stored = { type: 'object' as const, properties: {}, required: ['name'] }
    const server = { type: 'object' as const, properties: {}, required: ['id'] }
    expect(hasSchemaChanged(stored, server)).toBe(true)
  })

  it.concurrent('returns false for deep equal schemas with different key order', () => {
    const stored = { type: 'object' as const, properties: { a: 1, b: 2 } }
    const server = { properties: { b: 2, a: 1 }, type: 'object' as const }
    expect(hasSchemaChanged(stored, server)).toBe(false)
  })

  it.concurrent('returns true when nested properties differ', () => {
    const stored = {
      type: 'object' as const,
      properties: { config: { type: 'object', properties: { enabled: { type: 'boolean' } } } },
    }
    const server = {
      type: 'object' as const,
      properties: { config: { type: 'object', properties: { enabled: { type: 'string' } } } },
    }
    expect(hasSchemaChanged(stored, server)).toBe(true)
  })

  it.concurrent('returns true when additional properties setting differs', () => {
    const stored = { type: 'object' as const, additionalProperties: true }
    const server = { type: 'object' as const, additionalProperties: false }
    expect(hasSchemaChanged(stored, server)).toBe(true)
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

    it.concurrent('returns server_not_found when server ID does not match', () => {
      const storedTool = createStoredTool({ serverId: 'server-1' })
      const servers = [createServerState({ id: 'server-2' })]
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

    it.concurrent('returns server_error with default message when lastError is undefined', () => {
      const storedTool = createStoredTool()
      const servers = [createServerState({ connectionStatus: 'error', lastError: undefined })]
      const tools: DiscoveredTool[] = []

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toEqual({ type: 'server_error', message: 'Server connection error' })
    })

    it.concurrent('returns server_error when server is disconnected', () => {
      const storedTool = createStoredTool()
      const servers = [createServerState({ connectionStatus: 'disconnected' })]
      const tools: DiscoveredTool[] = []

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toEqual({ type: 'server_error', message: 'Server not connected' })
    })

    it.concurrent('returns server_error when connection status is undefined', () => {
      const storedTool = createStoredTool()
      const servers = [createServerState({ connectionStatus: undefined })]
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

    it.concurrent('does not return url_changed when server URL is undefined', () => {
      const storedTool = createStoredTool({ serverUrl: 'https://old.example.com/mcp' })
      const servers = [createServerState({ url: undefined })]
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

    it.concurrent('returns tool_not_found when tool exists on different server', () => {
      const storedTool = createStoredTool({ serverId: 'server-1', toolName: 'test-tool' })
      const servers = [createServerState({ id: 'server-1' })]
      const tools = [createDiscoveredTool({ serverId: 'server-2', name: 'test-tool' })]

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toEqual({ type: 'tool_not_found', message: 'Tool not found on server' })
    })

    it.concurrent('returns tool_not_found when no tools are discovered', () => {
      const storedTool = createStoredTool()
      const servers = [createServerState()]
      const tools: DiscoveredTool[] = []

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

    it.concurrent('does not return schema_changed when server schema is undefined', () => {
      const storedTool = createStoredTool({ schema: { type: 'object' } })
      const servers = [createServerState()]
      const tools = [createDiscoveredTool({ inputSchema: undefined })]

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

    it.concurrent('returns null when schemas match exactly', () => {
      const schema = { type: 'object' as const, properties: { name: { type: 'string' } } }
      const storedTool = createStoredTool({ schema })
      const servers = [createServerState()]
      const tools = [createDiscoveredTool({ inputSchema: schema })]

      const result = getMcpToolIssue(storedTool, servers, tools)

      expect(result).toBeNull()
    })
  })
})

describe('getIssueBadgeLabel', () => {
  it.concurrent('returns "stale" for schema_changed', () => {
    const issue: McpToolIssue = { type: 'schema_changed', message: 'Schema changed' }
    expect(getIssueBadgeLabel(issue)).toBe('stale')
  })

  it.concurrent('returns "stale" for url_changed', () => {
    const issue: McpToolIssue = { type: 'url_changed', message: 'URL changed' }
    expect(getIssueBadgeLabel(issue)).toBe('stale')
  })

  it.concurrent('returns "unavailable" for server_not_found', () => {
    const issue: McpToolIssue = { type: 'server_not_found', message: 'Server not found' }
    expect(getIssueBadgeLabel(issue)).toBe('unavailable')
  })

  it.concurrent('returns "unavailable" for server_error', () => {
    const issue: McpToolIssue = { type: 'server_error', message: 'Server error' }
    expect(getIssueBadgeLabel(issue)).toBe('unavailable')
  })

  it.concurrent('returns "unavailable" for tool_not_found', () => {
    const issue: McpToolIssue = { type: 'tool_not_found', message: 'Tool not found' }
    expect(getIssueBadgeLabel(issue)).toBe('unavailable')
  })
})

describe('isToolUnavailable', () => {
  it.concurrent('returns false for null', () => {
    expect(isToolUnavailable(null)).toBe(false)
  })

  it.concurrent('returns true for server_not_found', () => {
    const issue: McpToolIssue = { type: 'server_not_found', message: 'Server not found' }
    expect(isToolUnavailable(issue)).toBe(true)
  })

  it.concurrent('returns true for server_error', () => {
    const issue: McpToolIssue = { type: 'server_error', message: 'Server error' }
    expect(isToolUnavailable(issue)).toBe(true)
  })

  it.concurrent('returns true for tool_not_found', () => {
    const issue: McpToolIssue = { type: 'tool_not_found', message: 'Tool not found' }
    expect(isToolUnavailable(issue)).toBe(true)
  })

  it.concurrent('returns false for schema_changed', () => {
    const issue: McpToolIssue = { type: 'schema_changed', message: 'Schema changed' }
    expect(isToolUnavailable(issue)).toBe(false)
  })

  it.concurrent('returns false for url_changed', () => {
    const issue: McpToolIssue = { type: 'url_changed', message: 'URL changed' }
    expect(isToolUnavailable(issue)).toBe(false)
  })
})
