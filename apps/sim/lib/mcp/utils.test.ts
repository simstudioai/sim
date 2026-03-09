import { describe, expect, it } from 'vitest'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import {
  categorizeError,
  createMcpToolId,
  generateMcpServerId,
  MCP_CLIENT_CONSTANTS,
  MCP_CONSTANTS,
  parseMcpToolId,
  validateRequiredFields,
  validateStringParam,
} from './utils'

describe('generateMcpServerId', () => {
  const workspaceId = 'ws-test-123'
  const url = 'https://my-mcp-server.com/mcp'

  it.concurrent('produces deterministic IDs for the same input', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, url)
    expect(id1).toBe(id2)
  })

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

  it.concurrent('ignores fragments', () => {
    const id1 = generateMcpServerId(workspaceId, url)
    const id2 = generateMcpServerId(workspaceId, `${url}#section`)
    expect(id1).toBe(id2)
  })

  it.concurrent('produces different IDs for different workspaces', () => {
    const id1 = generateMcpServerId('ws-123', url)
    const id2 = generateMcpServerId('ws-456', url)
    expect(id1).not.toBe(id2)
  })

  it.concurrent('produces different IDs for different URLs', () => {
    const id1 = generateMcpServerId(workspaceId, 'https://server1.com/mcp')
    const id2 = generateMcpServerId(workspaceId, 'https://server2.com/mcp')
    expect(id1).not.toBe(id2)
  })

  it.concurrent('produces IDs in the correct format', () => {
    const id = generateMcpServerId(workspaceId, url)
    expect(id).toMatch(/^mcp-[a-f0-9]{8}$/)
  })

  it.concurrent('handles URLs with ports', () => {
    const id1 = generateMcpServerId(workspaceId, 'https://localhost:3000/mcp')
    const id2 = generateMcpServerId(workspaceId, 'https://localhost:3000/mcp/')
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^mcp-[a-f0-9]{8}$/)
  })

  it.concurrent('handles invalid URLs gracefully', () => {
    const id = generateMcpServerId(workspaceId, 'not-a-valid-url')
    expect(id).toMatch(/^mcp-[a-f0-9]{8}$/)
  })
})

describe('MCP_CONSTANTS', () => {
  it.concurrent('has correct execution timeout', () => {
    expect(MCP_CONSTANTS.EXECUTION_TIMEOUT).toBe(DEFAULT_EXECUTION_TIMEOUT_MS)
  })

  it.concurrent('has correct cache timeout (5 minutes)', () => {
    expect(MCP_CONSTANTS.CACHE_TIMEOUT).toBe(5 * 60 * 1000)
  })

  it.concurrent('has correct default retries', () => {
    expect(MCP_CONSTANTS.DEFAULT_RETRIES).toBe(3)
  })

  it.concurrent('has correct default connection timeout', () => {
    expect(MCP_CONSTANTS.DEFAULT_CONNECTION_TIMEOUT).toBe(30000)
  })

  it.concurrent('has correct max cache size', () => {
    expect(MCP_CONSTANTS.MAX_CACHE_SIZE).toBe(1000)
  })

  it.concurrent('has correct max consecutive failures', () => {
    expect(MCP_CONSTANTS.MAX_CONSECUTIVE_FAILURES).toBe(3)
  })
})

describe('MCP_CLIENT_CONSTANTS', () => {
  it.concurrent('has correct client timeout', () => {
    expect(MCP_CLIENT_CONSTANTS.CLIENT_TIMEOUT).toBe(DEFAULT_EXECUTION_TIMEOUT_MS)
  })

  it.concurrent('has correct auto refresh interval (5 minutes)', () => {
    expect(MCP_CLIENT_CONSTANTS.AUTO_REFRESH_INTERVAL).toBe(5 * 60 * 1000)
  })
})

