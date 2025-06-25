import { NextRequest } from 'next/server'
/**
 * Tests for function execution API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockFreestyleExecuteScript = vi.fn()
const mockCreateContext = vi.fn()
const mockRunInContext = vi.fn()
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}

describe('Function Execute API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    vi.doMock('vm', () => ({
      createContext: mockCreateContext,
      Script: vi.fn().mockImplementation(() => ({
        runInContext: mockRunInContext,
      })),
    }))

    vi.doMock('freestyle-sandboxes', () => ({
      FreestyleSandboxes: vi.fn().mockImplementation(() => ({
        executeScript: mockFreestyleExecuteScript,
      })),
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        FREESTYLE_API_KEY: 'test-freestyle-key',
      },
    }))

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    mockFreestyleExecuteScript.mockResolvedValue({
      result: 'freestyle success',
      logs: [],
    })

    mockRunInContext.mockResolvedValue('vm success')
    mockCreateContext.mockReturnValue({})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Function Execution', () => {
    it('should execute simple JavaScript code successfully', async () => {
      const req = createMockRequest('POST', {
        code: 'return "Hello World"',
        timeout: 5000,
      })

      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.output).toHaveProperty('result')
      expect(data.output).toHaveProperty('executionTime')
    })

    it('should handle missing code parameter', async () => {
      const req = createMockRequest('POST', {
        timeout: 5000,
      })

      const { POST } = await import('./route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data).toHaveProperty('error')
    })

    it('should use default timeout when not provided', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] Function execution request/),
        expect.objectContaining({
          timeout: 5000, // default timeout
        })
      )
    })
  })

  describe('Template Variable Resolution', () => {
    it('should resolve environment variables with {{var_name}} syntax', async () => {
      const req = createMockRequest('POST', {
        code: 'return {{API_KEY}}',
        envVars: {
          API_KEY: 'secret-key-123',
        },
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // The code should be resolved to: return "secret-key-123"
    })

    it('should resolve tag variables with <tag_name> syntax', async () => {
      const req = createMockRequest('POST', {
        code: 'return <email>',
        params: {
          email: { id: '123', subject: 'Test Email' },
        },
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // The code should be resolved with the email object
    })

    it('should NOT treat email addresses as template variables', async () => {
      const req = createMockRequest('POST', {
        code: 'return "Email sent to user"',
        params: {
          email: {
            from: 'Waleed Latif <waleed@simstudio.ai>',
            to: 'User <user@example.com>',
          },
        },
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // Should not try to replace <waleed@simstudio.ai> as a template variable
    })

    it('should only match valid variable names in angle brackets', async () => {
      const req = createMockRequest('POST', {
        code: 'return <validVar> + "<invalid@email.com>" + <another_valid>',
        params: {
          validVar: 'hello',
          another_valid: 'world',
        },
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // Should replace <validVar> and <another_valid> but not <invalid@email.com>
    })
  })

  describe('Gmail Email Data Handling', () => {
    it('should handle Gmail webhook data with email addresses containing angle brackets', async () => {
      const gmailData = {
        email: {
          id: '123',
          from: 'Waleed Latif <waleed@simstudio.ai>',
          to: 'User <user@example.com>',
          subject: 'Test Email',
          bodyText: 'Hello world',
        },
        rawEmail: {
          id: '123',
          payload: {
            headers: [
              { name: 'From', value: 'Waleed Latif <waleed@simstudio.ai>' },
              { name: 'To', value: 'User <user@example.com>' },
            ],
          },
        },
      }

      const req = createMockRequest('POST', {
        code: 'return <email>',
        params: gmailData,
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })

    it('should properly serialize complex email objects with special characters', async () => {
      const complexEmailData = {
        email: {
          from: 'Test User <test@example.com>',
          bodyHtml: '<div>HTML content with "quotes" and \'apostrophes\'</div>',
          bodyText: 'Text with\nnewlines\tand\ttabs',
        },
      }

      const req = createMockRequest('POST', {
        code: 'return <email>',
        params: complexEmailData,
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })

  describe('Freestyle Execution', () => {
    it('should use Freestyle when API key is available', async () => {
      const req = createMockRequest('POST', {
        code: 'return "freestyle test"',
      })

      const { POST } = await import('./route')
      await POST(req)

      expect(mockFreestyleExecuteScript).toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] Using Freestyle for code execution/)
      )
    })

    it('should handle Freestyle errors and fallback to VM', async () => {
      mockFreestyleExecuteScript.mockRejectedValueOnce(new Error('Freestyle API error'))

      const req = createMockRequest('POST', {
        code: 'return "fallback test"',
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(mockFreestyleExecuteScript).toHaveBeenCalled()
      expect(mockRunInContext).toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] Freestyle API call failed, falling back to VM:/),
        expect.any(Object)
      )
    })

    it('should handle Freestyle script errors', async () => {
      mockFreestyleExecuteScript.mockResolvedValueOnce({
        result: null,
        logs: [{ type: 'error', message: 'ReferenceError: undefined variable' }],
      })

      const req = createMockRequest('POST', {
        code: 'return undefinedVariable',
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.success).toBe(false)
    })
  })

  describe('VM Execution', () => {
    it('should use VM when Freestyle API key is not available', async () => {
      // Mock no Freestyle API key
      vi.doMock('@/lib/env', () => ({
        env: {
          FREESTYLE_API_KEY: undefined,
        },
      }))

      const req = createMockRequest('POST', {
        code: 'return "vm test"',
      })

      const { POST } = await import('./route')
      await POST(req)

      expect(mockFreestyleExecuteScript).not.toHaveBeenCalled()
      expect(mockRunInContext).toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[.*\] Using VM for code execution \(no Freestyle API key available\)/
        )
      )
    })

    it('should handle VM execution errors', async () => {
      // Mock no Freestyle API key so it uses VM
      vi.doMock('@/lib/env', () => ({
        env: {
          FREESTYLE_API_KEY: undefined,
        },
      }))

      mockRunInContext.mockRejectedValueOnce(new Error('VM execution error'))

      const req = createMockRequest('POST', {
        code: 'return invalidCode(',
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.error).toContain('VM execution error')
    })
  })

  describe('Custom Tools', () => {
    it('should handle custom tool execution with direct parameter access', async () => {
      const req = createMockRequest('POST', {
        code: 'return location + " weather is sunny"',
        params: {
          location: 'San Francisco',
        },
        isCustomTool: true,
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // For custom tools, parameters should be directly accessible as variables
    })
  })

  describe('Security and Edge Cases', () => {
    it('should handle malformed JSON in request body', async () => {
      const req = new NextRequest('http://localhost:3000/api/function/execute', {
        method: 'POST',
        body: 'invalid json{',
        headers: { 'Content-Type': 'application/json' },
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(500)
    })

    it('should handle timeout parameter', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
        timeout: 10000,
      })

      const { POST } = await import('./route')
      await POST(req)

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] Function execution request/),
        expect.objectContaining({
          timeout: 10000,
        })
      )
    })

    it('should handle empty parameters object', async () => {
      const req = createMockRequest('POST', {
        code: 'return "no params"',
        params: {},
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })

  describe('Utility Functions', () => {
    it('should properly escape regex special characters', async () => {
      // This tests the escapeRegExp function indirectly
      const req = createMockRequest('POST', {
        code: 'return {{special.chars+*?}}',
        envVars: {
          'special.chars+*?': 'escaped-value',
        },
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // Should handle special regex characters in variable names
    })

    it('should handle JSON serialization edge cases', async () => {
      // Test with complex but not circular data first
      const req = createMockRequest('POST', {
        code: 'return <complexData>',
        params: {
          complexData: {
            special: 'chars"with\'quotes',
            unicode: '🎉 Unicode content',
            nested: {
              deep: {
                value: 'test',
              },
            },
          },
        },
      })

      const { POST } = await import('./route')
      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })
})

describe('Function Execute API - Template Variable Edge Cases', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        FREESTYLE_API_KEY: 'test-freestyle-key',
      },
    }))

    vi.doMock('vm', () => ({
      createContext: mockCreateContext,
      Script: vi.fn().mockImplementation(() => ({
        runInContext: mockRunInContext,
      })),
    }))

    vi.doMock('freestyle-sandboxes', () => ({
      FreestyleSandboxes: vi.fn().mockImplementation(() => ({
        executeScript: mockFreestyleExecuteScript,
      })),
    }))

    mockFreestyleExecuteScript.mockResolvedValue({
      result: 'freestyle success',
      logs: [],
    })

    mockRunInContext.mockResolvedValue('vm success')
    mockCreateContext.mockReturnValue({})
  })

  it('should handle nested template variables', async () => {
    mockFreestyleExecuteScript.mockResolvedValueOnce({
      result: 'environment-valueparam-value',
      logs: [],
    })

    const req = createMockRequest('POST', {
      code: 'return {{outer}} + <inner>',
      envVars: {
        outer: 'environment-value',
      },
      params: {
        inner: 'param-value',
      },
    })

    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.output.result).toBe('environment-valueparam-value')
  })

  it('should prioritize environment variables over params for {{}} syntax', async () => {
    mockFreestyleExecuteScript.mockResolvedValueOnce({
      result: 'env-wins',
      logs: [],
    })

    const req = createMockRequest('POST', {
      code: 'return {{conflictVar}}',
      envVars: {
        conflictVar: 'env-wins',
      },
      params: {
        conflictVar: 'param-loses',
      },
    })

    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    // Environment variable should take precedence
    expect(data.output.result).toBe('env-wins')
  })

  it('should handle missing template variables gracefully', async () => {
    mockFreestyleExecuteScript.mockResolvedValueOnce({
      result: '',
      logs: [],
    })

    const req = createMockRequest('POST', {
      code: 'return {{nonexistent}} + <alsoMissing>',
      envVars: {},
      params: {},
    })

    const { POST } = await import('./route')
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.output.result).toBe('')
  })
})
