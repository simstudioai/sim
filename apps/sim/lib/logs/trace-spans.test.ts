import { describe, expect, test } from 'vitest'
import type { ExecutionResult } from '@/executor/types'
import { buildTraceSpans, stripCustomToolPrefix } from './trace-spans'

describe('buildTraceSpans', () => {
  test('should extract tool calls from agent block output with toolCalls.list format', () => {
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

  test('should extract tool calls from agent block output with direct toolCalls array format', () => {
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

  test('should extract tool calls from streaming response with executionData format', () => {
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

  test('should handle tool calls with errors', () => {
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final output' },
      logs: [
        {
          blockId: 'agent-4',
          blockName: 'Error Agent',
          blockType: 'agent',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:02.000Z',
          durationMs: 2000,
          success: true,
          input: { userPrompt: 'Test prompt' },
          output: {
            content: 'Agent response',
            model: 'gpt-4o',
            toolCalls: {
              list: [
                {
                  name: 'failing_tool',
                  arguments: { input: 'test' },
                  error: 'Tool execution failed',
                  duration: 1000,
                  startTime: '2024-01-01T10:00:00.500Z',
                  endTime: '2024-01-01T10:00:01.500Z',
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
    expect(agentSpan.toolCalls).toBeDefined()
    expect(agentSpan.toolCalls).toHaveLength(1)

    const toolCall = agentSpan.toolCalls![0]
    expect(toolCall.name).toBe('failing_tool')
    expect(toolCall.status).toBe('error')
    expect(toolCall.error).toBe('Tool execution failed')
    expect(toolCall.input).toEqual({ input: 'test' })
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
