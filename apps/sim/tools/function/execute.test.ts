/**
 * @vitest-environment jsdom
 *
 * Function Execute Tool Unit Tests
 *
 * This file contains unit tests for the Function Execute tool,
 * which runs JavaScript code in a secure sandbox.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToolTester } from '../__test-utils__/test-tools'
import { functionExecuteTool } from './execute'

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
    test('should set correct URL for code execution', () => {
      // Since this is an internal route, actual URL will be the concatenated base URL + path
      expect(tester.getRequestUrl({})).toBe('/api/function/execute')
    })

    test('should include correct headers for JSON payload', () => {
      const headers = tester.getRequestHeaders({
        code: 'return 42',
      })

      expect(headers['Content-Type']).toBe('application/json')
    })

    test('should format single string code correctly', () => {
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
        blockData: {},
        blockNameMapping: {},
        isCustomTool: false,
        timeout: 5000,
        workflowId: undefined,
      })
    })

    test('should format array of code blocks correctly', () => {
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
        blockData: {},
        blockNameMapping: {},
        isCustomTool: false,
        workflowId: undefined,
      })
    })

    test('should use default timeout and memory limit when not provided', () => {
      const body = tester.getRequestBody({
        code: 'return 42',
      })

      expect(body).toEqual({
        code: 'return 42',
        timeout: 10000,
        envVars: {},
        blockData: {},
        blockNameMapping: {},
        isCustomTool: false,
        workflowId: undefined,
      })
    })
  })

  describe('Response Handling', () => {
    test('should process successful code execution response', async () => {
      // Setup a successful response
      tester.setup({
        success: true,
        output: {
          result: 42,
          stdout: 'console.log output',
        },
      })

      // Execute the tool
      const result = await tester.execute({
        code: 'console.log("output"); return 42;',
      })

      // Check the result
      expect(result.success).toBe(true)
      expect(result.output.result).toBe(42)
      expect(result.output.stdout).toBe('console.log output')
    })

    test('should handle execution errors', async () => {
      // Setup error response
      tester.setup(
        {
          success: false,
          error: 'Syntax error in code',
        },
        { ok: false, status: 400 }
      )

      // Execute the tool with invalid code
      const result = await tester.execute({
        code: 'invalid javascript code!!!',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toBe('Syntax error in code')
    })

    test('should handle timeout errors', async () => {
      // Setup timeout error response
      tester.setup(
        {
          success: false,
          error: 'Code execution timed out',
        },
        { ok: false, status: 408 }
      )

      // Execute the tool with code that would time out
      const result = await tester.execute({
        code: 'while(true) {}',
        timeout: 1000,
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBe('Code execution timed out')
    })
  })

  describe('Enhanced Error Handling', () => {
    test('should handle enhanced syntax error with line content', async () => {
      // Setup enhanced error response with debug information
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

      // Execute the tool with syntax error
      const result = await tester.execute({
        code: 'const obj = {\n  name: "test",\n  description: "This has a missing closing quote\n};\nreturn obj;',
      })

      // Check enhanced error handling
      expect(result.success).toBe(false)
      expect(result.error).toContain('Syntax Error')
      expect(result.error).toContain('Line 3')
      expect(result.error).toContain('description: "This has a missing closing quote')
      expect(result.error).toContain('Invalid or unexpected token')
      expect(result.error).toContain('(Check for missing quotes, brackets, or semicolons)')
    })

    test('should handle enhanced runtime error with line and column', async () => {
      // Setup enhanced runtime error response
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

      // Execute the tool with runtime error
      const result = await tester.execute({
        code: 'const obj = null;\nreturn obj.someMethod();',
      })

      // Check enhanced error handling
      expect(result.success).toBe(false)
      expect(result.error).toContain('Type Error')
      expect(result.error).toContain('Line 2:16')
      expect(result.error).toContain('return obj.someMethod();')
      expect(result.error).toContain('Cannot read properties of null')
    })

    test('should handle enhanced error information in tool response', async () => {
      // Setup enhanced error response with full debug info
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

      // Execute the tool with reference error
      const result = await tester.execute({
        code: 'return undefinedVar',
      })

      // Check that the tool properly captures enhanced error
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Reference Error: Line 1: `return undefinedVar` - undefinedVar is not defined'
      )
    })

    test('should preserve debug information in error object', async () => {
      // Setup enhanced error response
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

      // Execute the tool
      const result = await tester.execute({
        code: 'valid line\ninvalid syntax here',
      })

      // Check that enhanced error information is available
      expect(result.success).toBe(false)
      expect(result.error).toBe('Syntax Error: Line 2 - Invalid syntax')

      // Note: In this test framework, debug information would be available
      // in the response object, but the tool transforms it into the error message
    })

    test('should handle enhanced error without line information', async () => {
      // Setup error response without line information
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

      // Execute the tool
      const result = await tester.execute({
        code: 'return "test";',
      })

      // Check error handling without enhanced line info
      expect(result.success).toBe(false)
      expect(result.error).toBe('Generic error message')
    })

    test('should provide line-specific error message when available', async () => {
      // Setup enhanced error response with line info
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

      // Execute the tool
      const result = await tester.execute({
        code: 'const obj = {};\nobj.nonExistentMethod();',
      })

      // Check that enhanced error message is provided
      expect(result.success).toBe(false)
      expect(result.error).toContain('Line 5:20')
      expect(result.error).toContain('obj.nonExistentMethod()')
    })
  })

  describe('Edge Cases', () => {
    test('should handle empty code input', async () => {
      // Execute with empty code - this should still pass through to the API
      await tester.execute({
        code: '',
      })

      // Just verify the request was made with empty code
      const body = tester.getRequestBody({ code: '' })
      expect(body.code).toBe('')
    })

    test('should handle extremely short timeout', async () => {
      // Edge case with very short timeout
      const body = tester.getRequestBody({
        code: 'return 42',
        timeout: 1, // 1ms timeout
      })

      // Should still pass through the short timeout
      expect(body.timeout).toBe(1)
    })
  })
})
