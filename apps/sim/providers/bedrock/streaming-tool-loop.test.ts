/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBedrockStreamingToolLoopStream } from '@/providers/bedrock/streaming-tool-loop'
import type { AgentStreamEvent } from '@/providers/stream-events'

async function collectEvents(
  stream: ReadableStream<AgentStreamEvent>
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }
  return events
}

const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
}))

vi.mock('@/providers/utils', () => ({
  prepareToolExecution: vi.fn(() => ({
    toolParams: { url: 'https://example.com' },
    executionParams: { url: 'https://example.com' },
  })),
  calculateCost: vi.fn(() => ({
    input: 0.01,
    output: 0.02,
    total: 0.03,
    pricing: { input: 1, output: 2, updatedAt: new Date().toISOString() },
  })),
  sumToolCosts: vi.fn(() => 0),
  trackForcedToolUsage: () => ({ hasUsedForcedTool: false, usedForcedTools: [] }),
}))

describe('createBedrockStreamingToolLoopStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { ok: true },
    })
  })

  it('emits tool_call_start/end and final text; no invented thinking', async () => {
    const turns = [
      (async function* () {
        yield {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: 'tooluse_1', name: 'http_request' } },
          },
        }
        yield {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: '{"url":"https://example.com"}' } },
          },
        }
        yield {
          metadata: { usage: { inputTokens: 11, outputTokens: 4 } },
        }
        yield { messageStop: { stopReason: 'tool_use' } }
      })(),
      (async function* () {
        yield {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { text: 'Request completed.' },
          },
        }
        yield {
          metadata: { usage: { inputTokens: 22, outputTokens: 6 } },
        }
        yield { messageStop: { stopReason: 'end_turn' } }
      })(),
    ]

    let turnIdx = 0
    const client = {
      send: vi.fn(async () => ({ stream: turns[turnIdx++] })),
    }

    const onComplete = vi.fn()
    const stream = createBedrockStreamingToolLoopStream({
      client: client as any,
      modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      request: {
        model: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
        tools: [
          {
            id: 'http_request',
            name: 'http_request',
            description: 'HTTP',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      } as any,
      messages: [{ role: 'user', content: [{ text: 'call it' }] }],
      inferenceConfig: { temperature: 0.7 },
      bedrockTools: [
        {
          toolSpec: {
            name: 'http_request',
            description: 'HTTP',
            inputSchema: { json: { type: 'object', properties: {} } },
          },
        },
      ],
      toolChoice: { auto: {} },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      timeSegments: [],
      onComplete,
    })

    const events = await collectEvents(stream)

    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
    expect(events.filter((e) => e.type === 'tool_call_start')).toEqual([
      { type: 'tool_call_start', id: 'tooluse_1', name: 'http_request' },
    ])
    expect(events.filter((e) => e.type === 'tool_call_end')).toEqual([
      { type: 'tool_call_end', id: 'tooluse_1', name: 'http_request', status: 'success' },
    ])
    // Text streams live as `pending`; the turn_end sequence classifies turns.
    expect(
      events
        .filter((e) => e.type === 'text_delta' && e.turn === 'pending')
        .map((e) => e.text)
        .join('')
    ).toBe('Request completed.')
    expect(events.filter((e) => e.type === 'turn_end').map((e) => e.turn)).toEqual([
      'intermediate',
      'final',
    ])

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Request completed.',
        toolCalls: expect.objectContaining({ count: 1 }),
      })
    )
  })

  it('fails an unexpected tool AbortError and reports completed usage', async () => {
    mockExecuteTool.mockRejectedValueOnce(
      new DOMException('tool aborted unexpectedly', 'AbortError')
    )
    const client = {
      send: vi.fn(async () => ({
        stream: (async function* () {
          yield {
            contentBlockStart: {
              contentBlockIndex: 0,
              start: { toolUse: { toolUseId: 'tooluse_1', name: 'http_request' } },
            },
          }
          yield {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { toolUse: { input: '{"url":"https://example.com"}' } },
            },
          }
          yield { metadata: { usage: { inputTokens: 11, outputTokens: 4 } } }
          yield { messageStop: { stopReason: 'tool_use' } }
        })(),
      })),
    }
    const onComplete = vi.fn()
    const stream = createBedrockStreamingToolLoopStream({
      client: client as any,
      modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      request: {
        model: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
        tools: [
          {
            id: 'http_request',
            name: 'http_request',
            description: 'HTTP',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      } as any,
      messages: [{ role: 'user', content: [{ text: 'call it' }] }],
      inferenceConfig: { temperature: 0.7 },
      bedrockTools: [
        {
          toolSpec: {
            name: 'http_request',
            description: 'HTTP',
            inputSchema: { json: { type: 'object', properties: {} } },
          },
        },
      ],
      toolChoice: { auto: {} },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      timeSegments: [],
      onComplete,
    })

    await expect(collectEvents(stream)).rejects.toMatchObject({ name: 'AbortError' })
    expect(onComplete).toHaveBeenLastCalledWith(
      expect.objectContaining({ tokens: { input: 11, output: 4, total: 15 } })
    )
  })

  it('finalizes truncated text when max_tokens is reached without a tool call', async () => {
    const client = {
      send: vi.fn(async () => ({
        stream: (async function* () {
          yield {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { text: 'Truncated answer' },
            },
          }
          yield { metadata: { usage: { inputTokens: 13, outputTokens: 7 } } }
          yield { messageStop: { stopReason: 'max_tokens' } }
        })(),
      })),
    }
    const onComplete = vi.fn()
    const timeSegments: Array<{ type: string }> = []
    const stream = createBedrockStreamingToolLoopStream({
      client: client as any,
      modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      request: {
        model: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
      } as any,
      messages: [{ role: 'user', content: [{ text: 'answer' }] }],
      inferenceConfig: { temperature: 0.7, maxTokens: 7 },
      bedrockTools: [],
      toolChoice: undefined,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      timeSegments: timeSegments as any,
      onComplete,
    })

    await expect(collectEvents(stream)).resolves.toEqual([
      { type: 'text_delta', text: 'Truncated answer', turn: 'pending' },
      { type: 'turn_end', turn: 'final' },
    ])
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Truncated answer',
        tokens: { input: 13, output: 7, total: 20 },
        iterations: 1,
      })
    )
    expect(timeSegments).toHaveLength(1)
    expect(timeSegments[0]).toMatchObject({
      type: 'model',
      finishReason: 'max_tokens',
      assistantContent: 'Truncated answer',
    })
  })

  it('rejects a max_tokens turn containing a partial tool call', async () => {
    const client = {
      send: vi.fn(async () => ({
        stream: (async function* () {
          yield {
            contentBlockStart: {
              contentBlockIndex: 0,
              start: { toolUse: { toolUseId: 'tooluse_partial', name: 'http_request' } },
            },
          }
          yield {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { toolUse: { input: '{"url":' } },
            },
          }
          yield { metadata: { usage: { inputTokens: 13, outputTokens: 7 } } }
          yield { messageStop: { stopReason: 'max_tokens' } }
        })(),
      })),
    }
    const stream = createBedrockStreamingToolLoopStream({
      client: client as any,
      modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      request: {
        model: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
        tools: [
          {
            id: 'http_request',
            name: 'http_request',
            description: 'HTTP',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      } as any,
      messages: [{ role: 'user', content: [{ text: 'answer' }] }],
      inferenceConfig: { temperature: 0.7, maxTokens: 7 },
      bedrockTools: [
        {
          toolSpec: {
            name: 'http_request',
            description: 'HTTP',
            inputSchema: { json: { type: 'object', properties: {} } },
          },
        },
      ],
      toolChoice: { auto: {} },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      timeSegments: [],
      onComplete: vi.fn(),
    })
    const captured: AgentStreamEvent[] = []
    const reader = stream.getReader()
    let streamError: unknown

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        captured.push(value)
      }
    } catch (error) {
      streamError = error
    }

    expect(streamError).toMatchObject({
      message: 'Bedrock returned tool use with stop reason max_tokens',
    })
    expect(captured).toContainEqual({
      type: 'tool_call_start',
      id: 'tooluse_partial',
      name: 'http_request',
    })
    expect(captured).toContainEqual({
      type: 'tool_call_end',
      id: 'tooluse_partial',
      name: 'http_request',
      status: 'error',
    })
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })
})
