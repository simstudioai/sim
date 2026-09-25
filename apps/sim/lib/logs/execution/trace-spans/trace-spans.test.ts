import { describe, expect, it } from 'vitest'
import { buildTraceSpans, hasUnhandledError } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { TraceSpan } from '@/lib/logs/types'
import type { ExecutionResult } from '@/executor/types'

describe('buildTraceSpans', () => {
  it.concurrent('extracts sequential segments from timeSegments data', () => {
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final output' },
      logs: [
        {
          blockId: 'agent-1',
          blockName: 'Test Agent',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:08.000Z',
          durationMs: 8000,
          success: true,
          input: { userPrompt: 'Test prompt' },
          output: {
            content: 'Agent response',
            model: 'gpt-4o',
            tokens: { input: 10, output: 20, total: 30 },
            providerTiming: {
              duration: 8000,
              startTime: '2024-01-01T10:00:00.000Z',
              endTime: '2024-01-01T10:00:08.000Z',
              timeSegments: [
                {
                  type: 'model',
                  name: 'Initial response',
                  startTime: 1704103200000, // 2024-01-01T10:00:00.000Z
                  endTime: 1704103201000, // 2024-01-01T10:00:01.000Z
                  duration: 1000,
                },
                {
                  type: 'tool',
                  name: 'custom_test_tool',
                  startTime: 1704103201000, // 2024-01-01T10:00:01.000Z
                  endTime: 1704103203000, // 2024-01-01T10:00:03.000Z
                  duration: 2000,
                },
                {
                  type: 'tool',
                  name: 'http_request',
                  startTime: 1704103203000, // 2024-01-01T10:00:03.000Z
                  endTime: 1704103206000, // 2024-01-01T10:00:06.000Z
                  duration: 3000,
                },
                {
                  type: 'model',
                  name: 'Model response (iteration 1)',
                  startTime: 1704103206000, // 2024-01-01T10:00:06.000Z
                  endTime: 1704103208000, // 2024-01-01T10:00:08.000Z
                  duration: 2000,
                },
              ],
            },
            toolCalls: {
              list: [
                {
                  name: 'custom_test_tool',
                  arguments: { input: 'test input' },
                  result: { output: 'test output' },
                  duration: 2000,
                },
                {
                  name: 'http_request',
                  arguments: { url: 'https://api.example.com' },
                  result: { status: 200, data: 'response' },
                  duration: 3000,
                },
              ],
              count: 2,
            },
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const agentSpan = traceSpans[0]
    expect(agentSpan.type).toBe('agent')
    expect(agentSpan.children).toBeDefined()
    expect(agentSpan.children).toHaveLength(4)

    // Check sequential segments
    const segments = agentSpan.children!

    // First segment: Initial model response
    expect(segments[0].name).toBe('Initial response')
    expect(segments[0].type).toBe('model')
    expect(segments[0].duration).toBe(1000)
    expect(segments[0].status).toBe('success')

    // Second segment: First tool call
    expect(segments[1].name).toBe('test_tool') // custom_ prefix should be stripped
    expect(segments[1].type).toBe('tool')
    expect(segments[1].duration).toBe(2000)
    expect(segments[1].status).toBe('success')
    expect(segments[1].input).toEqual({ input: 'test input' })
    expect(segments[1].output).toEqual({ output: 'test output' })

    // Third segment: Second tool call
    expect(segments[2].name).toBe('http_request')
    expect(segments[2].type).toBe('tool')
    expect(segments[2].duration).toBe(3000)
    expect(segments[2].status).toBe('success')
    expect(segments[2].input).toEqual({ url: 'https://api.example.com' })
    expect(segments[2].output).toEqual({ status: 200, data: 'response' })

    // Fourth segment: Final model response
    expect(segments[3].name).toBe('Model response (iteration 1)')
    expect(segments[3].type).toBe('model')
    expect(segments[3].duration).toBe(2000)
    expect(segments[3].status).toBe('success')
  })

  it.concurrent('falls back to toolCalls extraction when timeSegments not available', () => {
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final output' },
      logs: [
        {
          blockId: 'agent-1',
          blockName: 'Test Agent',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:05.000Z',
          durationMs: 5000,
          success: true,
          input: { userPrompt: 'Test prompt' },
          output: {
            content: 'Agent response',
            model: 'gpt-4o',
            tokens: { input: 10, output: 20, total: 30 },
            providerTiming: {
              duration: 4000,
              startTime: '2024-01-01T10:00:00.500Z',
              endTime: '2024-01-01T10:00:04.500Z',
              // No timeSegments - should fallback to toolCalls
            },
            toolCalls: {
              list: [
                {
                  name: 'custom_test_tool',
                  arguments: { input: 'test input' },
                  result: { output: 'test output' },
                  duration: 1000,
                  startTime: '2024-01-01T10:00:01.000Z',
                  endTime: '2024-01-01T10:00:02.000Z',
                },
                {
                  name: 'http_request',
                  arguments: { url: 'https://api.example.com' },
                  result: { status: 200, data: 'response' },
                  duration: 2000,
                  startTime: '2024-01-01T10:00:02.000Z',
                  endTime: '2024-01-01T10:00:04.000Z',
                },
              ],
              count: 2,
            },
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const agentSpan = traceSpans[0]
    expect(agentSpan.type).toBe('agent')
    expect(agentSpan.children).toBeDefined()
    expect(agentSpan.children).toHaveLength(2)

    // Check first tool call
    const firstToolCall = agentSpan.children![0]
    expect(firstToolCall.type).toBe('tool')
    expect(firstToolCall.name).toBe('test_tool') // custom_ prefix should be stripped
    expect(firstToolCall.duration).toBe(1000)
    expect(firstToolCall.status).toBe('success')
    expect(firstToolCall.input).toEqual({ input: 'test input' })
    expect(firstToolCall.output).toEqual({ output: 'test output' })

    // Check second tool call
    const secondToolCall = agentSpan.children![1]
    expect(secondToolCall.type).toBe('tool')
    expect(secondToolCall.name).toBe('http_request')
    expect(secondToolCall.duration).toBe(2000)
    expect(secondToolCall.status).toBe('success')
    expect(secondToolCall.input).toEqual({ url: 'https://api.example.com' })
    expect(secondToolCall.output).toEqual({ status: 200, data: 'response' })
  })

  it.concurrent('flattens nested child workflow trace spans recursively', () => {
    const nestedChildSpan = {
      id: 'nested-workflow-span',
      name: 'Nested Workflow Block',
      type: 'workflow',
      blockId: 'nested-workflow-block-id',
      duration: 3000,
      startTime: '2024-01-01T10:00:01.000Z',
      endTime: '2024-01-01T10:00:04.000Z',
      status: 'success' as const,
      output: {
        childTraceSpans: [
          {
            id: 'grand-wrapper',
            name: 'Workflow Execution',
            type: 'workflow',
            duration: 3000,
            startTime: '2024-01-01T10:00:01.000Z',
            endTime: '2024-01-01T10:00:04.000Z',
            status: 'success' as const,
            children: [
              {
                id: 'grand-child-block',
                name: 'Deep API Call',
                type: 'api',
                duration: 1500,
                startTime: '2024-01-01T10:00:01.500Z',
                endTime: '2024-01-01T10:00:03.000Z',
                status: 'success' as const,
                input: { path: '/v1/test' },
                output: { result: 'ok' },
              },
            ],
          },
        ],
      },
    }

    const toolSpan = {
      id: 'child-tool-span',
      name: 'Helper Tool',
      type: 'tool',
      duration: 1000,
      startTime: '2024-01-01T10:00:04.000Z',
      endTime: '2024-01-01T10:00:05.000Z',
      status: 'success' as const,
    }

    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { result: 'parent output' },
      logs: [
        {
          blockId: 'workflow-1',
          blockName: 'Child Workflow',
          blockType: 'workflow',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:05.000Z',
          durationMs: 5000,
          success: true,
          output: {
            childWorkflowName: 'Child Workflow',
            childTraceSpans: [
              {
                id: 'child-wrapper',
                name: 'Workflow Execution',
                type: 'workflow',
                duration: 5000,
                startTime: '2024-01-01T10:00:00.000Z',
                endTime: '2024-01-01T10:00:05.000Z',
                status: 'success' as const,
                children: [nestedChildSpan, toolSpan],
              },
            ],
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const workflowSpan = traceSpans[0]
    expect(workflowSpan.type).toBe('workflow')
    expect(workflowSpan.children).toBeDefined()
    expect(workflowSpan.children).toHaveLength(2)

    const nestedWorkflowSpan = workflowSpan.children?.find((span) => span.type === 'workflow')
    expect(nestedWorkflowSpan).toBeDefined()
    expect(nestedWorkflowSpan?.name).toBe('Nested Workflow Block')
    expect(nestedWorkflowSpan?.children).toBeDefined()
    expect(nestedWorkflowSpan?.children).toHaveLength(1)
    expect(nestedWorkflowSpan?.children?.[0].name).toBe('Deep API Call')
    expect(nestedWorkflowSpan?.children?.[0].type).toBe('api')

    const helperToolSpan = workflowSpan.children?.find((span) => span.id === 'child-tool-span')
    expect(helperToolSpan?.type).toBe('tool')

    const syntheticWrappers = workflowSpan.children?.filter(
      (span) => span.name === 'Workflow Execution'
    )
    expect(syntheticWrappers).toHaveLength(0)
  })

  it.concurrent('removes childTraceSpans from output after integrating them as children', () => {
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { result: 'parent output' },
      logs: [
        {
          blockId: 'workflow-1',
          blockName: 'Parent Workflow',
          blockType: 'workflow',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:05.000Z',
          durationMs: 5000,
          success: true,
          output: {
            success: true,
            childWorkflowName: 'Child Workflow',
            result: { data: 'some result' },
            childTraceSpans: [
              {
                id: 'child-block-1',
                name: 'Supabase Query',
                type: 'supabase',
                blockId: 'supabase-1',
                duration: 2000,
                startTime: '2024-01-01T10:00:01.000Z',
                endTime: '2024-01-01T10:00:03.000Z',
                status: 'success' as const,
                output: {
                  records: [
                    { id: 1, logo: 'data:image/png;base64,VeryLargeBase64StringHere...' },
                    { id: 2, logo: 'data:image/png;base64,AnotherLargeBase64StringHere...' },
                  ],
                },
              },
              {
                id: 'child-block-2',
                name: 'Transform Data',
                type: 'function',
                blockId: 'function-1',
                duration: 500,
                startTime: '2024-01-01T10:00:03.000Z',
                endTime: '2024-01-01T10:00:03.500Z',
                status: 'success' as const,
                output: { transformed: true },
              },
            ],
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const workflowSpan = traceSpans[0]
    expect(workflowSpan.type).toBe('workflow')

    expect(workflowSpan.children).toBeDefined()
    expect(workflowSpan.children).toHaveLength(2)
    expect(workflowSpan.children?.[0].name).toBe('Supabase Query')
    expect(workflowSpan.children?.[1].name).toBe('Transform Data')

    expect(workflowSpan.output).toBeDefined()
    expect((workflowSpan.output as { childTraceSpans?: unknown }).childTraceSpans).toBeUndefined()

    expect((workflowSpan.output as { success?: boolean }).success).toBe(true)
    expect((workflowSpan.output as { childWorkflowName?: string }).childWorkflowName).toBe(
      'Child Workflow'
    )
    expect((workflowSpan.output as { result?: { data: string } }).result).toEqual({
      data: 'some result',
    })
  })

  it.concurrent('matches multiple tool calls with same name by sequential order', () => {
    // This test verifies that when an agent makes multiple calls to the same tool
    // (e.g., search_tool called 3 times with different queries), each tool segment
    // is matched to the correct tool call by their sequential order, not just by name.
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final output with multiple searches' },
      logs: [
        {
          blockId: 'agent-multi-search',
          blockName: 'Multi-Search Agent',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:10.000Z',
          durationMs: 10000,
          success: true,
          input: { userPrompt: 'Search for multiple topics' },
          output: {
            content: 'Results from multiple searches',
            model: 'gpt-4o',
            tokens: { input: 50, output: 100, total: 150 },
            providerTiming: {
              duration: 10000,
              startTime: '2024-01-01T10:00:00.000Z',
              endTime: '2024-01-01T10:00:10.000Z',
              timeSegments: [
                {
                  type: 'model',
                  name: 'Initial response',
                  startTime: 1704103200000, // 2024-01-01T10:00:00.000Z
                  endTime: 1704103201000,
                  duration: 1000,
                },
                {
                  type: 'tool',
                  name: 'search_tool',
                  startTime: 1704103201000, // 2024-01-01T10:00:01.000Z
                  endTime: 1704103202000,
                  duration: 1000,
                },
                {
                  type: 'model',
                  name: 'Model response (iteration 1)',
                  startTime: 1704103202000,
                  endTime: 1704103203000,
                  duration: 1000,
                },
                {
                  type: 'tool',
                  name: 'search_tool',
                  startTime: 1704103203000, // 2024-01-01T10:00:03.000Z
                  endTime: 1704103204500,
                  duration: 1500,
                },
                {
                  type: 'model',
                  name: 'Model response (iteration 2)',
                  startTime: 1704103204500,
                  endTime: 1704103206000,
                  duration: 1500,
                },
                {
                  type: 'tool',
                  name: 'search_tool',
                  startTime: 1704103206000, // 2024-01-01T10:00:06.000Z
                  endTime: 1704103208000,
                  duration: 2000,
                },
                {
                  type: 'model',
                  name: 'Model response (iteration 3)',
                  startTime: 1704103208000,
                  endTime: 1704103210000,
                  duration: 2000,
                },
              ],
            },
            toolCalls: {
              list: [
                {
                  name: 'search_tool',
                  arguments: { query: 'first query' },
                  result: { results: ['first result'] },
                  duration: 1000,
                  startTime: '2024-01-01T10:00:01.000Z', // Matches first segment
                  endTime: '2024-01-01T10:00:02.000Z',
                },
                {
                  name: 'search_tool',
                  arguments: { query: 'second query' },
                  result: { results: ['second result'] },
                  duration: 1500,
                  startTime: '2024-01-01T10:00:03.000Z', // Matches second segment
                  endTime: '2024-01-01T10:00:04.500Z',
                },
                {
                  name: 'search_tool',
                  arguments: { query: 'third query' },
                  result: { results: ['third result'] },
                  duration: 2000,
                  startTime: '2024-01-01T10:00:06.000Z', // Matches third segment
                  endTime: '2024-01-01T10:00:08.000Z',
                },
              ],
              count: 3,
            },
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const agentSpan = traceSpans[0]
    expect(agentSpan.children).toBeDefined()
    expect(agentSpan.children).toHaveLength(7)

    const segments = agentSpan.children!

    // First search_tool call should have "first query"
    const firstToolSegment = segments[1]
    expect(firstToolSegment.name).toBe('search_tool')
    expect(firstToolSegment.type).toBe('tool')
    expect(firstToolSegment.input).toEqual({ query: 'first query' })
    expect(firstToolSegment.output).toEqual({ results: ['first result'] })

    // Second search_tool call should have "second query"
    const secondToolSegment = segments[3]
    expect(secondToolSegment.name).toBe('search_tool')
    expect(secondToolSegment.type).toBe('tool')
    expect(secondToolSegment.input).toEqual({ query: 'second query' })
    expect(secondToolSegment.output).toEqual({ results: ['second result'] })

    // Third search_tool call should have "third query"
    const thirdToolSegment = segments[5]
    expect(thirdToolSegment.name).toBe('search_tool')
    expect(thirdToolSegment.type).toBe('tool')
    expect(thirdToolSegment.input).toEqual({ query: 'third query' })
    expect(thirdToolSegment.output).toEqual({ results: ['third result'] })
  })
})

describe('errorHandled - handled errors should not bubble up', () => {
  it.concurrent('block span stays error but is marked errorHandled', () => {
    const result: ExecutionResult = {
      success: true,
      output: { content: 'done' },
      logs: [
        {
          blockId: 'api-1',
          blockName: 'API Call',
          blockType: 'api',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:01.000Z',
          durationMs: 1000,
          success: false,
          error: 'Request failed with status 500',
          errorHandled: true,
          executionOrder: 1,
        },
        {
          blockId: 'fallback-1',
          blockName: 'Fallback',
          blockType: 'function',
          startedAt: '2024-01-01T10:00:01.000Z',
          endedAt: '2024-01-01T10:00:02.000Z',
          durationMs: 1000,
          success: true,
          executionOrder: 2,
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(result)

    const apiSpan = traceSpans.find((s) => s.blockId === 'api-1')!
    expect(apiSpan.status).toBe('error')
    expect(apiSpan.errorHandled).toBe(true)
    expect((apiSpan.output as { error?: string }).error).toBe('Request failed with status 500')

    const fallbackSpan = traceSpans.find((s) => s.blockId === 'fallback-1')!
    expect(fallbackSpan.status).toBe('success')
    expect(fallbackSpan.errorHandled).toBeUndefined()
  })

  it.concurrent('workflow-level span is success when all errors are handled', () => {
    const result: ExecutionResult = {
      success: true,
      output: { content: 'recovered' },
      metadata: { duration: 2000, startTime: '2024-01-01T10:00:00.000Z' },
      logs: [
        {
          blockId: 'api-1',
          blockName: 'API Call',
          blockType: 'api',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:01.000Z',
          durationMs: 1000,
          success: false,
          error: 'Connection timeout',
          errorHandled: true,
          executionOrder: 1,
        },
        {
          blockId: 'handler-1',
          blockName: 'Error Handler',
          blockType: 'function',
          startedAt: '2024-01-01T10:00:01.000Z',
          endedAt: '2024-01-01T10:00:02.000Z',
          durationMs: 1000,
          success: true,
          executionOrder: 2,
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(result)

    const workflowSpan = traceSpans[0]
    expect(workflowSpan.name).toBe('Workflow Execution')
    expect(workflowSpan.status).toBe('success')
  })

  it.concurrent(
    'workflow-level span is error when there is a mix of handled and unhandled errors',
    () => {
      const result: ExecutionResult = {
        success: false,
        output: {},
        metadata: { duration: 3000, startTime: '2024-01-01T10:00:00.000Z' },
        logs: [
          {
            blockId: 'api-1',
            blockName: 'API Call (handled)',
            blockType: 'api',
            startedAt: '2024-01-01T10:00:00.000Z',
            endedAt: '2024-01-01T10:00:01.000Z',
            durationMs: 1000,
            success: false,
            error: 'Handled error',
            errorHandled: true,
            executionOrder: 1,
          },
          {
            blockId: 'handler-1',
            blockName: 'Error Handler',
            blockType: 'function',
            startedAt: '2024-01-01T10:00:01.000Z',
            endedAt: '2024-01-01T10:00:02.000Z',
            durationMs: 1000,
            success: true,
            executionOrder: 2,
          },
          {
            blockId: 'api-2',
            blockName: 'API Call (unhandled)',
            blockType: 'api',
            startedAt: '2024-01-01T10:00:02.000Z',
            endedAt: '2024-01-01T10:00:03.000Z',
            durationMs: 1000,
            success: false,
            error: 'Unhandled crash',
            executionOrder: 3,
          },
        ],
      }

      const { traceSpans } = buildTraceSpans(result)

      const workflowSpan = traceSpans[0]
      expect(workflowSpan.name).toBe('Workflow Execution')
      expect(workflowSpan.status).toBe('error')

      const handledSpan = workflowSpan.children!.find((s) => s.blockId === 'api-1')!
      expect(handledSpan.status).toBe('error')
      expect(handledSpan.errorHandled).toBe(true)

      const unhandledSpan = workflowSpan.children!.find((s) => s.blockId === 'api-2')!
      expect(unhandledSpan.status).toBe('error')
      expect(unhandledSpan.errorHandled).toBeUndefined()
    }
  )

  it.concurrent(
    'handled errors inside loop iterations still show error on loop but not on workflow',
    () => {
      const result: ExecutionResult = {
        success: true,
        output: { content: 'all iterations recovered' },
        metadata: { duration: 5000, startTime: '2024-01-01T10:00:00.000Z' },
        logs: [
          {
            blockId: 'api-1',
            blockName: 'API Call (iteration 0)',
            blockType: 'api',
            startedAt: '2024-01-01T10:00:00.000Z',
            endedAt: '2024-01-01T10:00:01.000Z',
            durationMs: 1000,
            success: false,
            error: 'Rate limited',
            errorHandled: true,
            loopId: 'loop-1',
            iterationIndex: 0,
            executionOrder: 1,
          },
          {
            blockId: 'handler-1',
            blockName: 'Rate Limit Handler (iteration 0)',
            blockType: 'function',
            startedAt: '2024-01-01T10:00:01.000Z',
            endedAt: '2024-01-01T10:00:02.000Z',
            durationMs: 1000,
            success: true,
            loopId: 'loop-1',
            iterationIndex: 0,
            executionOrder: 2,
          },
          {
            blockId: 'api-1',
            blockName: 'API Call (iteration 1)',
            blockType: 'api',
            startedAt: '2024-01-01T10:00:02.000Z',
            endedAt: '2024-01-01T10:00:03.000Z',
            durationMs: 1000,
            success: true,
            loopId: 'loop-1',
            iterationIndex: 1,
            executionOrder: 3,
          },
          {
            blockId: 'api-1',
            blockName: 'API Call (iteration 2)',
            blockType: 'api',
            startedAt: '2024-01-01T10:00:03.000Z',
            endedAt: '2024-01-01T10:00:04.000Z',
            durationMs: 1000,
            success: false,
            error: 'Rate limited again',
            errorHandled: true,
            loopId: 'loop-1',
            iterationIndex: 2,
            executionOrder: 4,
          },
          {
            blockId: 'handler-1',
            blockName: 'Rate Limit Handler (iteration 2)',
            blockType: 'function',
            startedAt: '2024-01-01T10:00:04.000Z',
            endedAt: '2024-01-01T10:00:05.000Z',
            durationMs: 1000,
            success: true,
            loopId: 'loop-1',
            iterationIndex: 2,
            executionOrder: 5,
          },
        ],
      }

      const { traceSpans } = buildTraceSpans(result)

      const workflowSpan = traceSpans[0]
      expect(workflowSpan.name).toBe('Workflow Execution')
      expect(workflowSpan.status).toBe('success')

      const loopSpan = workflowSpan.children!.find((s) => s.type === 'loop')!
      expect(loopSpan).toBeDefined()
      expect(loopSpan.status).toBe('error')

      const iterations = loopSpan.children!
      expect(iterations).toHaveLength(3)
      expect(iterations[0].status).toBe('error')
      expect(iterations[1].status).toBe('success')
      expect(iterations[2].status).toBe('error')
    }
  )

  it.concurrent(
    'unhandled error in one loop iteration still makes the loop and workflow error',
    () => {
      const result: ExecutionResult = {
        success: false,
        output: {},
        metadata: { duration: 2000, startTime: '2024-01-01T10:00:00.000Z' },
        logs: [
          {
            blockId: 'api-1',
            blockName: 'API Call (iteration 0)',
            blockType: 'api',
            startedAt: '2024-01-01T10:00:00.000Z',
            endedAt: '2024-01-01T10:00:01.000Z',
            durationMs: 1000,
            success: true,
            loopId: 'loop-1',
            iterationIndex: 0,
            executionOrder: 1,
          },
          {
            blockId: 'api-1',
            blockName: 'API Call (iteration 1)',
            blockType: 'api',
            startedAt: '2024-01-01T10:00:01.000Z',
            endedAt: '2024-01-01T10:00:02.000Z',
            durationMs: 1000,
            success: false,
            error: 'Unhandled crash in iteration 1',
            loopId: 'loop-1',
            iterationIndex: 1,
            executionOrder: 2,
          },
        ],
      }

      const { traceSpans } = buildTraceSpans(result)

      const workflowSpan = traceSpans[0]
      expect(workflowSpan.name).toBe('Workflow Execution')
      expect(workflowSpan.status).toBe('error')

      const loopSpan = workflowSpan.children!.find((s) => s.type === 'loop')!
      expect(loopSpan.status).toBe('error')

      const iterations = loopSpan.children!
      expect(iterations[0].status).toBe('success')
      expect(iterations[1].status).toBe('error')
    }
  )

  it.concurrent('successful mothership blocks do not bubble failed child tool spans', () => {
    const result: ExecutionResult = {
      success: true,
      output: { content: 'Mothership recovered from the failed tool' },
      metadata: { duration: 3000, startTime: '2024-01-01T10:00:00.000Z' },
      logs: [
        {
          blockId: 'mothership-1',
          blockName: 'Mothership',
          blockType: 'mothership',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:03.000Z',
          durationMs: 3000,
          success: true,
          output: {
            content: 'Mothership recovered from the failed tool',
            model: 'mothership',
            toolCalls: {
              list: [
                {
                  name: 'failing_tool',
                  arguments: { query: 'test' },
                  error: 'Tool execution failed',
                  duration: 1000,
                  startTime: '2024-01-01T10:00:01.000Z',
                  endTime: '2024-01-01T10:00:02.000Z',
                },
              ],
              count: 1,
            },
          },
          executionOrder: 1,
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(result)

    const workflowSpan = traceSpans[0]
    expect(workflowSpan.status).toBe('success')

    const mothershipSpan = workflowSpan.children![0]
    expect(mothershipSpan.status).toBe('success')

    const toolSpan = mothershipSpan.children![0]
    expect(toolSpan.status).toBe('error')
    expect(toolSpan.output).toEqual({ error: 'Tool execution failed' })
  })
})

describe('nested subflow grouping via parentIterations', () => {
  it.concurrent('3-level nesting (P1 → P2 → P3 → leaf) groups recursively', () => {
    const result: ExecutionResult = {
      success: true,
      output: { content: 'done' },
      metadata: { duration: 2000, startTime: '2024-01-01T10:00:00.000Z' },
      logs: [
        // Leaf: parallelId=p3, parentIterations=[p1:0, p2:0]
        {
          blockId: 'func-1__obranch-0__obranch-0__obranch-0',
          blockName: 'Func (iteration 0)',
          blockType: 'function',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:01.000Z',
          durationMs: 1000,
          success: true,
          parallelId: 'p3',
          iterationIndex: 0,
          executionOrder: 1,
          parentIterations: [
            {
              iterationCurrent: 0,
              iterationTotal: 2,
              iterationType: 'parallel',
              iterationContainerId: 'p1',
            },
            {
              iterationCurrent: 0,
              iterationTotal: 2,
              iterationType: 'parallel',
              iterationContainerId: 'p2',
            },
          ],
        },
        {
          blockId: 'func-1__obranch-1__obranch-0__obranch-0',
          blockName: 'Func (iteration 1)',
          blockType: 'function',
          startedAt: '2024-01-01T10:00:01.000Z',
          endedAt: '2024-01-01T10:00:02.000Z',
          durationMs: 1000,
          success: true,
          parallelId: 'p3',
          iterationIndex: 1,
          executionOrder: 2,
          parentIterations: [
            {
              iterationCurrent: 0,
              iterationTotal: 2,
              iterationType: 'parallel',
              iterationContainerId: 'p1',
            },
            {
              iterationCurrent: 0,
              iterationTotal: 2,
              iterationType: 'parallel',
              iterationContainerId: 'p2',
            },
          ],
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(result)
    const workflow = traceSpans[0]

    // P1 container
    const p1 = workflow.children!.find((s) => s.type === 'parallel')!
    expect(p1).toBeDefined()
    expect(p1.children).toHaveLength(1) // 1 iteration of P1

    // P1 → Iteration 0 → P2
    const p1Iter0 = p1.children![0]
    const p2 = p1Iter0.children!.find((s) => s.type === 'parallel')
    expect(p2).toBeDefined()
    expect(p2!.children).toHaveLength(1) // 1 iteration of P2

    // P2 → Iteration 0 → P3
    const p2Iter0 = p2!.children![0]
    const p3 = p2Iter0.children!.find((s) => s.type === 'parallel')
    expect(p3).toBeDefined()
    expect(p3!.children).toHaveLength(2) // 2 iterations of P3

    // P3 leaf spans
    expect(p3!.children![0].children![0].name).toBe('Func')
    expect(p3!.children![1].children![0].name).toBe('Func')
  })

  it.concurrent('backward compatibility: spans without parentIterations group flat', () => {
    const result: ExecutionResult = {
      success: true,
      output: { content: 'done' },
      metadata: { duration: 2000, startTime: '2024-01-01T10:00:00.000Z' },
      logs: [
        {
          blockId: 'api-1__obranch-0',
          blockName: 'API (iteration 0)',
          blockType: 'api',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:01.000Z',
          durationMs: 1000,
          success: true,
          parallelId: 'p1',
          iterationIndex: 0,
          executionOrder: 1,
        },
        {
          blockId: 'api-1__obranch-1',
          blockName: 'API (iteration 1)',
          blockType: 'api',
          startedAt: '2024-01-01T10:00:01.000Z',
          endedAt: '2024-01-01T10:00:02.000Z',
          durationMs: 1000,
          success: true,
          parallelId: 'p1',
          iterationIndex: 1,
          executionOrder: 2,
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(result)
    const workflow = traceSpans[0]

    // Should group into a flat parallel container with 2 iterations
    const parallel = workflow.children!.find((s) => s.type === 'parallel')!
    expect(parallel).toBeDefined()
    expect(parallel.children).toHaveLength(2)
    expect(parallel.children![0].name).toBe('Iteration 0')
    expect(parallel.children![1].name).toBe('Iteration 1')
    // No nested containers — leaf spans are directly inside iteration
    expect(parallel.children![0].children![0].name).toBe('API')
    expect(parallel.children![0].children![0].type).toBe('api')
  })

  it.concurrent(
    'uses the user-configured loop name for the container span when a success BlockLog is present',
    () => {
      const result: ExecutionResult = {
        success: true,
        output: { content: 'done' },
        metadata: { duration: 3000, startTime: '2024-01-01T10:00:00.000Z' },
        logs: [
          {
            blockId: 'loop-sbj',
            blockName: 'LoopGroupA (SBJ)',
            blockType: 'loop',
            startedAt: '2024-01-01T10:00:00.000Z',
            endedAt: '2024-01-01T10:00:03.000Z',
            durationMs: 3000,
            success: true,
            output: { results: [[{ value: 1 }], [{ value: 2 }]] },
            executionOrder: 10,
          },
          {
            blockId: 'api-1',
            blockName: 'Send (iteration 0)',
            blockType: 'api',
            startedAt: '2024-01-01T10:00:00.000Z',
            endedAt: '2024-01-01T10:00:01.000Z',
            durationMs: 1000,
            success: true,
            loopId: 'loop-sbj',
            iterationIndex: 0,
            executionOrder: 1,
          },
          {
            blockId: 'api-1',
            blockName: 'Send (iteration 1)',
            blockType: 'api',
            startedAt: '2024-01-01T10:00:01.000Z',
            endedAt: '2024-01-01T10:00:02.000Z',
            durationMs: 1000,
            success: true,
            loopId: 'loop-sbj',
            iterationIndex: 1,
            executionOrder: 2,
          },
        ],
      }

      const { traceSpans } = buildTraceSpans(result)
      const workflow = traceSpans[0]
      const loop = workflow.children!.find((s) => s.type === 'loop')

      expect(loop).toBeDefined()
      expect(loop!.name).toBe('LoopGroupA (SBJ)')
      expect(loop!.children).toHaveLength(2)
    }
  )

  it.concurrent('propagates per-iteration segment content to model child spans', () => {
    const result: ExecutionResult = {
      success: true,
      output: { content: 'final' },
      logs: [
        {
          blockId: 'agent-1',
          blockName: 'Agent',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:04.000Z',
          durationMs: 4000,
          success: true,
          input: { userPrompt: 'hi' },
          output: {
            content: 'final',
            model: 'claude-3-7-sonnet',
            providerTiming: {
              duration: 4000,
              startTime: '2024-01-01T10:00:00.000Z',
              endTime: '2024-01-01T10:00:04.000Z',
              timeSegments: [
                {
                  type: 'model',
                  name: 'claude-3-7-sonnet',
                  startTime: 1704103200000,
                  endTime: 1704103202000,
                  duration: 2000,
                  assistantContent: 'reasoning about request',
                  thinkingContent: 'let me think step by step',
                  toolCalls: [{ id: 'call_abc', name: 'lookup', arguments: { q: 'test' } }],
                  finishReason: 'tool_use',
                  tokens: { input: 100, output: 20, total: 120, cacheRead: 5, reasoning: 8 },
                  cost: { input: 0.001, output: 0.002, total: 0.003 },
                  ttft: 450,
                  provider: 'anthropic',
                },
                {
                  type: 'tool',
                  name: 'lookup',
                  startTime: 1704103202000,
                  endTime: 1704103203000,
                  duration: 1000,
                  toolCallId: 'call_abc',
                  errorType: 'TimeoutError',
                  errorMessage: 'tool timed out',
                },
                {
                  type: 'model',
                  name: 'claude-3-7-sonnet',
                  startTime: 1704103203000,
                  endTime: 1704103204000,
                  duration: 1000,
                  assistantContent: 'final answer',
                  finishReason: 'end_turn',
                  tokens: { input: 130, output: 10, total: 140 },
                  cost: { input: 0.002, output: 0.001, total: 0.003 },
                  provider: 'anthropic',
                  errorType: 'RateLimitError',
                  errorMessage: 'too many requests',
                },
              ],
            },
            toolCalls: {
              list: [
                {
                  name: 'lookup',
                  arguments: { q: 'test' },
                  result: { hit: true },
                  duration: 1000,
                },
              ],
              count: 1,
            },
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(result)
    const children = traceSpans[0].children!
    expect(children).toHaveLength(3)

    const [firstModel, tool, secondModel] = children

    expect(firstModel.type).toBe('model')
    expect(firstModel.output).toEqual({ content: 'reasoning about request' })
    expect(firstModel.thinking).toBe('let me think step by step')
    expect(firstModel.modelToolCalls).toEqual([
      { id: 'call_abc', name: 'lookup', arguments: { q: 'test' } },
    ])
    expect(firstModel.finishReason).toBe('tool_use')
    expect(firstModel.tokens).toEqual({
      input: 100,
      output: 20,
      total: 120,
      cacheRead: 5,
      reasoning: 8,
    })
    expect(firstModel.cost).toEqual({ input: 0.001, output: 0.002, total: 0.003 })
    expect(firstModel.ttft).toBe(450)
    expect(firstModel.provider).toBe('anthropic')
    expect(firstModel.status).toBe('success')

    expect(tool.type).toBe('tool')
    expect(tool.toolCallId).toBe('call_abc')
    expect(tool.errorType).toBe('TimeoutError')
    expect(tool.errorMessage).toBe('tool timed out')
    expect(tool.status).toBe('error')

    expect(secondModel.type).toBe('model')
    expect(secondModel.output).toEqual({ content: 'final answer' })
    expect(secondModel.thinking).toBeUndefined()
    expect(secondModel.modelToolCalls).toBeUndefined()
    expect(secondModel.finishReason).toBe('end_turn')
    expect(secondModel.errorType).toBe('RateLimitError')
    expect(secondModel.errorMessage).toBe('too many requests')
    expect(secondModel.status).toBe('error')
  })

  it.concurrent('preserves parent toolCost on trace span cost', () => {
    const result: ExecutionResult = {
      success: true,
      output: { content: 'done' },
      logs: [
        {
          blockId: 'agent-tool-cost',
          blockName: 'Agent With Tool Cost',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:02.000Z',
          durationMs: 2000,
          success: true,
          input: {},
          output: {
            content: 'done',
            model: 'gpt-4o',
            tokens: { input: 100, output: 50, total: 150 },
            cost: { input: 0.001, output: 0.002, toolCost: 0.015, total: 0.018 },
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(result)

    expect(traceSpans[0].cost).toEqual({
      input: 0.001,
      output: 0.002,
      toolCost: 0.015,
      total: 0.018,
    })
  })
})

describe('hasUnhandledError', () => {
  const span = (overrides: Partial<TraceSpan>): TraceSpan =>
    ({
      id: 's',
      name: 'n',
      type: 'agent',
      duration: 0,
      startTime: '',
      endTime: '',
      ...overrides,
    }) as TraceSpan

  it('reports an unhandled error', () => {
    expect(hasUnhandledError(span({ status: 'error' }))).toBe(true)
  })

  it('ignores an error an error-handler path already handled', () => {
    expect(hasUnhandledError(span({ status: 'error', errorHandled: true }))).toBe(false)
  })

  it('stops at a successful mothership boundary that recovered from a failed child', () => {
    const boundary = span({
      type: 'mothership',
      status: 'success',
      children: [span({ status: 'error' })],
    })

    expect(hasUnhandledError(boundary)).toBe(false)
  })

  it('still descends through a successful workflow span', () => {
    const parent = span({
      type: 'workflow',
      status: 'success',
      children: [span({ status: 'error' })],
    })

    expect(hasUnhandledError(parent)).toBe(true)
  })

  it('only counts failed tool calls when explicitly asked', () => {
    const withFailedTool = span({
      status: 'success',
      toolCalls: [{ name: 't', error: 'boom' }],
    } as Partial<TraceSpan>)

    expect(hasUnhandledError(withFailedTool)).toBe(false)
    expect(hasUnhandledError(withFailedTool, { includeToolCalls: true })).toBe(true)
  })
})

describe('custom-block boundary spans', () => {
  const customBlockLog = {
    blockId: 'cb-1',
    blockName: 'Published Block',
    blockType: 'custom_block_abc',
    startedAt: '2024-01-01T10:00:00.000Z',
    endedAt: '2024-01-01T10:00:01.000Z',
    durationMs: 1000,
    success: true,
    executionOrder: 1,
    input: {},
    output: { answer: 42 },
  }

  it("never PERSISTS a custom block's child spans into the parent trace", () => {
    // The child's spans are handed to a LIVE consumer for terminal reconciliation, and
    // they ride the block log to get there — but they must not land in the parent's
    // stored trace. The persisted row keeps only the opaque handle, which is what read
    // time joins from.
    const result: ExecutionResult = {
      success: true,
      output: {},
      logs: [
        {
          ...customBlockLog,
          childTraceSpans: [
            { id: 'child-1', name: 'Publisher Agent', type: 'agent', blockId: 'src-1' },
          ],
        },
      ],
    } as unknown as ExecutionResult

    const { traceSpans } = buildTraceSpans(result)
    const boundary = traceSpans[0].children?.find((s) => s.blockId === 'cb-1') ?? traceSpans[0]

    expect(boundary.children ?? []).toEqual([])
  })

  it('never leaves child spans on the persisted span OUTPUT either', () => {
    // `children` is not the only channel. The spans ride the block output to reach the
    // live stream, and a custom block's publisher-curated outputs never declare
    // `childTraceSpans` as hiddenFromDisplay — so without a global hidden-key rule they
    // land in `span.output`, readable by anyone with parent-workspace access and never
    // re-checked by `hydrateChildTraces`.
    const result: ExecutionResult = {
      success: true,
      output: {},
      logs: [
        {
          ...customBlockLog,
          output: {
            answer: 42,
            childTraceSpans: [
              { id: 'child-1', name: 'Publisher Agent', type: 'agent', blockId: 'src-1' },
            ],
          },
        },
      ],
    } as unknown as ExecutionResult

    const { traceSpans } = buildTraceSpans(result)
    const boundary = traceSpans[0].children?.find((s) => s.blockId === 'cb-1') ?? traceSpans[0]

    expect(boundary.output).toBeDefined()
    expect(boundary.output).not.toHaveProperty('childTraceSpans')
    expect(boundary.output?.answer).toBe(42)
  })

  it('carries the opaque childExecutionId so read-time hydration can find the run', () => {
    const result: ExecutionResult = {
      success: true,
      output: {},
      logs: [{ ...customBlockLog, childExecution: { executionId: 'child-exec-1' } }],
    } as unknown as ExecutionResult

    const { traceSpans } = buildTraceSpans(result)
    const boundary = traceSpans[0].children?.find((s) => s.blockId === 'cb-1') ?? traceSpans[0]

    expect(boundary.childExecutionId).toBe('child-exec-1')
  })

  it('marks an untraced boundary so it cannot be mistaken for a leaf block', () => {
    // A boundary span with no children and no marker renders exactly like a block
    // that did nothing, which would make a deliberately partial trace read as complete.
    const result: ExecutionResult = {
      success: true,
      output: {},
      logs: [{ ...customBlockLog, childTraceDisabled: true }],
    } as unknown as ExecutionResult

    const { traceSpans } = buildTraceSpans(result)
    const boundary = traceSpans[0].children?.find((s) => s.blockId === 'cb-1') ?? traceSpans[0]

    expect(boundary.childTraceDisabled).toBe(true)
    expect(boundary.childExecutionId).toBeUndefined()
  })
})

describe('custom block invoked as an Agent tool', () => {
  const agentLog = {
    blockId: 'agent-1',
    blockName: 'Agent 1',
    blockType: 'agent',
    startedAt: '2024-01-01T10:00:00.000Z',
    endedAt: '2024-01-01T10:00:02.000Z',
    durationMs: 2000,
    success: true,
    executionOrder: 1,
    input: {},
  }

  function toolSpanFor(result: Record<string, unknown>, output?: Record<string, unknown>) {
    const executionResult: ExecutionResult = {
      success: true,
      output: {},
      logs: [
        {
          ...agentLog,
          output: {
            content: 'done',
            ...output,
            toolCalls: {
              list: [
                {
                  name: 'Published Block',
                  arguments: { topic: 'q3' },
                  result,
                  startTime: '2024-01-01T10:00:00.500Z',
                  endTime: '2024-01-01T10:00:01.500Z',
                  duration: 1000,
                },
              ],
              count: 1,
            },
          },
        },
      ],
    } as unknown as ExecutionResult

    const { traceSpans } = buildTraceSpans(executionResult)
    const agentSpan = traceSpans[0].children?.find((s) => s.blockId === 'agent-1') ?? traceSpans[0]
    return agentSpan.children?.find((s) => s.type === 'tool')
  }

  it('lifts the child run handle onto the tool span so hydration can join it', () => {
    // A custom block run as a tool produces a real child run, but the handle arrives
    // inside the tool result. The tool span is where a reader can act on it —
    // `hydrateChildTraces` walks nested children, so this is all the join needs.
    const toolSpan = toolSpanFor({ answer: 42, _childExecutionId: 'child-exec-2' })

    expect(toolSpan?.childExecutionId).toBe('child-exec-2')
  })

  it('strips the handle from what the tool span displays', () => {
    // Plumbing, not data: an opaque execution id sitting in a tool result reads like
    // something the tool returned.
    const toolSpan = toolSpanFor({ answer: 42, _childExecutionId: 'child-exec-2' })

    expect(toolSpan?.output).not.toHaveProperty('_childExecutionId')
    expect(toolSpan?.output?.answer).toBe(42)
  })

  it('marks an untraced tool invocation instead of joining it', () => {
    const toolSpan = toolSpanFor({ answer: 42, _childTraceDisabled: true })

    expect(toolSpan?.childExecutionId).toBeUndefined()
    expect(toolSpan?.childTraceDisabled).toBe(true)
    expect(toolSpan?.output).not.toHaveProperty('_childTraceDisabled')
  })
})
