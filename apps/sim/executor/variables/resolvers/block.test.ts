import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { ExecutionState } from '@/executor/execution/state'
import { BlockResolver } from './block'
import type { ResolutionContext } from './reference'

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/workflows/blocks/block-outputs', () => ({
  getBlockOutputs: vi.fn(() => ({})),
}))

function createTestWorkflow(
  blocks: Array<{
    id: string
    name?: string
    type?: string
    outputs?: Record<string, any>
  }> = []
) {
  return {
    version: '1.0',
    blocks: blocks.map((b) => ({
      id: b.id,
      position: { x: 0, y: 0 },
      config: { tool: b.type ?? 'function', params: {} },
      inputs: {},
      outputs: b.outputs ?? {},
      metadata: { id: b.type ?? 'function', name: b.name ?? b.id },
      enabled: true,
    })),
    connections: [],
    loops: {},
    parallels: {},
  }
}

/**
 * Creates a test ResolutionContext with block outputs.
 */
function createTestContext(
  currentNodeId: string,
  blockOutputs: Record<string, any> = {},
  contextBlockStates?: Map<string, { output: any }>
): ResolutionContext {
  const state = new ExecutionState()
  for (const [blockId, output] of Object.entries(blockOutputs)) {
    state.setBlockOutput(blockId, output)
  }

  return {
    executionContext: {
      blockStates: contextBlockStates ?? new Map(),
    },
    executionState: state,
    currentNodeId,
  } as unknown as ResolutionContext
}

