import { describe, expect, test } from 'vitest'
import { buildTraceSpans, stripCustomToolPrefix } from '@/lib/logs/trace-spans'
import type { ExecutionResult } from '@/executor/types'

describe('buildTraceSpans', () => {
  test('should extract sequential segments from timeSegments data', () => {
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
            tokens: { prompt: 10, completion: 20, total: 30 },
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

  test('should fallback to toolCalls extraction when timeSegments not available', () => {
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
            tokens: { prompt: 10, completion: 20, total: 30 },
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
    expect(agentSpan.toolCalls).toBeDefined()
    expect(agentSpan.toolCalls).toHaveLength(2)

    // Check first tool call
    const firstToolCall = agentSpan.toolCalls![0]
    expect(firstToolCall.name).toBe('test_tool') // custom_ prefix should be stripped
    expect(firstToolCall.duration).toBe(1000)
    expect(firstToolCall.status).toBe('success')
    expect(firstToolCall.input).toEqual({ input: 'test input' })
    expect(firstToolCall.output).toEqual({ output: 'test output' })

    // Check second tool call
    const secondToolCall = agentSpan.toolCalls![1]
    expect(secondToolCall.name).toBe('http_request')
    expect(secondToolCall.duration).toBe(2000)
    expect(secondToolCall.status).toBe('success')
    expect(secondToolCall.input).toEqual({ url: 'https://api.example.com' })
    expect(secondToolCall.output).toEqual({ status: 200, data: 'response' })
  })

  test('should extract tool calls from agent block output with direct toolCalls array format (fallback)', () => {
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final output' },
      logs: [
        {
          blockId: 'agent-2',
          blockName: 'Test Agent 2',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:03.000Z',
          durationMs: 3000,
          success: true,
          input: { userPrompt: 'Test prompt' },
          output: {
            content: 'Agent response',
            model: 'gpt-4o',
            providerTiming: {
              duration: 2500,
              startTime: '2024-01-01T10:00:00.250Z',
              endTime: '2024-01-01T10:00:02.750Z',
              // No timeSegments - should fallback to toolCalls
            },
            toolCalls: [
              {
                name: 'serper_search',
                arguments: { query: 'test search' },
                result: { results: ['result1', 'result2'] },
                duration: 1500,
                startTime: '2024-01-01T10:00:00.500Z',
                endTime: '2024-01-01T10:00:02.000Z',
              },
            ],
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const agentSpan = traceSpans[0]
    expect(agentSpan.toolCalls).toBeDefined()
    expect(agentSpan.toolCalls).toHaveLength(1)

    const toolCall = agentSpan.toolCalls![0]
    expect(toolCall.name).toBe('serper_search')
    expect(toolCall.duration).toBe(1500)
    expect(toolCall.status).toBe('success')
    expect(toolCall.input).toEqual({ query: 'test search' })
    expect(toolCall.output).toEqual({ results: ['result1', 'result2'] })
  })

  test('should extract tool calls from streaming response with executionData format (fallback)', () => {
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final output' },
      logs: [
        {
          blockId: 'agent-3',
          blockName: 'Streaming Agent',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:04.000Z',
          durationMs: 4000,
          success: true,
          input: { userPrompt: 'Test prompt' },
          output: {
            content: 'Agent response',
            model: 'gpt-4o',
            // No providerTiming - should fallback to executionData
            executionData: {
              output: {
                toolCalls: {
                  list: [
                    {
                      name: 'custom_analysis_tool',
                      arguments: { data: 'sample data' },
                      result: { analysis: 'completed' },
                      duration: 2000,
                      startTime: '2024-01-01T10:00:01.000Z',
                      endTime: '2024-01-01T10:00:03.000Z',
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const agentSpan = traceSpans[0]
    expect(agentSpan.toolCalls).toBeDefined()
    expect(agentSpan.toolCalls).toHaveLength(1)

    const toolCall = agentSpan.toolCalls![0]
    expect(toolCall.name).toBe('analysis_tool') // custom_ prefix should be stripped
    expect(toolCall.duration).toBe(2000)
    expect(toolCall.status).toBe('success')
    expect(toolCall.input).toEqual({ data: 'sample data' })
    expect(toolCall.output).toEqual({ analysis: 'completed' })
  })

  test('should handle tool calls with errors in timeSegments', () => {
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final output' },
      logs: [
        {
          blockId: 'agent-4',
          blockName: 'Error Agent',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:03.000Z',
          durationMs: 3000,
          success: true,
          input: { userPrompt: 'Test prompt' },
          output: {
            content: 'Agent response',
            model: 'gpt-4o',
            providerTiming: {
              duration: 3000,
              startTime: '2024-01-01T10:00:00.000Z',
              endTime: '2024-01-01T10:00:03.000Z',
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
                  name: 'failing_tool',
                  startTime: 1704103201000, // 2024-01-01T10:00:01.000Z
                  endTime: 1704103202000, // 2024-01-01T10:00:02.000Z
                  duration: 1000,
                },
                {
                  type: 'model',
                  name: 'Model response (iteration 1)',
                  startTime: 1704103202000, // 2024-01-01T10:00:02.000Z
                  endTime: 1704103203000, // 2024-01-01T10:00:03.000Z
                  duration: 1000,
                },
              ],
            },
            toolCalls: {
              list: [
                {
                  name: 'failing_tool',
                  arguments: { input: 'test' },
                  error: 'Tool execution failed',
                  duration: 1000,
                  startTime: '2024-01-01T10:00:01.000Z',
                  endTime: '2024-01-01T10:00:02.000Z',
                },
              ],
              count: 1,
            },
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const agentSpan = traceSpans[0]
    expect(agentSpan.children).toBeDefined()
    expect(agentSpan.children).toHaveLength(3)

    // Check the tool segment with error
    const toolSegment = agentSpan.children![1]
    expect(toolSegment.name).toBe('failing_tool')
    expect(toolSegment.type).toBe('tool')
    expect(toolSegment.status).toBe('error')
    expect(toolSegment.input).toEqual({ input: 'test' })
    expect(toolSegment.output).toEqual({ error: 'Tool execution failed' })
  })

  test('should handle blocks without tool calls', () => {
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final output' },
      logs: [
        {
          blockId: 'text-1',
          blockName: 'Text Block',
          blockType: 'text',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:01.000Z',
          durationMs: 1000,
          success: true,
          input: { content: 'Hello world' },
          output: { content: 'Hello world' },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const textSpan = traceSpans[0]
    expect(textSpan.type).toBe('text')
    expect(textSpan.toolCalls).toBeUndefined()
  })

  test('should handle complex multi-iteration agent execution with sequential segments', () => {
    // This test simulates a real agent execution with multiple tool calls and model iterations
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final comprehensive response' },
      logs: [
        {
          blockId: 'agent-complex',
          blockName: 'Multi-Tool Agent',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:15.000Z',
          durationMs: 15000,
          success: true,
          input: { userPrompt: 'Research and analyze tennis news' },
          output: {
            content: 'Based on my research using multiple sources...',
            model: 'gpt-4o',
            tokens: { prompt: 50, completion: 200, total: 250 },
            cost: { total: 0.0025, prompt: 0.001, completion: 0.0015 },
            providerTiming: {
              duration: 15000,
              startTime: '2024-01-01T10:00:00.000Z',
              endTime: '2024-01-01T10:00:15.000Z',
              modelTime: 8000,
              toolsTime: 6500,
              iterations: 2,
              firstResponseTime: 1500,
              timeSegments: [
                {
                  type: 'model',
                  name: 'Initial response',
                  startTime: 1704103200000, // 2024-01-01T10:00:00.000Z
                  endTime: 1704103201500, // 2024-01-01T10:00:01.500Z
                  duration: 1500,
                },
                {
                  type: 'tool',
                  name: 'exa_search',
                  startTime: 1704103201500, // 2024-01-01T10:00:01.500Z
                  endTime: 1704103204000, // 2024-01-01T10:00:04.000Z
                  duration: 2500,
                },
                {
                  type: 'tool',
                  name: 'custom_analysis_tool',
                  startTime: 1704103204000, // 2024-01-01T10:00:04.000Z
                  endTime: 1704103208000, // 2024-01-01T10:00:08.000Z
                  duration: 4000,
                },
                {
                  type: 'model',
                  name: 'Model response (iteration 1)',
                  startTime: 1704103208000, // 2024-01-01T10:00:08.000Z
                  endTime: 1704103211500, // 2024-01-01T10:00:11.500Z
                  duration: 3500,
                },
                {
                  type: 'tool',
                  name: 'http_request',
                  startTime: 1704103211500, // 2024-01-01T10:00:11.500Z
                  endTime: 1704103213500, // 2024-01-01T10:00:13.500Z
                  duration: 2000,
                },
                {
                  type: 'model',
                  name: 'Model response (iteration 2)',
                  startTime: 1704103213500, // 2024-01-01T10:00:13.500Z
                  endTime: 1704103215000, // 2024-01-01T10:00:15.000Z
                  duration: 1500,
                },
              ],
            },
            toolCalls: {
              list: [
                {
                  name: 'exa_search',
                  arguments: { query: 'tennis news 2024', apiKey: 'secret-key' },
                  result: { results: [{ title: 'Tennis News 1' }, { title: 'Tennis News 2' }] },
                  duration: 2500,
                },
                {
                  name: 'custom_analysis_tool',
                  arguments: { data: 'tennis data', mode: 'comprehensive' },
                  result: { analysis: 'Detailed tennis analysis', confidence: 0.95 },
                  duration: 4000,
                },
                {
                  name: 'http_request',
                  arguments: {
                    url: 'https://api.tennis.com/stats',
                    headers: { authorization: 'Bearer token' },
                  },
                  result: { status: 200, data: { stats: 'tennis statistics' } },
                  duration: 2000,
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

    // Verify agent span properties
    expect(agentSpan.type).toBe('agent')
    expect(agentSpan.name).toBe('Multi-Tool Agent')
    expect(agentSpan.duration).toBe(15000)
    expect(agentSpan.children).toBeDefined()
    expect(agentSpan.children).toHaveLength(6) // 2 model + 3 tool + 1 model = 6 segments

    const segments = agentSpan.children!

    // Verify sequential execution flow
    // 1. Initial model response
    expect(segments[0].name).toBe('Initial response')
    expect(segments[0].type).toBe('model')
    expect(segments[0].duration).toBe(1500)
    expect(segments[0].status).toBe('success')

    // 2. First tool call - exa_search
    expect(segments[1].name).toBe('exa_search')
    expect(segments[1].type).toBe('tool')
    expect(segments[1].duration).toBe(2500)
    expect(segments[1].status).toBe('success')
    expect(segments[1].input).toEqual({ query: 'tennis news 2024', apiKey: 'secret-key' })
    expect(segments[1].output).toEqual({
      results: [{ title: 'Tennis News 1' }, { title: 'Tennis News 2' }],
    })

    // 3. Second tool call - analysis_tool (custom_ prefix stripped)
    expect(segments[2].name).toBe('analysis_tool')
    expect(segments[2].type).toBe('tool')
    expect(segments[2].duration).toBe(4000)
    expect(segments[2].status).toBe('success')
    expect(segments[2].input).toEqual({ data: 'tennis data', mode: 'comprehensive' })
    expect(segments[2].output).toEqual({ analysis: 'Detailed tennis analysis', confidence: 0.95 })

    // 4. First iteration model response
    expect(segments[3].name).toBe('Model response (iteration 1)')
    expect(segments[3].type).toBe('model')
    expect(segments[3].duration).toBe(3500)
    expect(segments[3].status).toBe('success')

    // 5. Third tool call - http_request
    expect(segments[4].name).toBe('http_request')
    expect(segments[4].type).toBe('tool')
    expect(segments[4].duration).toBe(2000)
    expect(segments[4].status).toBe('success')
    expect(segments[4].input).toEqual({
      url: 'https://api.tennis.com/stats',
      headers: { authorization: 'Bearer token' },
    })
    expect(segments[4].output).toEqual({ status: 200, data: { stats: 'tennis statistics' } })

    // 6. Final iteration model response
    expect(segments[5].name).toBe('Model response (iteration 2)')
    expect(segments[5].type).toBe('model')
    expect(segments[5].duration).toBe(1500)
    expect(segments[5].status).toBe('success')

    // Verify timing alignment
    const totalSegmentTime = segments.reduce((sum, segment) => sum + segment.duration, 0)
    expect(totalSegmentTime).toBe(15000) // Should match total agent duration

    // Verify no toolCalls property exists (since we're using children instead)
    expect(agentSpan.toolCalls).toBeUndefined()
  })
})

describe('stripCustomToolPrefix', () => {
  test('should strip custom_ prefix from tool names', () => {
    expect(stripCustomToolPrefix('custom_test_tool')).toBe('test_tool')
    expect(stripCustomToolPrefix('custom_analysis')).toBe('analysis')
  })

  test('should leave non-custom tool names unchanged', () => {
    expect(stripCustomToolPrefix('http_request')).toBe('http_request')
    expect(stripCustomToolPrefix('serper_search')).toBe('serper_search')
    expect(stripCustomToolPrefix('regular_tool')).toBe('regular_tool')
  })
})
