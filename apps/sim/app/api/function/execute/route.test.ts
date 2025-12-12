/**
 * Tests for function execution API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockCreateContext = vi.fn()
const mockRunInContext = vi.fn()
const mockScript = vi.fn()
const mockExecuteInE2B = vi.fn()

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('vm', () => ({
  createContext: vi.fn(),
  Script: vi.fn(),
}))

vi.mock('@/lib/execution/e2b', () => ({
  executeInE2B: vi.fn(),
}))

import { createContext, Script } from 'vm'
import { validateProxyUrl } from '@/lib/core/security/input-validation'
import { executeInE2B } from '@/lib/execution/e2b'
import { createLogger } from '@/lib/logs/console/logger'
import { POST } from './route'

const mockedCreateContext = vi.mocked(createContext)
const mockedScript = vi.mocked(Script)
const mockedExecuteInE2B = vi.mocked(executeInE2B)
const mockedCreateLogger = vi.mocked(createLogger)

describe('Function Execute API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockedCreateContext.mockReturnValue({})
    mockRunInContext.mockResolvedValue('vm success')
    mockedScript.mockImplementation((): any => ({
      runInContext: mockRunInContext,
    }))
    mockedExecuteInE2B.mockResolvedValue({
      result: 'e2b success',
      stdout: 'e2b output',
      sandboxId: 'test-sandbox-id',
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Security Tests', () => {
    it.concurrent('should create secure fetch in VM context', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
      })

      await POST(req)

      expect(mockedCreateContext).toHaveBeenCalled()
      const contextArgs = mockedCreateContext.mock.calls[0][0]
      expect(contextArgs).toHaveProperty('fetch')
      expect(typeof (contextArgs as any).fetch).toBe('function')

      expect((contextArgs as any).fetch?.name).toBe('secureFetch')
    })

    it.concurrent('should block SSRF attacks through secure fetch wrapper', async () => {
      expect(validateProxyUrl('http://169.254.169.254/latest/meta-data/').isValid).toBe(false)
      expect(validateProxyUrl('http://127.0.0.1:8080/admin').isValid).toBe(false)
      expect(validateProxyUrl('http://192.168.1.1/config').isValid).toBe(false)
      expect(validateProxyUrl('http://10.0.0.1/internal').isValid).toBe(false)
    })

    it.concurrent('should allow legitimate external URLs', async () => {
      expect(validateProxyUrl('https://api.github.com/user').isValid).toBe(true)
      expect(validateProxyUrl('https://httpbin.org/get').isValid).toBe(true)
      expect(validateProxyUrl('https://example.com/api').isValid).toBe(true)
    })

    it.concurrent('should block dangerous protocols', async () => {
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
      })

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

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data).toHaveProperty('error')
    })

    it.concurrent('should use default timeout when not provided', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('Template Variable Resolution', () => {
    it.concurrent('should resolve environment variables with {{var_name}} syntax', async () => {
      const req = createMockRequest('POST', {
        code: 'return {{API_KEY}}',
        envVars: {
          API_KEY: 'secret-key-123',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })

    it.concurrent('should resolve tag variables with <tag_name> syntax', async () => {
      const req = createMockRequest('POST', {
        code: 'return <email>',
        params: {
          email: { id: '123', subject: 'Test Email' },
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })

    it.concurrent('should NOT treat email addresses as template variables', async () => {
      const req = createMockRequest('POST', {
        code: 'return "Email sent to user"',
        params: {
          email: {
            from: 'Waleed Latif <waleed@sim.ai>',
            to: 'User <user@example.com>',
          },
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })

    it.concurrent('should only match valid variable names in angle brackets', async () => {
      const req = createMockRequest('POST', {
        code: 'return <validVar> + "<invalid@email.com>" + <another_valid>',
        params: {
          validVar: 'hello',
          another_valid: 'world',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
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
          params: gmailData,
        })

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
          params: complexEmailData,
        })

        const response = await POST(req)

        expect(response.status).toBe(200)
      }
    )
  })

  describe('Custom Tools', () => {
    it.concurrent('should handle custom tool execution with direct parameter access', async () => {
      const req = createMockRequest('POST', {
        code: 'return location + " weather is sunny"',
        params: {
          location: 'San Francisco',
        },
        isCustomTool: true,
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })

  describe('Security and Edge Cases', () => {
    it.concurrent('should handle malformed JSON in request body', async () => {
      const req = new NextRequest('http://localhost:3000/api/function/execute', {
        method: 'POST',
        body: 'invalid json{',
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
    })

    it.concurrent('should handle timeout parameter', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
        timeout: 10000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it.concurrent('should handle empty parameters object', async () => {
      const req = createMockRequest('POST', {
        code: 'return "no params"',
        params: {},
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })

  describe('Enhanced Error Handling', () => {
    it('should provide detailed syntax error with line content', async () => {
      const syntaxError = new Error('Invalid or unexpected token')
      syntaxError.name = 'SyntaxError'
      syntaxError.stack = `user-function.js:5
      description: "This has a missing closing quote
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

SyntaxError: Invalid or unexpected token
    at new Script (node:vm:117:7)
    at POST (/path/to/route.ts:123:24)`

      mockedScript.mockImplementationOnce(() => {
        throw syntaxError
      })

      const req = createMockRequest('POST', {
        code: 'const obj = {\n  name: "test",\n  description: "This has a missing closing quote\n};\nreturn obj;',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Syntax Error')
      expect(data.error).toContain('Line 3')
      expect(data.error).toContain('description: "This has a missing closing quote')
      expect(data.error).toContain('Invalid or unexpected token')
      expect(data.error).toContain('(Check for missing quotes, brackets, or semicolons)')

      expect(data.debug).toBeDefined()
      expect(data.debug.line).toBe(3)
      expect(data.debug.errorType).toBe('SyntaxError')
      expect(data.debug.lineContent).toBe('description: "This has a missing closing quote')
    })

    it('should provide detailed runtime error with line and column', async () => {
      const runtimeError = new Error("Cannot read properties of null (reading 'someMethod')")
      runtimeError.name = 'TypeError'
      runtimeError.stack = `TypeError: Cannot read properties of null (reading 'someMethod')
    at user-function.js:4:16
    at user-function.js:9:3
    at Script.runInContext (node:vm:147:14)`

      mockRunInContext.mockRejectedValueOnce(runtimeError)

      const req = createMockRequest('POST', {
        code: 'const obj = null;\nreturn obj.someMethod();',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Type Error')
      expect(data.error).toContain('Line 2')
      expect(data.error).toContain('return obj.someMethod();')
      expect(data.error).toContain('Cannot read properties of null')

      expect(data.debug).toBeDefined()
      expect(data.debug.line).toBe(2)
      expect(data.debug.column).toBe(16)
      expect(data.debug.errorType).toBe('TypeError')
      expect(data.debug.lineContent).toBe('return obj.someMethod();')
    })

    it('should handle ReferenceError with enhanced details', async () => {
      const referenceError = new Error('undefinedVariable is not defined')
      referenceError.name = 'ReferenceError'
      referenceError.stack = `ReferenceError: undefinedVariable is not defined
    at user-function.js:4:8
    at Script.runInContext (node:vm:147:14)`

      mockRunInContext.mockRejectedValueOnce(referenceError)

      const req = createMockRequest('POST', {
        code: 'const x = 42;\nreturn undefinedVariable + x;',
        timeout: 5000,
      })

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
      const genericError = new Error('Generic error without stack trace')
      genericError.name = 'Error'

      mockedScript.mockImplementationOnce(() => {
        throw genericError
      })

      const req = createMockRequest('POST', {
        code: 'return "test";',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toBe('Generic error without stack trace')

      expect(data.debug).toBeDefined()
      expect(data.debug.errorType).toBe('Error')
      expect(data.debug.line).toBeUndefined()
      expect(data.debug.lineContent).toBeUndefined()
    })

    it('should extract line numbers from different stack trace formats', async () => {
      const testError = new Error('Test error')
      testError.name = 'Error'
      testError.stack = `Error: Test error
    at user-function.js:7:25
    at async function
    at Script.runInContext (node:vm:147:14)`

      mockedScript.mockImplementationOnce(() => {
        throw testError
      })

      const req = createMockRequest('POST', {
        code: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nreturn a + b + c + d;',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)

      expect(data.debug.line).toBe(5)
      expect(data.debug.column).toBe(25)
      expect(data.debug.lineContent).toBe('return a + b + c + d;')
    })

    it.concurrent('should provide helpful suggestions for common syntax errors', async () => {
      const syntaxError = new Error('Unexpected end of input')
      syntaxError.name = 'SyntaxError'
      syntaxError.stack = 'user-function.js:4\nSyntaxError: Unexpected end of input'

      mockedScript.mockImplementationOnce(() => {
        throw syntaxError
      })

      const req = createMockRequest('POST', {
        code: 'const obj = {\n  name: "test"\n// Missing closing brace',
        timeout: 5000,
      })

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
      const req = createMockRequest('POST', {
        code: 'return {{special.chars+*?}}',
        envVars: {
          'special.chars+*?': 'escaped-value',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })

    it.concurrent('should handle JSON serialization edge cases', async () => {
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

      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })
})
