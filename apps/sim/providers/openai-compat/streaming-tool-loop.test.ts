/**
 * @vitest-environment node
 */

import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openaiCompatToolCallStartChunks } from '@/providers/__fixtures__/openai-compat'
import type { OpenRouterChatCompletionChunk } from '@/providers/openai-compat/stream-events'
import {
  createOpenAICompatStreamingToolLoopStream,
  type OpenAICompatCreateCompletion,
} from '@/providers/openai-compat/streaming-tool-loop'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderToolConfig, TimeSegment } from '@/providers/types'

const { mockExecuteTool, mockPrepareToolExecution } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
  mockPrepareToolExecution: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
}))

vi.mock('@/providers/utils', () => ({
  prepareToolExecution: mockPrepareToolExecution,
  calculateCost: () => ({ input: 0.01, output: 0.02, total: 0.03 }),
  sumToolCosts: () => 0,
  /** Minimal faithful tracking: marks the forced tool used when the model called it. */
  trackForcedToolUsage: (
    toolCalls: Array<{ function?: { name?: string } }>,
    toolChoice: unknown,
    _logger: unknown,
    _provider: unknown,
    _forcedTools: string[],
    usedForcedTools: string[]
  ) => {
    const forcedName =
      toolChoice && typeof toolChoice === 'object'
        ? (toolChoice as { function?: { name?: string } }).function?.name
        : undefined
    const usedNow = Boolean(
      forcedName && toolCalls.some((toolCall) => toolCall.function?.name === forcedName)
    )
    return {
      hasUsedForcedTool: usedNow || usedForcedTools.length > 0,
      usedForcedTools: usedNow && forcedName ? [...usedForcedTools, forcedName] : usedForcedTools,
    }
  },
}))

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

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

