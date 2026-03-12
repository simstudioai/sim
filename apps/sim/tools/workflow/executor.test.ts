import { describe, expect, it } from 'vitest'
import { workflowExecutorTool } from '@/tools/workflow/executor'

describe('workflowExecutorTool', () => {
  describe('request.body', () => {
    const buildBody = workflowExecutorTool.request.body!

    it.concurrent('should pass through object inputMapping unchanged (LLM-provided args)', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: { firstName: 'John', lastName: 'Doe', age: 30 },
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: { firstName: 'John', lastName: 'Doe', age: 30 },
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should use deployed state when isDeployedContext is true', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: { name: 'Test' },
        _context: { isDeployedContext: true },
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: { name: 'Test' },
        triggerType: 'api',
        useDraftState: false,
      })
    })

    it.concurrent('should use draft state when isDeployedContext is false', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: { name: 'Test' },
        _context: { isDeployedContext: false },
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: { name: 'Test' },
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should parse JSON string inputMapping (UI-provided via tool-input)', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: '{"firstName": "John", "lastName": "Doe"}',
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: { firstName: 'John', lastName: 'Doe' },
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should handle nested objects in JSON string inputMapping', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: '{"user": {"name": "John", "email": "john@example.com"}, "count": 5}',
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: { user: { name: 'John', email: 'john@example.com' }, count: 5 },
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should handle arrays in JSON string inputMapping', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: '{"tags": ["a", "b", "c"], "ids": [1, 2, 3]}',
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: { tags: ['a', 'b', 'c'], ids: [1, 2, 3] },
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should default to empty object when inputMapping is undefined', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: undefined,
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: {},
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should default to empty object when inputMapping is null', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: null as any,
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: {},
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should fallback to empty object for invalid JSON string', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: 'not valid json {',
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: {},
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should fallback to empty object for empty string', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: '',
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: {},
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should handle empty object inputMapping', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: {},
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: {},
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should handle empty JSON object string', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: '{}',
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: {},
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should preserve special characters in string values', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: '{"message": "Hello\\nWorld", "path": "C:\\\\Users"}',
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: { message: 'Hello\nWorld', path: 'C:\\Users' },
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should handle unicode characters in JSON string', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: '{"greeting": "こんにちは", "emoji": "👋"}',
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: { greeting: 'こんにちは', emoji: '👋' },
        triggerType: 'api',
        useDraftState: true,
      })
    })

    it.concurrent('should not modify object with string values that look like JSON', () => {
      const params = {
        workflowId: 'test-workflow-id',
        inputMapping: { data: '{"nested": "json"}' },
      }

      const result = buildBody(params)

      expect(result).toEqual({
        input: { data: '{"nested": "json"}' },
        triggerType: 'api',
        useDraftState: true,
      })
    })
  })

  describe('request.url', () => {
    it.concurrent('should build correct URL with workflowId', () => {
      const url = workflowExecutorTool.request.url as (params: any) => string

      expect(url({ workflowId: 'abc-123' })).toBe('/api/workflows/abc-123/execute')
      expect(url({ workflowId: 'my-workflow' })).toBe('/api/workflows/my-workflow/execute')
    })
  })

  describe('transformResponse', () => {
    const transformResponse = workflowExecutorTool.transformResponse!

    function mockResponse(body: any, status = 200): Response {
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as unknown as Response
    }

    it.concurrent('should parse standard format response', async () => {
      const body = {
        success: true,
        executionId: '550e8400-e29b-41d4-a716-446655440000',
        output: { result: 'hello' },
        metadata: { duration: 500 },
      }

      const result = await transformResponse(mockResponse(body))

      expect(result.success).toBe(true)
      expect(result.output).toEqual({ result: 'hello' })
      expect(result.duration).toBe(500)
      expect(result.error).toBeUndefined()
    })

    it.concurrent('should parse standard format failure', async () => {
      const body = {
        success: false,
        executionId: '550e8400-e29b-41d4-a716-446655440000',
        output: {},
        error: 'Something went wrong',
      }

      const result = await transformResponse(mockResponse(body))

      expect(result.success).toBe(false)
      expect(result.error).toBe('Something went wrong')
    })

    it.concurrent('should default success to false when missing', async () => {
      const body = { output: { data: 'test' } }

      const result = await transformResponse(mockResponse(body))

      expect(result.success).toBe(false)
      expect(result.output).toEqual({ data: 'test' })
    })

    it.concurrent('should default output to empty object when missing', async () => {
      const body = { success: true }

      const result = await transformResponse(mockResponse(body))

      expect(result.success).toBe(true)
      expect(result.output).toEqual({})
      expect(result.result).toEqual({})
    })

    it.concurrent('should extract metadata duration', async () => {
      const body = {
        success: true,
        output: {},
        metadata: { duration: 1234 },
      }

      const result = await transformResponse(mockResponse(body))

      expect(result.duration).toBe(1234)
    })

    it.concurrent('should default duration to 0 when metadata is missing', async () => {
      const body = { success: true, output: {} }

      const result = await transformResponse(mockResponse(body))

      expect(result.duration).toBe(0)
    })

    it.concurrent('should extract workflowId and workflowName', async () => {
      const body = {
        success: true,
        output: {},
        workflowId: 'wf-123',
        workflowName: 'My Workflow',
      }

      const result = await transformResponse(mockResponse(body))

      expect(result.childWorkflowId).toBe('wf-123')
      expect(result.childWorkflowName).toBe('My Workflow')
    })
  })

  describe('tool metadata', () => {
    it.concurrent('should have correct id', () => {
      expect(workflowExecutorTool.id).toBe('workflow_executor')
    })

    it.concurrent('should have required workflowId param', () => {
      expect(workflowExecutorTool.params.workflowId.required).toBe(true)
    })

    it.concurrent('should have optional inputMapping param', () => {
      expect(workflowExecutorTool.params.inputMapping.required).toBe(false)
    })

    it.concurrent('should use POST method', () => {
      expect(workflowExecutorTool.request.method).toBe('POST')
    })
  })
})
