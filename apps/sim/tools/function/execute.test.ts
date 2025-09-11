/**
 * @vitest-environment jsdom
 *
 * Function Execute Tool Unit Tests
 *
 * This file contains unit tests for the Function Execute tool,
 * which runs JavaScript code in a secure sandbox.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolTester } from '@/tools/__test-utils__/test-tools'
import { functionExecuteTool } from '@/tools/function/execute'

describe('Function Execute Tool', () => {
  let tester: ToolTester

  beforeEach(() => {
    tester = new ToolTester(functionExecuteTool)
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  })

  afterEach(() => {
    tester.cleanup()
    vi.resetAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = undefined
  })

  describe('Request Construction', () => {
    it.concurrent('should set correct URL for code execution', () => {
      // Since this is an internal route, actual URL will be the concatenated base URL + path
      expect(tester.getRequestUrl({})).toBe('/api/function/execute')
    })

    it.concurrent('should include correct headers for JSON payload', () => {
      const headers = tester.getRequestHeaders({
        code: 'return 42',
      })

      expect(headers['Content-Type']).toBe('application/json')
    })

    it.concurrent('should format single string code correctly', () => {
      const body = tester.getRequestBody({
        code: 'return 42',
        envVars: {},
        isCustomTool: false,
        timeout: 5000,
        workflowId: undefined,
      })

      expect(body).toEqual({
        code: 'return 42',
        envVars: {},
        workflowVariables: {},
        blockData: {},
        blockNameMapping: {},
        isCustomTool: false,
        language: 'javascript',
        useLocalVM: false,
        timeout: 5000,
        workflowId: undefined,
      })
    })

    it.concurrent('should format array of code blocks correctly', () => {
      const body = tester.getRequestBody({
        code: [
          { content: 'const x = 40;', id: 'block1' },
          { content: 'const y = 2;', id: 'block2' },
          { content: 'return x + y;', id: 'block3' },
        ],
        envVars: {},
        isCustomTool: false,
        timeout: 10000,
        workflowId: undefined,
      })

      expect(body).toEqual({
        code: 'const x = 40;\nconst y = 2;\nreturn x + y;',
        timeout: 10000,
        envVars: {},
        workflowVariables: {},
        blockData: {},
        blockNameMapping: {},
        isCustomTool: false,
        language: 'javascript',
        useLocalVM: false,
        workflowId: undefined,
      })
    })

    it.concurrent('should use default timeout and memory limit when not provided', () => {
      const body = tester.getRequestBody({
        code: 'return 42',
      })

      expect(body).toEqual({
        code: 'return 42',
        timeout: 10000,
        envVars: {},
        workflowVariables: {},
        blockData: {},
        blockNameMapping: {},
        isCustomTool: false,
        language: 'javascript',
        useLocalVM: false,
        workflowId: undefined,
      })
    })
  })

  describe('Response Handling', () => {
    it.concurrent('should process successful code execution response', async () => {
      tester.setup({
        success: true,
        output: {
          result: 42,
          stdout: 'console.log output',
        },
      })

      const result = await tester.execute({
        code: 'console.log("output"); return 42;',
      })

      expect(result.success).toBe(true)
      expect(result.output.result).toBe(42)
      expect(result.output.stdout).toBe('console.log output')
    })

    it.concurrent('should handle execution errors', async () => {
      tester.setup(
        {
          success: false,
          error: 'Syntax error in code',
        },
        { ok: false, status: 400 }
      )

      const result = await tester.execute({
        code: 'invalid javascript code!!!',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toBe('Syntax error in code')
    })

    it.concurrent('should handle timeout errors', async () => {
      tester.setup(
        {
          success: false,
          error: 'Code execution timed out',
        },
        { ok: false, status: 408 }
      )

      const result = await tester.execute({
        code: 'while(true) {}',
        timeout: 1000,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Code execution timed out')
    })
  })

  describe('Error Handling', () => {
    it.concurrent('should handle syntax error with line content', async () => {
      tester.setup(
        {
          success: false,
          error:
            'Syntax Error: Line 3: `description: "This has a missing closing quote` - Invalid or unexpected token (Check for missing quotes, brackets, or semicolons)',
          output: {
            result: null,
            stdout: '',
            executionTime: 5,
          },
          debug: {
            line: 3,
            column: undefined,
            errorType: 'SyntaxError',
            lineContent: 'description: "This has a missing closing quote',
            stack: 'user-function.js:5\n      description: "This has a missing closing quote\n...',
          },
        },
        { ok: false, status: 500 }
      )

      const result = await tester.execute({
        code: 'const obj = {\n  name: "test",\n  description: "This has a missing closing quote\n};\nreturn obj;',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Syntax Error')
      expect(result.error).toContain('Line 3')
      expect(result.error).toContain('description: "This has a missing closing quote')
      expect(result.error).toContain('Invalid or unexpected token')
      expect(result.error).toContain('(Check for missing quotes, brackets, or semicolons)')
    })

    it.concurrent('should handle runtime error with line and column', async () => {
      tester.setup(
        {
          success: false,
          error:
            "Type Error: Line 2:16: `return obj.someMethod();` - Cannot read properties of null (reading 'someMethod')",
          output: {
            result: null,
            stdout: 'ERROR: {}\n',
            executionTime: 12,
          },
          debug: {
            line: 2,
            column: 16,
            errorType: 'TypeError',
            lineContent: 'return obj.someMethod();',
            stack: 'TypeError: Cannot read properties of null...',
          },
        },
        { ok: false, status: 500 }
      )

      const result = await tester.execute({
        code: 'const obj = null;\nreturn obj.someMethod();',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Type Error')
      expect(result.error).toContain('Line 2:16')
      expect(result.error).toContain('return obj.someMethod();')
      expect(result.error).toContain('Cannot read properties of null')
    })

    it.concurrent('should handle error information in tool response', async () => {
      tester.setup(
        {
          success: false,
          error: 'Reference Error: Line 1: `return undefinedVar` - undefinedVar is not defined',
          output: {
            result: null,
            stdout: '',
            executionTime: 3,
          },
          debug: {
            line: 1,
            column: 7,
            errorType: 'ReferenceError',
            lineContent: 'return undefinedVar',
            stack: 'ReferenceError: undefinedVar is not defined...',
          },
        },
        { ok: false, status: 500 }
      )

      const result = await tester.execute({
        code: 'return undefinedVar',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Reference Error: Line 1: `return undefinedVar` - undefinedVar is not defined'
      )
    })

    it.concurrent('should preserve debug information in error object', async () => {
      tester.setup(
        {
          success: false,
          error: 'Syntax Error: Line 2 - Invalid syntax',
          debug: {
            line: 2,
            column: 5,
            errorType: 'SyntaxError',
            lineContent: 'invalid syntax here',
            stack: 'SyntaxError: Invalid syntax...',
          },
        },
        { ok: false, status: 500 }
      )

      const result = await tester.execute({
        code: 'valid line\ninvalid syntax here',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Syntax Error: Line 2 - Invalid syntax')
    })

    it.concurrent('should handle enhanced error without line information', async () => {
      tester.setup(
        {
          success: false,
          error: 'Generic error message',
          debug: {
            errorType: 'Error',
            stack: 'Error: Generic error message...',
          },
        },
        { ok: false, status: 500 }
      )

      const result = await tester.execute({
        code: 'return "test";',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Generic error message')
    })

    it.concurrent('should provide line-specific error message when available', async () => {
      tester.setup(
        {
          success: false,
          error:
            'Type Error: Line 5:20: `obj.nonExistentMethod()` - obj.nonExistentMethod is not a function',
          debug: {
            line: 5,
            column: 20,
            errorType: 'TypeError',
            lineContent: 'obj.nonExistentMethod()',
          },
        },
        { ok: false, status: 500 }
      )

      const result = await tester.execute({
        code: 'const obj = {};\nobj.nonExistentMethod();',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Line 5:20')
      expect(result.error).toContain('obj.nonExistentMethod()')
    })
  })

  describe('Edge Cases', () => {
    it.concurrent('should handle empty code input', async () => {
      await tester.execute({
        code: '',
      })

      const body = tester.getRequestBody({ code: '' })
      expect(body.code).toBe('')
    })

    it.concurrent('should handle extremely short timeout', async () => {
      const body = tester.getRequestBody({
        code: 'return 42',
        timeout: 1, // 1ms timeout
      })

      expect(body.timeout).toBe(1)
    })
  })
})