function toolThenAnswerChunks(toolName: string, args: string, answer: string) {
  return [
    {
      choices: [
        {
          delta: {
            reasoning_content: 'I should call the tool. ',
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: toolName, arguments: '' },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          finish_reason: 'tool_calls',
          delta: {
            tool_calls: [{ index: 0, function: { arguments: args } }],
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    },
    // Second turn (final answer) — yielded by a separate createStream call
  ] as const
}

function openRouterChunk(
  delta: OpenRouterChatCompletionChunk['choices'][number]['delta'],
  finishReason: ChatCompletionChunk.Choice['finish_reason'] = null,
  usage?: CompletionUsage
): OpenRouterChatCompletionChunk {
  return {
    id: 'chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'openrouter/test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    usage,
  }
}

describe('createOpenAICompatStreamingToolLoopStream', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any

  beforeEach(() => {
    mockExecuteTool.mockReset()
    mockPrepareToolExecution.mockReset()
    logger.info.mockReset()
    mockPrepareToolExecution.mockImplementation((_tool: unknown, args: unknown) => ({
      toolParams: args,
      executionParams: args,
    }))
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { answer: 42 },
    })
  })

  it('keeps reasoning_content on assistant history when preserveAssistantReasoning is true', async () => {
    const messageHistory: unknown[][] = []
    let call = 0

    const createStream = vi.fn(async (params: { messages: unknown[] }) => {
      messageHistory.push(params.messages)
      call += 1
      if (call === 1) {
        return (async function* () {
          yield* toolThenAnswerChunks('lookup', '{}', '')
        })()
      }
      return (async function* () {
        yield {
          choices: [
            {
              delta: { content: 'done', reasoning_content: 'final thought' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }
      })()
    })

    const timeSegments: TimeSegment[] = []
    const stream = createOpenAICompatStreamingToolLoopStream({
      providerName: 'Deepseek',
      request: {
        model: 'deepseek-chat',
        apiKey: 'k',
        messages: [],
        tools: [{ id: 'lookup', name: 'lookup', description: 'd', parameters: {} } as any],
        thinkingLevel: 'enabled',
      },
      basePayload: { model: 'deepseek-chat' },
      messages: [{ role: 'user', content: 'use the tool' }],
      createStream: createStream as any,
      logger,
      timeSegments,
      preserveAssistantReasoning: true,
      onComplete: () => {},
    })

    await collectEvents(stream)

    expect(createStream).toHaveBeenCalledTimes(2)
    const secondTurnMessages = messageHistory[1] as Array<Record<string, unknown>>
    const assistantWithTools = secondTurnMessages.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls)
    )
    expect(assistantWithTools).toMatchObject({
      role: 'assistant',
      reasoning_content: 'I should call the tool. ',
    })
    const modelSegments = timeSegments.filter((segment) => segment.type === 'model')
    expect(modelSegments[0]).toMatchObject({
      thinkingContent: 'I should call the tool. ',
      finishReason: 'tool_calls',
      tokens: { input: 5, output: 3, total: 8 },
      provider: 'deepseek',
      toolCalls: [{ id: 'call_1', name: 'lookup', arguments: {} }],
    })
    expect(modelSegments[1]).toMatchObject({
      assistantContent: 'done',
      thinkingContent: 'final thought',
      finishReason: 'stop',
      tokens: { input: 8, output: 2, total: 10 },
      provider: 'deepseek',
    })
  })

  it('replays interleaved OpenRouter reasoning_details unchanged and in order', async () => {
    const messageHistory: unknown[][] = []
    const lookupTool: ProviderToolConfig = {
      id: 'lookup',
      name: 'lookup',
      description: 'Looks up a value',
      params: {},
      parameters: { type: 'object', properties: {}, required: [] },
    }
    const reasoningDetails = [
      {
        type: 'reasoning.text',
        text: 'Inspect the request. ',
        signature: null,
        id: 'reasoning-1',
        format: 'anthropic-claude-v1',
        index: 0,
      },
      {
        type: 'reasoning.encrypted',
        data: 'opaque-data',
        id: 'reasoning-2',
        format: 'anthropic-claude-v1',
        index: 1,
      },
      {
        type: 'reasoning.summary',
        summary: 'Use the lookup result.',
        id: 'reasoning-3',
        format: 'anthropic-claude-v1',
        index: 2,
      },
    ] as const
    let call = 0

    const createStream: OpenAICompatCreateCompletion = vi.fn(async (params) => {
      messageHistory.push(params.messages)
      call += 1
      if (call === 1) {
        return (async function* () {
          yield openRouterChunk({ reasoning_details: [reasoningDetails[0]] })
          yield openRouterChunk({
            content: 'I will look that up.',
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '' },
              },
            ],
          })
          yield openRouterChunk({ reasoning_details: [reasoningDetails[1]] })
          yield openRouterChunk(
            {
              reasoning_details: [reasoningDetails[2]],
              tool_calls: [{ index: 0, function: { arguments: '{}' } }],
            },
            'tool_calls',
            { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
          )
        })()
      }
      return (async function* () {
        yield openRouterChunk({ content: 'done' }, 'stop', {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
        })
      })()
    })

    const events = await collectEvents(
      createOpenAICompatStreamingToolLoopStream({
        providerName: 'OpenRouter',
        request: {
          model: 'openrouter/anthropic/claude-sonnet-4',
          apiKey: 'k',
          messages: [],
          tools: [lookupTool],
        },
        basePayload: { model: 'anthropic/claude-sonnet-4' },
        messages: [{ role: 'user', content: 'use the tool' }],
        createStream,
        logger,
        timeSegments: [],
        onComplete: () => {},
      })
    )

    expect(events.filter((event) => event.type === 'thinking_delta')).toEqual([
      { type: 'thinking_delta', text: 'Inspect the request. ' },
      { type: 'thinking_delta', text: 'Use the lookup result.' },
    ])
    const secondTurnMessages = messageHistory[1] as Array<Record<string, unknown>>
    const assistantWithTools = secondTurnMessages.find(
      (message) => message.role === 'assistant' && Array.isArray(message.tool_calls)
    )
    expect(assistantWithTools).toEqual({
      role: 'assistant',
      content: 'I will look that up.',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'lookup', arguments: '{}' },
        },
      ],
      reasoning_details: reasoningDetails,
    })
  })

  it('omits reasoning_content when preserveAssistantReasoning is false', async () => {
    const messageHistory: unknown[][] = []
    let call = 0

    const createStream = vi.fn(async (params: { messages: unknown[] }) => {
      messageHistory.push(params.messages)
      call += 1
      if (call === 1) {
        return (async function* () {
          yield* toolThenAnswerChunks('lookup', '{}', '')
        })()
      }
      return (async function* () {
        yield {
          choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }
      })()
    })

    const stream = createOpenAICompatStreamingToolLoopStream({
      providerName: 'Groq',
      request: {
        model: 'groq/openai/gpt-oss-120b',
        apiKey: 'k',
        messages: [],
        tools: [{ id: 'lookup', name: 'lookup', description: 'd', parameters: {} } as any],
      },
      basePayload: { model: 'openai/gpt-oss-120b' },
      messages: [{ role: 'user', content: 'use the tool' }],
      createStream: createStream as any,
      logger,
      timeSegments: [],
      preserveAssistantReasoning: false,
      onComplete: () => {},
    })

    await collectEvents(stream)

    const secondTurnMessages = messageHistory[1] as Array<Record<string, unknown>>
    const assistantWithTools = secondTurnMessages.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls)
    )
    expect(assistantWithTools).toBeDefined()
    expect(assistantWithTools?.reasoning_content).toBeUndefined()
  })

  it('rotates forced tool_choice to auto after the forced tool is used', async () => {
    const toolChoices: unknown[] = []
    let call = 0

    const createStream = vi.fn(async (params: { tool_choice?: unknown }) => {
      toolChoices.push(params.tool_choice)
      call += 1
      if (call === 1) {
        return (async function* () {
          yield* toolThenAnswerChunks('lookup', '{}', '')
        })()
      }
      return (async function* () {
        yield {
          choices: [{ delta: { content: 'final answer' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }
      })()
    })

    const events = await collectEvents(
      createOpenAICompatStreamingToolLoopStream({
        providerName: 'Deepseek',
        request: {
          model: 'deepseek-chat',
          apiKey: 'k',
          messages: [],
          tools: [{ id: 'lookup', name: 'lookup', description: 'd', parameters: {} } as any],
        },
        basePayload: {
          model: 'deepseek-chat',
          tool_choice: { type: 'function', function: { name: 'lookup' } },
        },
        messages: [{ role: 'user', content: 'force lookup then answer' }],
        createStream: createStream as any,
        logger,
        timeSegments: [],
        forcedTools: ['lookup'],
        onComplete: () => {},
      })
    )

    expect(createStream).toHaveBeenCalledTimes(2)
    expect(toolChoices[0]).toEqual({ type: 'function', function: { name: 'lookup' } })
    expect(toolChoices[1]).toBe('auto')
    // Text streams live as `pending`; turn_end classifies each turn.
    expect(
      events.some(
        (e) => e.type === 'text_delta' && e.text === 'final answer' && e.turn === 'pending'
      )
    ).toBe(true)
    expect(events.filter((e) => e.type === 'turn_end').map((e) => e.turn)).toEqual([
      'intermediate',
      'final',
    ])
    expect(logger.info).toHaveBeenCalledWith(
      'All forced tools have been used, switching to auto tool_choice'
    )
  })

  it('fails the call without executing when tool argument JSON is malformed', async () => {
    let call = 0
    const createStream = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return (async function* () {
          yield* toolThenAnswerChunks('lookup', '{"query": "unterminated', '')
        })()
      }
      return (async function* () {
        yield {
          choices: [{ delta: { content: 'recovered' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }
      })()
    })

    const events = await collectEvents(
      createOpenAICompatStreamingToolLoopStream({
        providerName: 'Deepseek',
        request: {
          model: 'deepseek-chat',
          apiKey: 'k',
          messages: [],
          tools: [{ id: 'lookup', name: 'lookup', description: 'd', parameters: {} } as any],
        },
        basePayload: { model: 'deepseek-chat' },
        messages: [{ role: 'user', content: 'use the tool' }],
        createStream: createStream as any,
        logger,
        timeSegments: [],
        onComplete: () => {},
      })
    )

    // Tool must not run with defaulted {} args; the call fails and the model
    // gets the error result on the next turn.
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(events).toContainEqual({
      type: 'tool_call_end',
      id: 'call_1',
      name: 'lookup',
      status: 'error',
    })
    expect(createStream).toHaveBeenCalledTimes(2)
  })

  it.each(['null', '[]', '"text"', '0', 'false'])(
    'does not execute tools with non-object arguments: %s',
    async (argumentsJson) => {
      let call = 0
      const createStream = vi.fn(async () => {
        call += 1
        if (call === 1) {
          return (async function* () {
            yield* toolThenAnswerChunks('lookup', argumentsJson, '')
          })()
        }
        return (async function* () {
          yield {
            choices: [{ delta: { content: 'recovered' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
          }
        })()
      })

      await collectEvents(
        createOpenAICompatStreamingToolLoopStream({
          providerName: 'Deepseek',
          request: {
            model: 'deepseek-chat',
            apiKey: 'k',
            messages: [],
            tools: [{ id: 'lookup', name: 'lookup', description: 'd', parameters: {} } as never],
          },
          basePayload: { model: 'deepseek-chat' },
          messages: [{ role: 'user', content: 'use the tool' }],
          createStream: createStream as never,
          logger,
          timeSegments: [],
          onComplete: () => {},
        })
      )

      expect(mockExecuteTool).not.toHaveBeenCalled()
      expect(createStream).toHaveBeenCalledTimes(2)
    }
  )

  it('fails an unexpected tool AbortError and reports completed usage', async () => {
    const createStream = vi.fn(async () => {
      return (async function* () {
        yield* toolThenAnswerChunks('lookup', '{}', '')
      })()
    })
    mockExecuteTool.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))

    const onComplete = vi.fn()
    const stream = createOpenAICompatStreamingToolLoopStream({
      providerName: 'Deepseek',
      request: {
        model: 'deepseek-chat',
        apiKey: 'k',
        messages: [],
        tools: [{ id: 'lookup', name: 'lookup', description: 'd', parameters: {} } as never],
      },
      basePayload: { model: 'deepseek-chat' },
      messages: [{ role: 'user', content: 'use the tool' }],
      createStream: createStream as never,
      logger,
      timeSegments: [],
      onComplete,
    })

    await expect(collectEvents(stream)).rejects.toMatchObject({ name: 'AbortError' })
    expect(createStream).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenLastCalledWith(
      expect.objectContaining({ tokens: { input: 5, output: 3, total: 8 } })
    )
  })

  it.each([
    [false, 'false'],
    [0, '0'],
    ['', '""'],
    [null, 'null'],
  ] as const)('replays successful falsy tool output %j', async (output, expectedContent) => {
    let call = 0
    const createStream = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return (async function* () {
          yield* toolThenAnswerChunks('lookup', '{}', '')
        })()
      }
      return (async function* () {
        yield {
          choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }
      })()
    })
    mockExecuteTool.mockResolvedValueOnce({ success: true, output })

    await collectEvents(
      createOpenAICompatStreamingToolLoopStream({
        providerName: 'Deepseek',
        request: {
          model: 'deepseek-chat',
          apiKey: 'k',
          messages: [],
          tools: [{ id: 'lookup', name: 'lookup', description: 'd', parameters: {} } as never],
        },
        basePayload: { model: 'deepseek-chat' },
        messages: [{ role: 'user', content: 'use the tool' }],
        createStream: createStream as never,
        logger,
        timeSegments: [],
        onComplete: () => {},
      })
    )

    const secondPayload = createStream.mock.calls[1][0] as {
      messages: Array<{ role: string; content?: string }>
    }
    expect(secondPayload.messages).toContainEqual(
      expect.objectContaining({ role: 'tool', content: expectedContent })
    )
  })

  it('streams thinking live and assembles tool args from deltas', async () => {
    let call = 0
    const createStream = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return (async function* () {
          yield* openaiCompatToolCallStartChunks as any
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '"https://example.com"}' } }],
                },
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
          }
          yield {
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          }
        })()
      }
      return (async function* () {
        yield {
          choices: [{ delta: { content: 'fetched' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        }
      })()
    })

    await collectEvents(
      createOpenAICompatStreamingToolLoopStream({
        providerName: 'Deepseek',
        request: {
          model: 'deepseek-chat',
          apiKey: 'k',
          messages: [],
          tools: [
            { id: 'http_request', name: 'http_request', description: 'd', parameters: {} } as any,
          ],
        },
        basePayload: { model: 'deepseek-chat' },
        messages: [{ role: 'user', content: 'fetch' }],
        createStream: createStream as any,
        logger,
        timeSegments: [],
        onComplete: () => {},
      })
    )

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'http_request',
      { url: 'https://example.com' },
      expect.not.objectContaining({ skipPostProcess: true })
    )
  })

  it('finalizes truncated text when finish_reason is length without a tool call', async () => {
    const createStream = vi.fn(async () =>
      (async function* () {
        yield {
          choices: [{ delta: { content: 'Truncated answer' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 },
        }
      })()
    )
    const onComplete = vi.fn()
    const timeSegments: TimeSegment[] = []

    const events = await collectEvents(
      createOpenAICompatStreamingToolLoopStream({
        providerName: 'OpenAI',
        request: { model: 'gpt-4.1', apiKey: 'k', messages: [] },
        basePayload: { model: 'gpt-4.1', max_tokens: 9 },
        messages: [{ role: 'user', content: 'answer' }],
        createStream: createStream as never,
        logger,
        timeSegments,
        onComplete,
      })
    )

    expect(events).toEqual([
      { type: 'text_delta', text: 'Truncated answer', turn: 'pending' },
      { type: 'turn_end', turn: 'final' },
    ])
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Truncated answer',
        tokens: { input: 7, output: 9, total: 16 },
        iterations: 1,
      })
    )
    expect(timeSegments).toHaveLength(1)
    expect(timeSegments[0]).toMatchObject({
      type: 'model',
      finishReason: 'length',
      assistantContent: 'Truncated answer',
    })
  })

  it('rejects a length-capped turn containing a partial tool call', async () => {
    const createStream = vi.fn(async () =>
      (async function* () {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_partial',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"query":' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }
        yield {
          choices: [{ delta: {}, finish_reason: 'length' }],
          usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 },
        }
      })()
    )
    const stream = createOpenAICompatStreamingToolLoopStream({
      providerName: 'OpenAI',
      request: {
        model: 'gpt-4.1',
        apiKey: 'k',
        messages: [],
        tools: [{ id: 'lookup', name: 'lookup', description: 'd', parameters: {} } as never],
      },
      basePayload: { model: 'gpt-4.1', max_tokens: 9 },
      messages: [{ role: 'user', content: 'answer' }],
      createStream: createStream as never,
      logger,
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

    expect(streamError).toEqual(new Error('OpenAI returned tool calls with finish_reason length'))
    expect(captured).toContainEqual({
      type: 'tool_call_start',
      id: 'call_partial',
      name: 'lookup',
    })
    expect(captured).toContainEqual({
      type: 'tool_call_end',
      id: 'call_partial',
      name: 'lookup',
      status: 'error',
    })
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })
})
