/**
 * @vitest-environment node
 *
 * Step 7: Anthropic streaming tool loop — live tool_call_start/end, final-turn-only
 * answer text, abort → cancelled, per-turn usage accumulation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  anthropicThinkingTextToolExpectedThinking,
  anthropicThinkingTextToolStreamEvents,
} from '@/providers/__fixtures__/anthropic'
import { createAnthropicStreamingToolLoopStream } from '@/providers/anthropic/streaming-tool-loop'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { TimeSegment } from '@/providers/types'

const { mockExecuteTool, mockPrepareToolExecution } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
  mockPrepareToolExecution: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
}))

vi.mock('@/providers/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/utils')>()
  return {
    ...actual,
    prepareToolExecution: mockPrepareToolExecution,
    calculateCost: () => ({ input: 0.01, output: 0.02, total: 0.03 }),
    sumToolCosts: () => 0,
  }
})

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

function makeFinalMessage(overrides: {
  content: unknown[]
  usage?: { input_tokens: number; output_tokens: number }
  stop_reason?: string | null
}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content: overrides.content,
    stop_reason: overrides.stop_reason ?? null,
    stop_sequence: null,
    usage: overrides.usage ?? { input_tokens: 10, output_tokens: 20 },
  }
}

function makeMessageStream(
  events: unknown[],
  finalMessage: ReturnType<typeof makeFinalMessage>
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
      }
    },
    finalMessage: async () => finalMessage,
  }
}

describe('createAnthropicStreamingToolLoopStream (Step 7)', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrepareToolExecution.mockReturnValue({
      toolParams: { city: 'San Francisco' },
      executionParams: { city: 'San Francisco' },
    })
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { temp: 68 },
    })
  })

  it('emits tool_call_start/end, intermediate then final text, and accumulates usage', async () => {
    const toolTurnEvents = anthropicThinkingTextToolStreamEvents
    const toolTurnMessage = makeFinalMessage({
      content: [
        {
          type: 'thinking',
          thinking: anthropicThinkingTextToolExpectedThinking,
          signature: 'EpABCkYICBgCKkDfixture-thinking-signature-abc123xyz',
        },
        { type: 'text', text: 'Let me check the weather in San Francisco.' },
        {
          type: 'tool_use',
          id: 'toolu_fixture_01Weather',
          name: 'get_weather',
          input: { city: 'San Francisco' },
        },
      ],
      usage: { input_tokens: 42, output_tokens: 30 },
      stop_reason: 'tool_use',
    })

    const finalTurnEvents = [
      {
        type: 'message_start',
        message: {
          usage: { input_tokens: 100, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'It is 68°F in San Francisco.' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 12 },
      },
      { type: 'message_stop' },
    ]
    const finalTurnMessage = makeFinalMessage({
      content: [{ type: 'text', text: 'It is 68°F in San Francisco.' }],
      usage: { input_tokens: 100, output_tokens: 12 },
      stop_reason: 'end_turn',
    })

    let streamCall = 0
    const anthropic = {
      messages: {
        stream: vi.fn(() => {
          streamCall++
          if (streamCall === 1) {
            return makeMessageStream(toolTurnEvents as unknown[], toolTurnMessage)
          }
          return makeMessageStream(finalTurnEvents, finalTurnMessage)
        }),
      },
    } as any

    const timeSegments: TimeSegment[] = []
    const onComplete = vi.fn()

    const stream = createAnthropicStreamingToolLoopStream({
      anthropic,
      payload: {
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Weather?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      } as any,
      request: {
        model: 'claude-sonnet-4-5',
        apiKey: 'test',
        tools: [{ id: 'get_weather', name: 'get_weather', params: {}, parameters: {} }],
      } as any,
      messages: [{ role: 'user', content: 'Weather?' }],
      logger,
      timeSegments,
      onComplete,
    })

    const events = await collectEvents(stream)

    expect(events.filter((e) => e.type === 'thinking_delta').length).toBeGreaterThan(0)
    expect(events).toContainEqual({
      type: 'tool_call_start',
      id: 'toolu_fixture_01Weather',
      name: 'get_weather',
    })
    expect(events).toContainEqual({
      type: 'tool_call_end',
      id: 'toolu_fixture_01Weather',
      name: 'get_weather',
      status: 'success',
    })

    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents.some((e) => e.turn === 'intermediate')).toBe(true)
    expect(textEvents.some((e) => e.turn === 'final')).toBe(true)
    expect(textEvents.find((e) => e.turn === 'final')?.text).toContain('68°F')

    // Assistant history must keep thinking signature for multi-iteration round-trip.
    const secondPayload = anthropic.messages.stream.mock.calls[1][0]
    const assistantMsg = secondPayload.messages.find((m: any) => m.role === 'assistant')
    expect(assistantMsg.content.some((b: any) => b.type === 'thinking' && b.signature)).toBe(true)
    expect(assistantMsg.content.some((b: any) => b.type === 'tool_use')).toBe(true)

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].tokens).toEqual({
      input: 142,
      output: 42,
      total: 184,
    })
    expect(onComplete.mock.calls[0][0].content).toContain('68°F')
    expect(mockExecuteTool).toHaveBeenCalled()
  })

  it('settles in-flight tools as cancelled on abort', async () => {
    const abortController = new AbortController()
    const toolStartEvents = [
      {
        type: 'message_start',
        message: { usage: { input_tokens: 5, output_tokens: 0 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu_abort',
          name: 'get_weather',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 3 },
      },
      { type: 'message_stop' },
    ]

    mockExecuteTool.mockImplementation(async () => {
      abortController.abort()
      throw new DOMException('Stream aborted', 'AbortError')
    })

    const anthropic = {
      messages: {
        stream: vi.fn(() =>
          makeMessageStream(
            toolStartEvents,
            makeFinalMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_abort',
                  name: 'get_weather',
                  input: {},
                },
              ],
              stop_reason: 'tool_use',
            })
          )
        ),
      },
    } as any

    const stream = createAnthropicStreamingToolLoopStream({
      anthropic,
      payload: {
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'x' }],
        tools: [
          {
            name: 'get_weather',
            description: 'd',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      } as any,
      request: {
        model: 'claude-sonnet-4-5',
        apiKey: 'test',
        tools: [{ id: 'get_weather', name: 'get_weather', params: {}, parameters: {} }],
        abortSignal: abortController.signal,
      } as any,
      messages: [{ role: 'user', content: 'x' }],
      logger,
      timeSegments: [],
      onComplete: vi.fn(),
    })

    const captured: AgentStreamEvent[] = []
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        captured.push(value)
      }
    } catch {
      // expected — stream errors after abort settlement
    }

    expect(captured).toContainEqual({
      type: 'tool_call_start',
      id: 'toolu_abort',
      name: 'get_weather',
    })
    expect(captured).toContainEqual({
      type: 'tool_call_end',
      id: 'toolu_abort',
      name: 'get_weather',
      status: 'cancelled',
    })
  })
})
