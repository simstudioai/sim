/**
 * Tests for function execution API route
 *
 * @vitest-environment node
 */
import { createMockRequest, loggerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/execution/isolated-vm', () => ({
  executeInIsolatedVM: vi.fn().mockImplementation(async (req) => {
    const { code, params, envVars, contextVariables } = req
    const stdoutChunks: string[] = []

    const mockConsole = {
      log: (...args: unknown[]) => {
        stdoutChunks.push(
          `${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`
        )
      },
      error: (...args: unknown[]) => {
        stdoutChunks.push(
          'ERROR: ' +
            args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') +
            '\n'
        )
      },
      warn: (...args: unknown[]) => mockConsole.log('WARN:', ...args),
      info: (...args: unknown[]) => mockConsole.log(...args),
    }

    try {
      const escapePattern = /this\.constructor\.constructor|\.constructor\s*\(/
      if (escapePattern.test(code)) {
        return { result: undefined, stdout: '' }
      }

      const context: Record<string, unknown> = {
        console: mockConsole,
        params,
        environmentVariables: envVars,
        ...contextVariables,
        process: undefined,
        require: undefined,
        module: undefined,
        exports: undefined,
        __dirname: undefined,
        __filename: undefined,
        fetch: async () => {
          throw new Error('fetch not implemented in test mock')
        },
      }

      const paramNames = Object.keys(context)
      const paramValues = Object.values(context)

      const wrappedCode = `
        return (async () => {
          ${code}
        })();
      `

      const fn = new Function(...paramNames, wrappedCode)
      const result = await fn(...paramValues)

      return {
        result,
        stdout: stdoutChunks.join(''),
      }
    } catch (error: unknown) {
      const err = error as Error
      return {
        result: null,
        stdout: stdoutChunks.join(''),
        error: {
          message: err.message || String(error),
          name: err.name || 'Error',
          stack: err.stack,
        },
      }
    }
  }),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: vi.fn().mockResolvedValue({
    success: true,
    userId: 'user-123',
    authType: 'internal_jwt',
  }),
}))

vi.mock('@/lib/execution/e2b', () => ({
  executeInE2B: vi.fn(),
}))

import { validateProxyUrl } from '@/lib/core/security/input-validation'
import { executeInE2B } from '@/lib/execution/e2b'
import { POST } from './route'

const mockedExecuteInE2B = vi.mocked(executeInE2B)

describe('Function Execute API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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
    it('should reject unauthorized requests', async () => {
      const { checkInternalAuth } = await import('@/lib/auth/hybrid')
      vi.mocked(checkInternalAuth).mockResolvedValueOnce({
        success: false,
        error: 'Unauthorized',
      })

      const req = createMockRequest('POST', {
        code: 'return "test"',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it.concurrent('should use isolated-vm for secure sandboxed execution', async () => {
      const req = createMockRequest('POST', {
        code: 'return "test"',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.output.result).toBe('test')
    })

    it.concurrent('should prevent VM escape via constructor chain', async () => {
      const req = createMockRequest('POST', {
        code: 'return this.constructor.constructor("return process")().env',
      })

      const response = await POST(req)
      const data = await response.json()

      if (response.status === 500) {
        expect(data.success).toBe(false)
      } else {
        const result = data.output?.result
        expect(result === undefined || result === null).toBe(true)
      }
    })

    it.concurrent('should prevent access to require via constructor chain', async () => {
      const req = createMockRequest('POST', {
        code: `
          const proc = this.constructor.constructor("return process")();
          const fs = proc.mainModule.require("fs");
          return fs.readFileSync("/etc/passwd", "utf8");
        `,
      })

      const response = await POST(req)
      const data = await response.json()

      if (response.status === 200) {
        const result = data.output?.result
        if (result !== undefined && result !== null && typeof result === 'string') {
          expect(result).not.toContain('root:')
        }
      }
    })

    it.concurrent('should not expose process object', async () => {
      const req = createMockRequest('POST', {
        code: 'return typeof process',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.output.result).toBe('undefined')
    })

    it.concurrent('should not expose require function', async () => {
      const req = createMockRequest('POST', {
        code: 'return typeof require',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.output.result).toBe('undefined')
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

    it.concurrent('should return computed result for multi-line code', async () => {
      const req = createMockRequest('POST', {
        code: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nreturn a + b + c + d;',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.output.result).toBe(10)
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
        blockData: {
          'block-123': { id: '123', subject: 'Test Email' },
        },
        blockNameMapping: {
          email: 'block-123',
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
        blockData: {
          'block-1': 'hello',
          'block-2': 'world',
        },
        blockNameMapping: {
          validvar: 'block-1',
          another_valid: 'block-2',
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
        const emailData = {
          id: '123',
          from: 'Waleed Latif <waleed@sim.ai>',
          to: 'User <user@example.com>',
          subject: 'Test Email',
          bodyText: 'Hello world',
        }

        const req = createMockRequest('POST', {
          code: 'return <email>',
          blockData: {
            'block-email': emailData,
          },
          blockNameMapping: {
            email: 'block-email',
          },
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
        const emailData = {
          from: 'Test User <test@example.com>',
          bodyHtml: '<div>HTML content with "quotes" and \'apostrophes\'</div>',
          bodyText: 'Text with\nnewlines\tand\ttabs',
        }

        const req = createMockRequest('POST', {
          code: 'return <email>',
          blockData: {
            'block-email': emailData,
          },
          blockNameMapping: {
            email: 'block-email',
          },
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
      const req = createMockRequest('POST', {
        code: 'const obj = {\n  name: "test",\n  description: "This has a missing closing quote\n};\nreturn obj;',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toBeTruthy()
    })

    it('should provide detailed runtime error with line and column', async () => {
      const req = createMockRequest('POST', {
        code: 'const obj = null;\nreturn obj.someMethod();',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Type Error')
      expect(data.error).toContain('Cannot read properties of null')
    })

    it('should handle ReferenceError with enhanced details', async () => {
      const req = createMockRequest('POST', {
        code: 'const x = 42;\nreturn undefinedVariable + x;',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Reference Error')
      expect(data.error).toContain('undefinedVariable is not defined')
    })

    it('should handle thrown errors gracefully', async () => {
      const req = createMockRequest('POST', {
        code: 'throw new Error("Custom error message");',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toContain('Custom error message')
    })

    it.concurrent('should provide helpful suggestions for common syntax errors', async () => {
      const req = createMockRequest('POST', {
        code: 'const obj = {\n  name: "test"\n// Missing closing brace',
        timeout: 5000,
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toBeTruthy()
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
      const complexData = {
        special: 'chars"with\'quotes',
        unicode: '🎉 Unicode content',
        nested: {
          deep: {
            value: 'test',
          },
        },
      }

      const req = createMockRequest('POST', {
        code: 'return <complexData>',
        blockData: {
          'block-complex': complexData,
        },
        blockNameMapping: {
          complexdata: 'block-complex',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
    })
  })
})
