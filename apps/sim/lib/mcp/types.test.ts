import { describe, expect, it } from 'vitest'
import { McpConnectionError, McpError } from './types'

describe('McpError', () => {
  it.concurrent('creates error with message only', () => {
    const error = new McpError('Something went wrong')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(McpError)
    expect(error.message).toBe('Something went wrong')
    expect(error.name).toBe('McpError')
    expect(error.code).toBeUndefined()
    expect(error.data).toBeUndefined()
  })

  it.concurrent('creates error with message and code', () => {
    const error = new McpError('Not found', 404)

    expect(error.message).toBe('Not found')
    expect(error.code).toBe(404)
    expect(error.data).toBeUndefined()
  })

  it.concurrent('creates error with message, code, and data', () => {
    const errorData = { field: 'name', reason: 'required' }
    const error = new McpError('Validation failed', 400, errorData)

    expect(error.message).toBe('Validation failed')
    expect(error.code).toBe(400)
    expect(error.data).toEqual(errorData)
  })

  it.concurrent('preserves error name in stack trace', () => {
    const error = new McpError('Test error')

    expect(error.stack).toContain('McpError')
  })

  it.concurrent('can be caught as Error', () => {
    expect(() => {
      throw new McpError('Test error')
    }).toThrow(Error)
  })

  it.concurrent('can be caught as McpError', () => {
    expect(() => {
      throw new McpError('Test error')
    }).toThrow(McpError)
  })

  it.concurrent('handles null code and data', () => {
    const error = new McpError('Error', undefined, undefined)

    expect(error.code).toBeUndefined()
    expect(error.data).toBeUndefined()
  })

  it.concurrent('handles zero code', () => {
    const error = new McpError('Error', 0)

    expect(error.code).toBe(0)
  })

  it.concurrent('handles negative code', () => {
    const error = new McpError('RPC error', -32600)

    expect(error.code).toBe(-32600)
  })

  it.concurrent('handles complex data object', () => {
    const complexData = {
      errors: [
        { field: 'name', message: 'Required' },
        { field: 'email', message: 'Invalid format' },
      ],
      metadata: {
        requestId: 'abc123',
        timestamp: Date.now(),
      },
    }
    const error = new McpError('Multiple validation errors', 400, complexData)

    expect(error.data).toEqual(complexData)
    expect((error.data as typeof complexData).errors).toHaveLength(2)
  })

  it.concurrent('handles array as data', () => {
    const arrayData = ['error1', 'error2', 'error3']
    const error = new McpError('Multiple errors', 500, arrayData)

    expect(error.data).toEqual(arrayData)
  })

  it.concurrent('handles string as data', () => {
    const error = new McpError('Error with details', 500, 'Additional details')

    expect(error.data).toBe('Additional details')
  })
})

describe('McpConnectionError', () => {
  it.concurrent('creates error with message and server name', () => {
    const error = new McpConnectionError('Connection refused', 'My MCP Server')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(McpError)
    expect(error).toBeInstanceOf(McpConnectionError)
    expect(error.name).toBe('McpConnectionError')
    expect(error.message).toBe('Failed to connect to "My MCP Server": Connection refused')
  })

  it.concurrent('formats message correctly with server name', () => {
    const error = new McpConnectionError('timeout', 'Production Server')

    expect(error.message).toBe('Failed to connect to "Production Server": timeout')
  })

  it.concurrent('handles empty message', () => {
    const error = new McpConnectionError('', 'Test Server')

    expect(error.message).toBe('Failed to connect to "Test Server": ')
  })

  it.concurrent('handles empty server name', () => {
    const error = new McpConnectionError('Connection failed', '')

    expect(error.message).toBe('Failed to connect to "": Connection failed')
  })

  it.concurrent('handles server name with special characters', () => {
    const error = new McpConnectionError('Error', 'Server "with" quotes')

    expect(error.message).toBe('Failed to connect to "Server "with" quotes": Error')
  })

  it.concurrent('can be caught as Error', () => {
    expect(() => {
      throw new McpConnectionError('Error', 'Server')
    }).toThrow(Error)
  })

  it.concurrent('can be caught as McpError', () => {
    expect(() => {
      throw new McpConnectionError('Error', 'Server')
    }).toThrow(McpError)
  })

  it.concurrent('can be caught as McpConnectionError', () => {
    expect(() => {
      throw new McpConnectionError('Error', 'Server')
    }).toThrow(McpConnectionError)
  })

  it.concurrent('inherits code and data properties as undefined', () => {
    const error = new McpConnectionError('Error', 'Server')

    expect(error.code).toBeUndefined()
    expect(error.data).toBeUndefined()
  })

  it.concurrent('preserves error name in stack trace', () => {
    const error = new McpConnectionError('Test error', 'Test Server')

    expect(error.stack).toContain('McpConnectionError')
  })

  it.concurrent('handles various error messages', () => {
    const testCases = [
      { message: 'ECONNREFUSED', server: 'localhost' },
      { message: 'ETIMEDOUT', server: 'remote-server.com' },
      { message: 'ENOTFOUND', server: 'unknown-host' },
      { message: 'SSL certificate error', server: 'secure-server.com' },
      { message: 'HTTP 503 Service Unavailable', server: 'api.example.com' },
    ]

    testCases.forEach(({ message, server }) => {
      const error = new McpConnectionError(message, server)
      expect(error.message).toContain(message)
      expect(error.message).toContain(server)
    })
  })

  it.concurrent('handles unicode in server name', () => {
    const error = new McpConnectionError('Error', 'Server with emoji')

    expect(error.message).toBe('Failed to connect to "Server with emoji": Error')
  })

  it.concurrent('handles very long server names', () => {
    const longName = 'a'.repeat(1000)
    const error = new McpConnectionError('Error', longName)

    expect(error.message).toContain(longName)
  })

  it.concurrent('handles very long error messages', () => {
    const longMessage = 'Error: '.repeat(100)
    const error = new McpConnectionError(longMessage, 'Server')

    expect(error.message).toContain(longMessage)
  })
})

describe('Error hierarchy', () => {
  it.concurrent('McpConnectionError extends McpError', () => {
    const error = new McpConnectionError('Error', 'Server')

    expect(Object.getPrototypeOf(Object.getPrototypeOf(error))).toBe(McpError.prototype)
  })

  it.concurrent('McpError extends Error', () => {
    const error = new McpError('Error')

    expect(Object.getPrototypeOf(Object.getPrototypeOf(error))).toBe(Error.prototype)
  })

  it.concurrent('instanceof checks work correctly', () => {
    const mcpError = new McpError('MCP error')
    const connectionError = new McpConnectionError('Connection error', 'Server')

    // McpError checks
    expect(mcpError instanceof Error).toBe(true)
    expect(mcpError instanceof McpError).toBe(true)
    expect(mcpError instanceof McpConnectionError).toBe(false)

    // McpConnectionError checks
    expect(connectionError instanceof Error).toBe(true)
    expect(connectionError instanceof McpError).toBe(true)
    expect(connectionError instanceof McpConnectionError).toBe(true)
  })

  it.concurrent('errors can be differentiated in catch block', () => {
    const handleError = (error: Error): string => {
      if (error instanceof McpConnectionError) {
        return 'connection'
      }
      if (error instanceof McpError) {
        return 'mcp'
      }
      return 'generic'
    }

    expect(handleError(new McpConnectionError('Error', 'Server'))).toBe('connection')
    expect(handleError(new McpError('Error'))).toBe('mcp')
    expect(handleError(new Error('Error'))).toBe('generic')
  })
})