describe('BlockResolver', () => {
  describe('canResolve', () => {
    it.concurrent('should return true for block references', () => {
      const resolver = new BlockResolver(createTestWorkflow([{ id: 'block-1' }]))
      expect(resolver.canResolve('<block-1>')).toBe(true)
      expect(resolver.canResolve('<block-1.output>')).toBe(true)
      expect(resolver.canResolve('<block-1.result.value>')).toBe(true)
    })

    it.concurrent('should return true for block references by name', () => {
      const resolver = new BlockResolver(createTestWorkflow([{ id: 'block-1', name: 'My Block' }]))
      expect(resolver.canResolve('<myblock>')).toBe(true)
      expect(resolver.canResolve('<My Block>')).toBe(true)
    })

    it.concurrent('should return false for special prefixes', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.canResolve('<loop.index>')).toBe(false)
      expect(resolver.canResolve('<parallel.currentItem>')).toBe(false)
      expect(resolver.canResolve('<variable.myvar>')).toBe(false)
    })

    it.concurrent('should return false for non-references', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.canResolve('plain text')).toBe(false)
      expect(resolver.canResolve('{{ENV_VAR}}')).toBe(false)
      expect(resolver.canResolve('block-1.output')).toBe(false)
    })
  })

  describe('resolve', () => {
    it.concurrent('should resolve block output by ID', () => {
      const workflow = createTestWorkflow([{ id: 'source-block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'source-block': { result: 'success', data: { value: 42 } },
      })

      expect(resolver.resolve('<source-block>', ctx)).toEqual({
        result: 'success',
        data: { value: 42 },
      })
    })

    it.concurrent('should resolve block output by name', () => {
      const workflow = createTestWorkflow([{ id: 'block-123', name: 'My Source Block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'block-123': { message: 'hello' },
      })

      expect(resolver.resolve('<mysourceblock>', ctx)).toEqual({ message: 'hello' })
      expect(resolver.resolve('<My Source Block>', ctx)).toEqual({ message: 'hello' })
    })

    it.concurrent('should resolve nested property path', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { user: { profile: { name: 'Alice', email: 'alice@test.com' } } },
      })

      expect(resolver.resolve('<source.user.profile.name>', ctx)).toBe('Alice')
      expect(resolver.resolve('<source.user.profile.email>', ctx)).toBe('alice@test.com')
    })

    it.concurrent('should resolve array index in path', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      })

      expect(resolver.resolve('<source.items.0>', ctx)).toEqual({ id: 1 })
      expect(resolver.resolve('<source.items.1.id>', ctx)).toBe(2)
    })

    it.concurrent('should return undefined for non-existent path when no schema defined', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { existing: 'value' },
      })

      expect(resolver.resolve('<source.nonexistent>', ctx)).toBeUndefined()
    })

    it.concurrent('should throw error for path not in output schema', async () => {
      const { getBlockOutputs } = await import('@/lib/workflows/blocks/block-outputs')
      const mockGetBlockOutputs = vi.mocked(getBlockOutputs)
      const customOutputs = {
        validField: { type: 'string', description: 'A valid field' },
        nested: {
          child: { type: 'number', description: 'Nested child' },
        },
      }
      mockGetBlockOutputs.mockReturnValue(customOutputs as any)

      const workflow = createTestWorkflow([
        {
          id: 'source',
          outputs: customOutputs,
        },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { validField: 'value', nested: { child: 42 } },
      })

      expect(() => resolver.resolve('<source.invalidField>', ctx)).toThrow(
        /"invalidField" doesn't exist on block "source"/
      )
      expect(() => resolver.resolve('<source.invalidField>', ctx)).toThrow(/Available fields:/)

      mockGetBlockOutputs.mockReturnValue({})
    })

    it.concurrent('should return undefined for path in schema but missing in data', () => {
      const workflow = createTestWorkflow([
        {
          id: 'source',
          outputs: {
            requiredField: { type: 'string', description: 'Always present' },
            optionalField: { type: 'string', description: 'Sometimes missing' },
          },
        },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { requiredField: 'value' },
      })

      expect(resolver.resolve('<source.requiredField>', ctx)).toBe('value')
      expect(resolver.resolve('<source.optionalField>', ctx)).toBeUndefined()
    })

    it.concurrent('should return undefined for non-existent block', () => {
      const workflow = createTestWorkflow([{ id: 'existing' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {})

      expect(resolver.resolve('<nonexistent>', ctx)).toBeUndefined()
    })

    it.concurrent('should fall back to context blockStates', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const contextStates = new Map([['source', { output: { fallback: true } }]])
      const ctx = createTestContext('current', {}, contextStates)

      expect(resolver.resolve('<source>', ctx)).toEqual({ fallback: true })
    })
  })

  describe('formatValueForBlock', () => {
    it.concurrent('should format string for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock('hello world', 'condition')
      expect(result).toBe('"hello world"')
    })

    it.concurrent('should escape special characters for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock('line1\nline2', 'condition')).toBe('"line1\\nline2"')
      expect(resolver.formatValueForBlock('quote "test"', 'condition')).toBe('"quote \\"test\\""')
      expect(resolver.formatValueForBlock('backslash \\', 'condition')).toBe('"backslash \\\\"')
      expect(resolver.formatValueForBlock('tab\there', 'condition')).toBe('"tab\there"')
    })

    it.concurrent('should format object for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock({ key: 'value' }, 'condition')
      expect(result).toBe('{"key":"value"}')
    })

    it.concurrent('should format null/undefined for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(null, 'condition')).toBe('null')
      expect(resolver.formatValueForBlock(undefined, 'condition')).toBe('undefined')
    })

    it.concurrent('should format number for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(42, 'condition')).toBe('42')
      expect(resolver.formatValueForBlock(3.14, 'condition')).toBe('3.14')
      expect(resolver.formatValueForBlock(-100, 'condition')).toBe('-100')
    })

    it.concurrent('should format boolean for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(true, 'condition')).toBe('true')
      expect(resolver.formatValueForBlock(false, 'condition')).toBe('false')
    })

    it.concurrent('should format string for function block (JSON escaped)', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock('hello', 'function')
      expect(result).toBe('"hello"')
    })

    it.concurrent('should format object for function block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock({ a: 1 }, 'function')
      expect(result).toBe('{"a":1}')
    })

    it.concurrent('should format null/undefined for function block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(null, 'function')).toBe('null')
      expect(resolver.formatValueForBlock(undefined, 'function')).toBe('undefined')
    })

    it.concurrent('should format string for response block (no quotes)', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock('plain text', 'response')).toBe('plain text')
    })

    it.concurrent('should format object for response block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock({ key: 'value' }, 'response')).toBe('{"key":"value"}')
    })

    it.concurrent('should format array for response block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock([1, 2, 3], 'response')).toBe('[1,2,3]')
    })

    it.concurrent('should format primitives for response block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(42, 'response')).toBe('42')
      expect(resolver.formatValueForBlock(true, 'response')).toBe('true')
    })

    it.concurrent('should format object for default block type', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock({ x: 1 }, undefined)).toBe('{"x":1}')
      expect(resolver.formatValueForBlock({ x: 1 }, 'agent')).toBe('{"x":1}')
    })

    it.concurrent('should format primitive for default block type', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock('text', undefined)).toBe('text')
      expect(resolver.formatValueForBlock(123, undefined)).toBe('123')
    })
  })

  describe('Response block backwards compatibility', () => {
    it.concurrent('should resolve new format: <responseBlock.data>', () => {
      const workflow = createTestWorkflow([
        { id: 'response-block', name: 'Response', type: 'response' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'response-block': {
          data: { message: 'hello', userId: 123 },
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      })

      expect(resolver.resolve('<response.data>', ctx)).toEqual({ message: 'hello', userId: 123 })
      expect(resolver.resolve('<response.data.message>', ctx)).toBe('hello')
      expect(resolver.resolve('<response.data.userId>', ctx)).toBe(123)
    })

    it.concurrent('should resolve new format: <responseBlock.status>', () => {
      const workflow = createTestWorkflow([
        { id: 'response-block', name: 'Response', type: 'response' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'response-block': {
          data: { message: 'hello' },
          status: 201,
          headers: {},
        },
      })

      expect(resolver.resolve('<response.status>', ctx)).toBe(201)
    })

    it.concurrent('should resolve new format: <responseBlock.headers>', () => {
      const workflow = createTestWorkflow([
        { id: 'response-block', name: 'Response', type: 'response' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'response-block': {
          data: {},
          status: 200,
          headers: { 'X-Custom-Header': 'custom-value', 'Content-Type': 'application/json' },
        },
      })

      expect(resolver.resolve('<response.headers>', ctx)).toEqual({
        'X-Custom-Header': 'custom-value',
        'Content-Type': 'application/json',
      })
    })

    it.concurrent(
      'should resolve old format (backwards compat): <responseBlock.response.data>',
      () => {
        const workflow = createTestWorkflow([
          { id: 'response-block', name: 'Response', type: 'response' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'response-block': {
            data: { message: 'hello', userId: 123 },
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        })

        // Old format: <responseBlock.response.data> should strip 'response.' and resolve to data
        expect(resolver.resolve('<response.response.data>', ctx)).toEqual({
          message: 'hello',
          userId: 123,
        })
        expect(resolver.resolve('<response.response.data.message>', ctx)).toBe('hello')
        expect(resolver.resolve('<response.response.data.userId>', ctx)).toBe(123)
      }
    )

    it.concurrent(
      'should resolve old format (backwards compat): <responseBlock.response.status>',
      () => {
        const workflow = createTestWorkflow([
          { id: 'response-block', name: 'Response', type: 'response' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'response-block': {
            data: { message: 'hello' },
            status: 404,
            headers: {},
          },
        })

        // Old format: <responseBlock.response.status> should strip 'response.' and resolve to status
        expect(resolver.resolve('<response.response.status>', ctx)).toBe(404)
      }
    )

    it.concurrent(
      'should resolve old format (backwards compat): <responseBlock.response.headers>',
      () => {
        const workflow = createTestWorkflow([
          { id: 'response-block', name: 'Response', type: 'response' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'response-block': {
            data: {},
            status: 200,
            headers: { 'X-Request-Id': 'abc-123' },
          },
        })

        // Old format: <responseBlock.response.headers> should strip 'response.' and resolve to headers
        expect(resolver.resolve('<response.response.headers>', ctx)).toEqual({
          'X-Request-Id': 'abc-123',
        })
      }
    )

    it.concurrent('should resolve entire Response block output with new format', () => {
      const workflow = createTestWorkflow([
        { id: 'response-block', name: 'My Response', type: 'response' },
      ])
      const resolver = new BlockResolver(workflow)
      const fullOutput = {
        data: { result: 'success' },
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
      const ctx = createTestContext('current', { 'response-block': fullOutput })

      expect(resolver.resolve('<myresponse>', ctx)).toEqual(fullOutput)
    })

    it.concurrent(
      'should only strip response prefix for response block type, not other blocks',
      () => {
        // For non-response blocks, 'response' is a valid property name that should NOT be stripped
        const workflow = createTestWorkflow([{ id: 'agent-block', name: 'Agent', type: 'agent' }])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'agent-block': {
            response: { content: 'AI generated text' },
            tokens: { input: 100, output: 50 },
          },
        })

        // For agent blocks, 'response' is a valid property and should be accessed normally
        expect(resolver.resolve('<agent.response.content>', ctx)).toBe('AI generated text')
      }
    )

    it.concurrent(
      'should NOT strip response prefix if output actually has response key (edge case)',
      () => {
        // Edge case: What if a Response block somehow has a 'response' key in its output?
        // This shouldn't happen in practice, but if it does, we should respect it.
        const workflow = createTestWorkflow([
          { id: 'response-block', name: 'Response', type: 'response' },
        ])
        const resolver = new BlockResolver(workflow)
        // Hypothetical edge case where output has an actual 'response' property
        const ctx = createTestContext('current', {
          'response-block': {
            response: { legacyData: 'some value' },
            data: { newData: 'other value' },
          },
        })

        // Since output.response exists, we should NOT strip it - access the actual 'response' property
        expect(resolver.resolve('<response.response.legacyData>', ctx)).toBe('some value')
        expect(resolver.resolve('<response.data.newData>', ctx)).toBe('other value')
      }
    )
  })

  describe('Workflow block with child Response block backwards compatibility', () => {
    it.concurrent('should resolve new format: <workflowBlock.result.data>', () => {
      const workflow = createTestWorkflow([
        { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
      ])
      const resolver = new BlockResolver(workflow)
      // After our change, child workflow with Response block returns { data, status, headers }
      // Workflow block wraps it in { success, result: { data, status, headers }, ... }
      const ctx = createTestContext('current', {
        'workflow-block': {
          success: true,
          childWorkflowName: 'Child Workflow',
          result: {
            data: { userId: 456, name: 'Test User' },
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        },
      })

      expect(resolver.resolve('<myworkflow.result.data>', ctx)).toEqual({
        userId: 456,
        name: 'Test User',
      })
      expect(resolver.resolve('<myworkflow.result.data.userId>', ctx)).toBe(456)
      expect(resolver.resolve('<myworkflow.result.data.name>', ctx)).toBe('Test User')
    })

    it.concurrent('should resolve new format: <workflowBlock.result.status>', () => {
      const workflow = createTestWorkflow([
        { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'workflow-block': {
          success: true,
          childWorkflowName: 'Child Workflow',
          result: {
            data: { message: 'created' },
            status: 201,
            headers: {},
          },
        },
      })

      expect(resolver.resolve('<myworkflow.result.status>', ctx)).toBe(201)
    })

    it.concurrent('should resolve new format: <workflowBlock.result.headers>', () => {
      const workflow = createTestWorkflow([
        { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'workflow-block': {
          success: true,
          childWorkflowName: 'Child Workflow',
          result: {
            data: {},
            status: 200,
            headers: { 'X-Trace-Id': 'trace-abc-123' },
          },
        },
      })

      expect(resolver.resolve('<myworkflow.result.headers>', ctx)).toEqual({
        'X-Trace-Id': 'trace-abc-123',
      })
    })

    it.concurrent(
      'should resolve old format (backwards compat): <workflowBlock.result.response.data>',
      () => {
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'Child Workflow',
            result: {
              data: { userId: 456, name: 'Test User' },
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          },
        })

        // Old format: <workflowBlock.result.response.data> should strip 'response.' and resolve to result.data
        expect(resolver.resolve('<myworkflow.result.response.data>', ctx)).toEqual({
          userId: 456,
          name: 'Test User',
        })
        expect(resolver.resolve('<myworkflow.result.response.data.userId>', ctx)).toBe(456)
        expect(resolver.resolve('<myworkflow.result.response.data.name>', ctx)).toBe('Test User')
      }
    )

    it.concurrent(
      'should resolve old format (backwards compat): <workflowBlock.result.response.status>',
      () => {
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'Child Workflow',
            result: {
              data: { message: 'error' },
              status: 500,
              headers: {},
            },
          },
        })

        // Old format: <workflowBlock.result.response.status> should strip 'response.' and resolve to result.status
        expect(resolver.resolve('<myworkflow.result.response.status>', ctx)).toBe(500)
      }
    )

    it.concurrent(
      'should resolve old format (backwards compat): <workflowBlock.result.response.headers>',
      () => {
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'Child Workflow',
            result: {
              data: {},
              status: 200,
              headers: { 'Cache-Control': 'no-cache' },
            },
          },
        })

        // Old format: <workflowBlock.result.response.headers> should strip 'response.' and resolve to result.headers
        expect(resolver.resolve('<myworkflow.result.response.headers>', ctx)).toEqual({
          'Cache-Control': 'no-cache',
        })
      }
    )

    it.concurrent('should resolve workflow block success and other properties', () => {
      const workflow = createTestWorkflow([
        { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'workflow-block': {
          success: true,
          childWorkflowName: 'Child Workflow',
          result: { data: {}, status: 200, headers: {} },
        },
      })

      expect(resolver.resolve('<myworkflow.success>', ctx)).toBe(true)
      expect(resolver.resolve('<myworkflow.childWorkflowName>', ctx)).toBe('Child Workflow')
    })

    it.concurrent('should handle workflow block with failed child workflow', () => {
      const workflow = createTestWorkflow([
        { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'workflow-block': {
          success: false,
          childWorkflowName: 'Child Workflow',
          result: {},
          error: 'Child workflow execution failed',
        },
      })

      expect(resolver.resolve('<myworkflow.success>', ctx)).toBe(false)
      expect(resolver.resolve('<myworkflow.error>', ctx)).toBe('Child workflow execution failed')
    })

    it.concurrent('should handle workflow block where child has non-Response final block', () => {
      // When child workflow does NOT have a Response block as final block,
      // the result structure will be different (not data/status/headers)
      const workflow = createTestWorkflow([
        { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'workflow-block': {
          success: true,
          childWorkflowName: 'Child Workflow',
          result: {
            content: 'AI generated response',
            tokens: { input: 100, output: 50 },
          },
        },
      })

      // No backwards compat needed here since child didn't have Response block
      expect(resolver.resolve('<myworkflow.result.content>', ctx)).toBe('AI generated response')
      expect(resolver.resolve('<myworkflow.result.tokens.input>', ctx)).toBe(100)
    })

    it.concurrent('should not apply workflow backwards compat for non-workflow blocks', () => {
      // For non-workflow blocks, 'result.response' is a valid path that should NOT be modified
      const workflow = createTestWorkflow([
        { id: 'function-block', name: 'Function', type: 'function' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'function-block': {
          result: {
            response: { apiData: 'test' },
            other: 'value',
          },
        },
      })

      // For function blocks, 'result.response' is a valid nested property
      expect(resolver.resolve('<function.result.response.apiData>', ctx)).toBe('test')
    })

    it.concurrent(
      'should NOT strip result.response if child actually has response property (edge case)',
      () => {
        // Edge case: Child workflow's final output legitimately has a 'response' property
        // (e.g., child ended with an Agent block that outputs response data)
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'Child Workflow',
            result: {
              // Child workflow ended with Agent block, not Response block
              content: 'AI generated text',
              response: { apiCallData: 'from external API' }, // legitimate 'response' property
            },
          },
        })

        // Since output.result.response exists, we should NOT strip it - access the actual property
        expect(resolver.resolve('<myworkflow.result.response.apiCallData>', ctx)).toBe(
          'from external API'
        )
        expect(resolver.resolve('<myworkflow.result.content>', ctx)).toBe('AI generated text')
      }
    )

    it.concurrent('should handle mixed scenarios correctly', () => {
      // Test that new format works when child workflow had Response block
      const workflow = createTestWorkflow([
        { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
      ])
      const resolver = new BlockResolver(workflow)

      // Scenario 1: Child had Response block (new format - no 'response' key in result)
      const ctx1 = createTestContext('current', {
        'workflow-block': {
          success: true,
          result: { data: { id: 1 }, status: 200, headers: {} },
        },
      })
      // New format works
      expect(resolver.resolve('<myworkflow.result.data.id>', ctx1)).toBe(1)
      // Old format also works (backwards compat kicks in because result.response is undefined)
      expect(resolver.resolve('<myworkflow.result.response.data.id>', ctx1)).toBe(1)

      // Scenario 2: Child had Agent block with 'response' property
      const ctx2 = createTestContext('current', {
        'workflow-block': {
          success: true,
          result: {
            content: 'text',
            response: { external: 'data' }, // actual 'response' property
          },
        },
      })
      // Access the actual 'response' property - no stripping
      expect(resolver.resolve('<myworkflow.result.response.external>', ctx2)).toBe('data')
    })

    it.concurrent(
      'real-world scenario: parent workflow referencing child Response block via <workflow1.result.response.data>',
      () => {
        /**
         * This test simulates the exact scenario from user workflows:
         *
         * Child workflow (vibrant-cliff):
         *   Start → Function 1 (returns "fuck") → Response 1
         *   Response 1 outputs: { data: { hi: "fuck" }, status: 200, headers: {...} }
         *
         * Parent workflow (flying-glacier):
         *   Start → Workflow 1 (calls vibrant-cliff) → Function 1
         *   Function 1 code: return <workflow1.result.response.data>
         *
         * After our changes:
         * - Child Response block outputs { data, status, headers } (no wrapper)
         * - Workflow block wraps it in { success, result: { data, status, headers }, ... }
         * - Parent uses OLD reference <workflow1.result.response.data>
         * - Backwards compat should strip 'response.' and resolve to result.data
         */
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'Workflow 1', type: 'workflow' },
        ])
        const resolver = new BlockResolver(workflow)

        // Simulate the workflow block output after child (vibrant-cliff) executes
        // Child's Response block now outputs { data, status, headers } directly (no wrapper)
        // Workflow block wraps it in { success, result: <child_output>, ... }
        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'vibrant-cliff',
            result: {
              // This is what Response block outputs after our changes (no 'response' wrapper)
              data: { hi: 'fuck' },
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          },
        })

        // OLD reference pattern: <workflow1.result.response.data>
        // Should work via backwards compatibility (strips 'response.')
        expect(resolver.resolve('<workflow1.result.response.data>', ctx)).toEqual({ hi: 'fuck' })
        expect(resolver.resolve('<workflow1.result.response.data.hi>', ctx)).toBe('fuck')
        expect(resolver.resolve('<workflow1.result.response.status>', ctx)).toBe(200)

        // NEW reference pattern: <workflow1.result.data>
        // Should work directly
        expect(resolver.resolve('<workflow1.result.data>', ctx)).toEqual({ hi: 'fuck' })
        expect(resolver.resolve('<workflow1.result.data.hi>', ctx)).toBe('fuck')
        expect(resolver.resolve('<workflow1.result.status>', ctx)).toBe(200)

        // Other workflow block properties should still work
        expect(resolver.resolve('<workflow1.success>', ctx)).toBe(true)
        expect(resolver.resolve('<workflow1.childWorkflowName>', ctx)).toBe('vibrant-cliff')
      }
    )

    it.concurrent(
      'real-world scenario: accessing entire response object via <workflow1.result.response> (workflow type)',
      () => {
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'Workflow 1', type: 'workflow' },
        ])
        const resolver = new BlockResolver(workflow)

        // Child Response block output (new format - no wrapper)
        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'response-workflow-child-editor',
            result: {
              data: {
                s: 'example string',
                nums: [1, 2, 3],
                n: 42,
                obj: { key1: 'value1', key2: 'value2' },
              },
              status: 206,
              headers: { 'Content-Type': 'application/json', apple: 'banana' },
            },
          },
        })

        // OLD reference: <workflow1.result.response> should return the entire result object
        // This is used when the user wants to get data, status, headers all at once
        const response = resolver.resolve('<workflow1.result.response>', ctx)
        expect(response).toEqual({
          data: {
            s: 'example string',
            nums: [1, 2, 3],
            n: 42,
            obj: { key1: 'value1', key2: 'value2' },
          },
          status: 206,
          headers: { 'Content-Type': 'application/json', apple: 'banana' },
        })

        // Verify individual fields can be accessed from the returned object
        expect(response.status).toBe(206)
        expect(response.headers.apple).toBe('banana')
        expect(response.data.s).toBe('example string')
        expect(response.data.n).toBe(42)
        expect(response.data.nums).toEqual([1, 2, 3])
        expect(response.data.obj.key1).toBe('value1')
      }
    )

    it.concurrent(
      'real-world scenario: workflow_input type block with <workflow1.result.response>',
      () => {
        /**
         * CRITICAL: Workflow blocks can have type 'workflow' OR 'workflow_input'.
         * Both must support backwards compatibility.
         *
         * This test uses 'workflow_input' which is the actual type in production.
         */
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'Workflow 1', type: 'workflow_input' },
        ])
        const resolver = new BlockResolver(workflow)

        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'response-workflow-child-editor',
            result: {
              data: {
                s: 'example string',
                nums: [1, 2, 3],
                n: 42,
                obj: { key1: 'value1', key2: 'value2' },
              },
              status: 206,
              headers: { 'Content-Type': 'application/json', apple: 'banana' },
            },
          },
        })

        // OLD reference: <workflow1.result.response> should return the entire result object
        const response = resolver.resolve('<workflow1.result.response>', ctx)
        expect(response).toEqual({
          data: {
            s: 'example string',
            nums: [1, 2, 3],
            n: 42,
            obj: { key1: 'value1', key2: 'value2' },
          },
          status: 206,
          headers: { 'Content-Type': 'application/json', apple: 'banana' },
        })

        // Also test drilling into specific fields
        expect(resolver.resolve('<workflow1.result.response.data>', ctx)).toEqual({
          s: 'example string',
          nums: [1, 2, 3],
          n: 42,
          obj: { key1: 'value1', key2: 'value2' },
        })
        expect(resolver.resolve('<workflow1.result.response.status>', ctx)).toBe(206)
        expect(resolver.resolve('<workflow1.result.response.data.s>', ctx)).toBe('example string')
      }
    )
  })

  describe('edge cases', () => {
    it.concurrent('should handle case-insensitive block name matching', () => {
      const workflow = createTestWorkflow([{ id: 'block-1', name: 'My Block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', { 'block-1': { data: 'test' } })

      expect(resolver.resolve('<MYBLOCK>', ctx)).toEqual({ data: 'test' })
      expect(resolver.resolve('<myblock>', ctx)).toEqual({ data: 'test' })
      expect(resolver.resolve('<MyBlock>', ctx)).toEqual({ data: 'test' })
    })

    it.concurrent('should handle block names with spaces', () => {
      const workflow = createTestWorkflow([{ id: 'block-1', name: 'API Request Block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', { 'block-1': { status: 200 } })

      expect(resolver.resolve('<apirequestblock>', ctx)).toEqual({ status: 200 })
    })

    it.concurrent('should handle empty path returning entire output', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const output = { a: 1, b: 2, c: { nested: true } }
      const ctx = createTestContext('current', { source: output })

      expect(resolver.resolve('<source>', ctx)).toEqual(output)
    })

    it.concurrent('should handle output with null values', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { value: null, other: 'exists' },
      })

      expect(resolver.resolve('<source.value>', ctx)).toBeNull()
      expect(resolver.resolve('<source.other>', ctx)).toBe('exists')
    })

    it.concurrent('should handle output with undefined values', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { value: undefined, other: 'exists' },
      })

      expect(resolver.resolve('<source.value>', ctx)).toBeUndefined()
    })

    it.concurrent('should return undefined for deeply nested non-existent path', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { level1: { level2: {} } },
      })

      expect(resolver.resolve('<source.level1.level2.level3>', ctx)).toBeUndefined()
    })
  })
})
