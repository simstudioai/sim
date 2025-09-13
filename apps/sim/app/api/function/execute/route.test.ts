import { NextRequest } from 'next/server'
/**
 * Tests for function execution API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

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

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('@/lib/execution/e2b', () => ({
      executeInE2B: vi.fn().mockResolvedValue({
        result: 'e2b success',
        stdout: 'e2b output',
        sandboxId: 'test-sandbox-id',
      }),
    }))

    mockRunInContext.mockResolvedValue('vm success')
    mockCreateContext.mockReturnValue({})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Security Tests', () => {
    it.concurrent('should create secure fetch in VM context', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
        useLocalVM: true,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      await POST(req)

      expect(mockCreateContext).toHaveBeenCalled()
      const contextArgs = mockCreateContext.mock.calls[0][0]
      expect(contextArgs).toHaveProperty('fetch')
      expect(typeof contextArgs.fetch).toBe('function')

      expect(contextArgs.fetch.name).toBe('secureFetch')
    })

    it.concurrent('should block SSRF attacks through secure fetch wrapper', async () => {
      const { validateProxyUrl } = await import('@/lib/security/url-validation')

      expect(validateProxyUrl('http://169.254.169.254/latest/meta-data/').isValid).toBe(false)
      expect(validateProxyUrl('http://127.0.0.1:8080/admin').isValid).toBe(false)
      expect(validateProxyUrl('http://192.168.1.1/config').isValid).toBe(false)
      expect(validateProxyUrl('http://10.0.0.1/internal').isValid).toBe(false)
    })

    it.concurrent('should allow legitimate external URLs', async () => {
      const { validateProxyUrl } = await import('@/lib/security/url-validation')

      expect(validateProxyUrl('https://api.github.com/user').isValid).toBe(true)
      expect(validateProxyUrl('https://httpbin.org/get').isValid).toBe(true)
      expect(validateProxyUrl('http://example.com/api').isValid).toBe(true)
    })

    it.concurrent('should block dangerous protocols', async () => {
      const { validateProxyUrl } = await import('@/lib/security/url-validation')

      expect(validateProxyUrl('file:///etc/passwd').isValid).toBe(false)
      expect(validateProxyUrl('ftp://internal.server/files').isValid).toBe(false)
      expect(validateProxyUrl('gopher://old.server/menu').isValid).toBe(false)
    })
  })

  describe('Basic Function Execution', () => {
    it.concurrent('should execute simple JavaScript code successfully', async () => {
      const req = createMockRequest('POST', {
        code: 'return "Hello World"',
        timeout: 5000,
        useLocalVM: true,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.output).toHaveProperty('result')
      expect(data.output).toHaveProperty('executionTime')
    })

    it.concurrent('should handle missing code parameter', async () => {
      const req = createMockRequest('POST', {
        timeout: 5000,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data).toHaveProperty('error')
    })

    it.concurrent('should use default timeout when not provided', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
        useLocalVM: true,
      })

      const { POST } = await import('@/app/api/function/execute/route')
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
    it.concurrent('should resolve environment variables with {{var_name}} syntax', async () => {
      const req = createMockRequest('POST', {
        code: 'return {{API_KEY}}',
        useLocalVM: true,
        envVars: {
          API_KEY: 'secret-key-123',
        },
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // The code should be resolved to: return "secret-key-123"
    })

    it.concurrent('should resolve tag variables with <tag_name> syntax', async () => {
      const req = createMockRequest('POST', {
        code: 'return <email>',
        useLocalVM: true,
        params: {
          email: { id: '123', subject: 'Test Email' },
        },
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // The code should be resolved with the email object
    })

    it.concurrent('should NOT treat email addresses as template variables', async () => {
      const req = createMockRequest('POST', {
        code: 'return "Email sent to user"',
        useLocalVM: true,
        params: {
          email: {
            from: 'Waleed Latif <waleed@sim.ai>',
            to: 'User <user@example.com>',
          },
        },
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // Should not try to replace <waleed@sim.ai> as a template variable
    })

    it.concurrent('should only match valid variable names in angle brackets', async () => {
      const req = createMockRequest('POST', {
        code: 'return <validVar> + "<invalid@email.com>" + <another_valid>',
        useLocalVM: true,
        params: {
          validVar: 'hello',
          another_valid: 'world',
        },
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // Should replace <validVar> and <another_valid> but not <invalid@email.com>
    })
  })

  describe('Gmail Email Data Handling', () => {
    it.concurrent(
      'should handle Gmail webhook data with email addresses containing angle brackets',
      async () => {
        const gmailData = {
          email: {
            id: '123',
            from: 'Waleed Latif <waleed@sim.ai>',
            to: 'User <user@example.com>',
            subject: 'Test Email',
            bodyText: 'Hello world',
          },
          rawEmail: {
            id: '123',
            payload: {
              headers: [
                { name: 'From', value: 'Waleed Latif <waleed@sim.ai>' },
                { name: 'To', value: 'User <user@example.com>' },
              ],
            },
          },
        }

        const req = createMockRequest('POST', {
          code: 'return <email>',
          useLocalVM: true,
          params: gmailData,
        })

        const { POST } = await import('@/app/api/function/execute/route')
        const response = await POST(req)

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.success).toBe(true)
      }
    )

    it.concurrent(
      'should properly serialize complex email objects with special characters',
      async () => {
        const complexEmailData = {
          email: {
            from: 'Test User <test@example.com>',
            bodyHtml: '<div>HTML content with "quotes" and \'apostrophes\'</div>',
            bodyText: 'Text with\nnewlines\tand\ttabs',
          },
        }

        const req = createMockRequest('POST', {
          code: 'return <email>',
          useLocalVM: true,
          params: complexEmailData,
        })

        const { POST } = await import('@/app/api/function/execute/route')
        const response = await POST(req)

        expect(response.status).toBe(200)
      }
    )
  })

  describe('Custom Tools', () => {
    it.concurrent('should handle custom tool execution with direct parameter access', async () => {
      const req = createMockRequest('POST', {
        code: 'return location + " weather is sunny"',
        useLocalVM: true,
        params: {
          location: 'San Francisco',
        },
        isCustomTool: true,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // For custom tools, parameters should be directly accessible as variables
    })
  })

  describe('Security and Edge Cases', () => {
    it.concurrent('should handle malformed JSON in request body', async () => {
      const req = new NextRequest('http://localhost:3000/api/function/execute', {
        method: 'POST',
        body: 'invalid json{',
        headers: { 'Content-Type': 'application/json' },
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
    })

    it.concurrent('should handle timeout parameter', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
        useLocalVM: true,
        timeout: 10000,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      await POST(req)

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] Function execution request/),
        expect.objectContaining({
          timeout: 10000,
        })
      )
    })

    it.concurrent('should handle empty parameters object', async () => {
      const req = createMockRequest('POST', {
        code: 'return "no params"',
        useLocalVM: true,
        params: {},
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })

  describe('Enhanced Error Handling', () => {
    it('should provide detailed syntax error with line content', async () => {
      // Mock VM Script to throw a syntax error
      const mockScript = vi.fn().mockImplementation(() => {
        const error = new Error('Invalid or unexpected token')
        error.name = 'SyntaxError'
        error.stack = `user-function.js:5
      description: "This has a missing closing quote
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

SyntaxError: Invalid or unexpected token
    at new Script (node:vm:117:7)
    at POST (/path/to/route.ts:123:24)`
        throw error
      })

      vi.doMock('vm', () => ({
        createContext: mockCreateContext,
        Script: mockScript,
      }))

      const req = createMockRequest('POST', {
        code: 'const obj = {\n  name: "test",\n  description: "This has a missing closing quote\n};\nreturn obj;',
        useLocalVM: true,
        timeout: 5000,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Syntax Error')
      expect(data.error).toContain('Line 3')
      expect(data.error).toContain('description: "This has a missing closing quote')
      expect(data.error).toContain('Invalid or unexpected token')
      expect(data.error).toContain('(Check for missing quotes, brackets, or semicolons)')

      // Check debug information
      expect(data.debug).toBeDefined()
      expect(data.debug.line).toBe(3)
      expect(data.debug.errorType).toBe('SyntaxError')
      expect(data.debug.lineContent).toBe('description: "This has a missing closing quote')
    })

    it('should provide detailed runtime error with line and column', async () => {
      // Create the error object first
      const runtimeError = new Error("Cannot read properties of null (reading 'someMethod')")
      runtimeError.name = 'TypeError'
      runtimeError.stack = `TypeError: Cannot read properties of null (reading 'someMethod')
    at user-function.js:4:16
    at user-function.js:9:3
    at Script.runInContext (node:vm:147:14)`

      // Mock successful script creation but runtime error
      const mockScript = vi.fn().mockImplementation(() => ({
        runInContext: vi.fn().mockRejectedValue(runtimeError),
      }))

      vi.doMock('vm', () => ({
        createContext: mockCreateContext,
        Script: mockScript,
      }))

      const req = createMockRequest('POST', {
        code: 'const obj = null;\nreturn obj.someMethod();',
        useLocalVM: true,
        timeout: 5000,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Type Error')
      expect(data.error).toContain('Line 2')
      expect(data.error).toContain('return obj.someMethod();')
      expect(data.error).toContain('Cannot read properties of null')

      // Check debug information
      expect(data.debug).toBeDefined()
      expect(data.debug.line).toBe(2)
      expect(data.debug.column).toBe(16)
      expect(data.debug.errorType).toBe('TypeError')
      expect(data.debug.lineContent).toBe('return obj.someMethod();')
    })

    it('should handle ReferenceError with enhanced details', async () => {
      // Create the error object first
      const referenceError = new Error('undefinedVariable is not defined')
      referenceError.name = 'ReferenceError'
      referenceError.stack = `ReferenceError: undefinedVariable is not defined
    at user-function.js:4:8
    at Script.runInContext (node:vm:147:14)`

      const mockScript = vi.fn().mockImplementation(() => ({
        runInContext: vi.fn().mockRejectedValue(referenceError),
      }))

      vi.doMock('vm', () => ({
        createContext: mockCreateContext,
        Script: mockScript,
      }))

      const req = createMockRequest('POST', {
        code: 'const x = 42;\nreturn undefinedVariable + x;',
        useLocalVM: true,
        timeout: 5000,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Reference Error')
      expect(data.error).toContain('Line 2')
      expect(data.error).toContain('return undefinedVariable + x;')
      expect(data.error).toContain('undefinedVariable is not defined')
    })

    it('should handle errors without line content gracefully', async () => {
      const mockScript = vi.fn().mockImplementation(() => {
        const error = new Error('Generic error without stack trace')
        error.name = 'Error'
        // No stack trace
        throw error
      })

      vi.doMock('vm', () => ({
        createContext: mockCreateContext,
        Script: mockScript,
      }))

      const req = createMockRequest('POST', {
        code: 'return "test";',
        useLocalVM: true,
        timeout: 5000,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toBe('Generic error without stack trace')

      // Should still have debug info, but without line details
      expect(data.debug).toBeDefined()
      expect(data.debug.errorType).toBe('Error')
      expect(data.debug.line).toBeUndefined()
      expect(data.debug.lineContent).toBeUndefined()
    })

    it('should extract line numbers from different stack trace formats', async () => {
      const mockScript = vi.fn().mockImplementation(() => {
        const error = new Error('Test error')
        error.name = 'Error'
        error.stack = `Error: Test error
    at user-function.js:7:25
    at async function
    at Script.runInContext (node:vm:147:14)`
        throw error
      })

      vi.doMock('vm', () => ({
        createContext: mockCreateContext,
        Script: mockScript,
      }))

      const req = createMockRequest('POST', {
        code: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nreturn a + b + c + d;',
        useLocalVM: true,
        timeout: 5000,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)

      // Line 7 in VM should map to line 5 in user code (7 - 3 + 1 = 5)
      expect(data.debug.line).toBe(5)
      expect(data.debug.column).toBe(25)
      expect(data.debug.lineContent).toBe('return a + b + c + d;')
    })

    it.concurrent('should provide helpful suggestions for common syntax errors', async () => {
      const mockScript = vi.fn().mockImplementation(() => {
        const error = new Error('Unexpected end of input')
        error.name = 'SyntaxError'
        error.stack = 'user-function.js:4\nSyntaxError: Unexpected end of input'
        throw error
      })

      vi.doMock('vm', () => ({
        createContext: mockCreateContext,
        Script: mockScript,
      }))

      const req = createMockRequest('POST', {
        code: 'const obj = {\n  name: "test"\n// Missing closing brace',
        useLocalVM: true,
        timeout: 5000,
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Syntax Error')
      expect(data.error).toContain('Unexpected end of input')
      expect(data.error).toContain('(Check for missing closing brackets or braces)')
    })
  })

  describe('Utility Functions', () => {
    it.concurrent('should properly escape regex special characters', async () => {
      // This tests the escapeRegExp function indirectly
      const req = createMockRequest('POST', {
        code: 'return {{special.chars+*?}}',
        useLocalVM: true,
        envVars: {
          'special.chars+*?': 'escaped-value',
        },
      })

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      // Should handle special regex characters in variable names
    })

    it.concurrent('should handle JSON serialization edge cases', async () => {
      // Test with complex but not circular data first
      const req = createMockRequest('POST', {
        code: 'return <complexData>',
        useLocalVM: true,
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

      const { POST } = await import('@/app/api/function/execute/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })
})