describe('validateStringParam', () => {
  it.concurrent('returns valid for non-empty string', () => {
    const result = validateStringParam('test-value', 'testParam')
    expect(result.isValid).toBe(true)
  })

  it.concurrent('returns invalid for empty string', () => {
    const result = validateStringParam('', 'testParam')
    expect(result.isValid).toBe(false)
    if (!result.isValid) {
      expect(result.error).toBe('testParam is required and must be a string')
    }
  })

  it.concurrent('returns invalid for null', () => {
    const result = validateStringParam(null, 'testParam')
    expect(result.isValid).toBe(false)
    if (!result.isValid) {
      expect(result.error).toBe('testParam is required and must be a string')
    }
  })

  it.concurrent('returns invalid for undefined', () => {
    const result = validateStringParam(undefined, 'testParam')
    expect(result.isValid).toBe(false)
    if (!result.isValid) {
      expect(result.error).toBe('testParam is required and must be a string')
    }
  })

  it.concurrent('returns invalid for number', () => {
    const result = validateStringParam(123, 'testParam')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('returns invalid for object', () => {
    const result = validateStringParam({ foo: 'bar' }, 'testParam')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('returns invalid for array', () => {
    const result = validateStringParam(['test'], 'testParam')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('includes param name in error message', () => {
    const result = validateStringParam(null, 'customParamName')
    expect(result.isValid).toBe(false)
    if (!result.isValid) {
      expect(result.error).toContain('customParamName')
    }
  })
})

describe('validateRequiredFields', () => {
  it.concurrent('returns valid when all required fields are present', () => {
    const body = { field1: 'value1', field2: 'value2', field3: 'value3' }
    const result = validateRequiredFields(body, ['field1', 'field2'])
    expect(result.isValid).toBe(true)
  })

  it.concurrent('returns invalid when a required field is missing', () => {
    const body = { field1: 'value1' }
    const result = validateRequiredFields(body, ['field1', 'field2'])
    expect(result.isValid).toBe(false)
    if (!result.isValid) {
      expect(result.error).toBe('Missing required fields: field2')
    }
  })

  it.concurrent('returns invalid with multiple missing fields', () => {
    const body = { field1: 'value1' }
    const result = validateRequiredFields(body, ['field1', 'field2', 'field3'])
    expect(result.isValid).toBe(false)
    if (!result.isValid) {
      expect(result.error).toBe('Missing required fields: field2, field3')
    }
  })

  it.concurrent('returns valid with empty required fields array', () => {
    const body = { field1: 'value1' }
    const result = validateRequiredFields(body, [])
    expect(result.isValid).toBe(true)
  })

  it.concurrent('returns invalid when body is empty and fields are required', () => {
    const body = {}
    const result = validateRequiredFields(body, ['field1'])
    expect(result.isValid).toBe(false)
  })

  it.concurrent('considers null values as present', () => {
    const body = { field1: null }
    const result = validateRequiredFields(body, ['field1'])
    expect(result.isValid).toBe(true)
  })

  it.concurrent('considers undefined values as present when key exists', () => {
    const body = { field1: undefined }
    const result = validateRequiredFields(body, ['field1'])
    expect(result.isValid).toBe(true)
  })
})

describe('categorizeError', () => {
  it.concurrent('returns 408 for timeout errors', () => {
    const error = new Error('Request timeout occurred')
    const result = categorizeError(error)
    expect(result.status).toBe(408)
    expect(result.message).toBe('Request timed out')
  })

  it.concurrent('returns 408 for timeout in message (case insensitive)', () => {
    const error = new Error('Operation TIMEOUT')
    const result = categorizeError(error)
    expect(result.status).toBe(408)
  })

  it.concurrent('returns 404 for not found errors', () => {
    const error = new Error('Resource not found')
    const result = categorizeError(error)
    expect(result.status).toBe(404)
    expect(result.message).toBe('Resource not found')
  })

  it.concurrent('returns 404 for not accessible errors', () => {
    const error = new Error('Server not accessible')
    const result = categorizeError(error)
    expect(result.status).toBe(404)
    expect(result.message).toBe('Server not accessible')
  })

  it.concurrent('returns 401 for authentication errors', () => {
    const error = new Error('Authentication failed')
    const result = categorizeError(error)
    expect(result.status).toBe(401)
    expect(result.message).toBe('Authentication required')
  })

  it.concurrent('returns 401 for unauthorized errors', () => {
    const error = new Error('Unauthorized access attempt')
    const result = categorizeError(error)
    expect(result.status).toBe(401)
    expect(result.message).toBe('Authentication required')
  })

  it.concurrent('returns 400 for invalid input errors', () => {
    const error = new Error('Invalid parameter provided')
    const result = categorizeError(error)
    expect(result.status).toBe(400)
    expect(result.message).toBe('Invalid parameter provided')
  })

  it.concurrent('returns 400 for missing required errors', () => {
    const error = new Error('Missing required field: name')
    const result = categorizeError(error)
    expect(result.status).toBe(400)
    expect(result.message).toBe('Missing required field: name')
  })

  it.concurrent('returns 400 for validation errors', () => {
    const error = new Error('Validation failed for input')
    const result = categorizeError(error)
    expect(result.status).toBe(400)
    expect(result.message).toBe('Validation failed for input')
  })

  it.concurrent('returns 500 for generic errors', () => {
    const error = new Error('Something went wrong')
    const result = categorizeError(error)
    expect(result.status).toBe(500)
    expect(result.message).toBe('Something went wrong')
  })

  it.concurrent('returns 500 for non-Error objects', () => {
    const result = categorizeError('string error')
    expect(result.status).toBe(500)
    expect(result.message).toBe('Unknown error occurred')
  })

  it.concurrent('returns 500 for null', () => {
    const result = categorizeError(null)
    expect(result.status).toBe(500)
    expect(result.message).toBe('Unknown error occurred')
  })

  it.concurrent('returns 500 for undefined', () => {
    const result = categorizeError(undefined)
    expect(result.status).toBe(500)
    expect(result.message).toBe('Unknown error occurred')
  })

  it.concurrent('returns 500 for objects that are not Error instances', () => {
    const result = categorizeError({ message: 'fake error' })
    expect(result.status).toBe(500)
    expect(result.message).toBe('Unknown error occurred')
  })
})

describe('createMcpToolId', () => {
  it.concurrent('creates tool ID from server ID and tool name', () => {
    const toolId = createMcpToolId('mcp-12345678', 'my-tool')
    expect(toolId).toBe('mcp-12345678-my-tool')
  })

  it.concurrent('adds mcp- prefix if server ID does not have it', () => {
    const toolId = createMcpToolId('12345678', 'my-tool')
    expect(toolId).toBe('mcp-12345678-my-tool')
  })

  it.concurrent('does not double-prefix if server ID already has mcp-', () => {
    const toolId = createMcpToolId('mcp-server123', 'tool-name')
    expect(toolId).toBe('mcp-server123-tool-name')
  })

  it.concurrent('handles tool names with hyphens', () => {
    const toolId = createMcpToolId('mcp-server', 'my-complex-tool-name')
    expect(toolId).toBe('mcp-server-my-complex-tool-name')
  })

  it.concurrent('handles empty tool name', () => {
    const toolId = createMcpToolId('mcp-server', '')
    expect(toolId).toBe('mcp-server-')
  })
})

describe('parseMcpToolId', () => {
  it.concurrent('parses valid MCP tool ID', () => {
    const result = parseMcpToolId('mcp-12345678-my-tool')
    expect(result.serverId).toBe('mcp-12345678')
    expect(result.toolName).toBe('my-tool')
  })

  it.concurrent('parses tool name with hyphens', () => {
    const result = parseMcpToolId('mcp-server123-my-complex-tool-name')
    expect(result.serverId).toBe('mcp-server123')
    expect(result.toolName).toBe('my-complex-tool-name')
  })

  it.concurrent('throws error for invalid format without mcp prefix', () => {
    expect(() => parseMcpToolId('invalid-tool-id')).toThrow(
      'Invalid MCP tool ID format: invalid-tool-id'
    )
  })

  it.concurrent('throws error for tool ID with less than 3 parts', () => {
    expect(() => parseMcpToolId('mcp-only')).toThrow('Invalid MCP tool ID format: mcp-only')
  })

  it.concurrent('throws error for empty string', () => {
    expect(() => parseMcpToolId('')).toThrow('Invalid MCP tool ID format: ')
  })

  it.concurrent('throws error for single part', () => {
    expect(() => parseMcpToolId('mcp')).toThrow('Invalid MCP tool ID format: mcp')
  })

  it.concurrent('handles tool name with multiple hyphens correctly', () => {
    const result = parseMcpToolId('mcp-abc-tool-with-many-parts')
    expect(result.serverId).toBe('mcp-abc')
    expect(result.toolName).toBe('tool-with-many-parts')
  })
})
