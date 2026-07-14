/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openaiCompatToolCallStartChunks } from '@/providers/__fixtures__/openai-compat'
import { createOpenAICompatStreamingToolLoopStream } from '@/providers/openai-compat/streaming-tool-loop'
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
              { index: 0, id: 'call_1', type: 'function', function: { name: toolName, arguments: '' } },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
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
          choices: [{ delta: { content: 'done', reasoning_content: 'final thought' } }],
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
          choices: [{ delta: { content: 'done' } }],
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
          choices: [{ delta: { content: 'final answer' } }],
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
    expect(events.some((e) => e.type === 'text_delta' && e.text === 'final answer')).toBe(true)
    expect(logger.info).toHaveBeenCalledWith(
      'All forced tools have been used, switching to auto tool_choice'
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
        })()
      }
      return (async function* () {
        yield {
          choices: [{ delta: { content: 'fetched' } }],
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
      expect.objectContaining({ skipPostProcess: true })
    )
  })
})
