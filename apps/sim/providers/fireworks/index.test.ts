/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'

const {
  mockCreate,
  mockSupportsNativeStructuredOutputs,
  mockPrepareToolsWithUsageControl,
  mockExecuteTool,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockSupportsNativeStructuredOutputs: vi.fn(),
  mockPrepareToolsWithUsageControl: vi.fn(),
  mockExecuteTool: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

vi.mock('@/providers/models', () => ({
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getProviderModels: vi.fn().mockReturnValue([]),
  getProviderDefaultModel: vi.fn().mockReturnValue('llama-v3p1-70b-instruct'),
}))

vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: vi.fn((messages) => messages),
}))

vi.mock('@/providers/fireworks/utils', () => ({
  supportsNativeStructuredOutputs: mockSupportsNativeStructuredOutputs,
  createReadableStreamFromOpenAIStream: vi.fn(
    () => new ReadableStream({ start: (controller) => controller.close() })
  ),
  checkForForcedToolUsage: vi.fn(() => ({ hasUsedForcedTool: false, usedForcedTools: [] })),
}))

vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn().mockReturnValue({ input: 0, output: 0, total: 0 }),
  generateSchemaInstructions: vi.fn(() => 'SCHEMA_INSTRUCTIONS'),
  prepareToolExecution: vi.fn(() => ({ toolParams: { x: 1 }, executionParams: { x: 1 } })),
  prepareToolsWithUsageControl: mockPrepareToolsWithUsageControl,
  sumToolCosts: vi.fn().mockReturnValue(0),
}))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { fireworksProvider } from '@/providers/fireworks/index'
import { ProviderError } from '@/providers/types'

const textResponse = (content: string) => ({
  choices: [{ message: { content, tool_calls: [] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
})

const toolCallResponse = (
  assistant: { content?: string | null; reasoning_content?: string } = {}
) => ({
  choices: [
    {
      message: {
        content: assistant.content ?? null,
        ...(assistant.reasoning_content !== undefined
          ? { reasoning_content: assistant.reasoning_content }
          : {}),
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'my_tool', arguments: '{"x":1}' } },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
})

const toolDef = {
  id: 'my_tool',
  name: 'my_tool',
  description: '',
  params: {},
  parameters: { type: 'object', properties: {}, required: [] },
}

const callBody = (index: number) => mockCreate.mock.calls[index][0]
const lastCallBody = () => mockCreate.mock.calls.at(-1)?.[0]

describe('fireworksProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupportsNativeStructuredOutputs.mockResolvedValue(true)
    mockPrepareToolsWithUsageControl.mockImplementation((tools) => ({
      tools,
      toolChoice: 'auto',
      forcedTools: [],
    }))
    mockExecuteTool.mockResolvedValue({ success: true, output: { ok: true } })
  })

  const baseRequest = {
    model: 'fireworks/llama-v3p1-70b-instruct',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    apiKey: 'fw-test-key',
  }

  it('throws when the API key is missing', async () => {
    await expect(
      fireworksProvider.executeRequest({ ...baseRequest, apiKey: undefined })
    ).rejects.toThrow('API key is required for Fireworks')
  })

  it('returns content and token usage for a simple request', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('hi there'))

    const result = await fireworksProvider.executeRequest(baseRequest)

    expect(result).toMatchObject({
      content: 'hi there',
      model: 'llama-v3p1-70b-instruct',
      tokens: { input: 10, output: 5, total: 15 },
    })
  })

  it('wraps API errors in a ProviderError', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'))

    await expect(fireworksProvider.executeRequest(baseRequest)).rejects.toBeInstanceOf(
      ProviderError
    )
  })

  it('streams directly when there are no tools', async () => {
    mockCreate.mockResolvedValueOnce({})

    const result = await fireworksProvider.executeRequest({ ...baseRequest, stream: true })

    expect(lastCallBody()).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(result).toHaveProperty('stream')
    expect(result).toHaveProperty('execution')
  })

  it('sends a json_schema response_format with no strict field', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('{}'))

    await fireworksProvider.executeRequest({
      ...baseRequest,
      responseFormat: { name: 'my_schema', schema: { type: 'object' }, strict: true },
    })

    expect(lastCallBody().response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'my_schema', schema: { type: 'object' } },
    })
    expect(lastCallBody().response_format.json_schema).not.toHaveProperty('strict')
  })

  it('falls back to json_object with prompt instructions when native is unsupported', async () => {
    mockSupportsNativeStructuredOutputs.mockResolvedValue(false)
    mockCreate.mockResolvedValueOnce(textResponse('{}'))

    await fireworksProvider.executeRequest({
      ...baseRequest,
      responseFormat: { name: 'my_schema', schema: { type: 'object' } },
    })

    expect(lastCallBody().response_format).toEqual({ type: 'json_object' })
    expect(lastCallBody().messages.at(-1)).toEqual({
      role: 'user',
      content: 'SCHEMA_INSTRUCTIONS',
    })
  })

  it('defers response_format to a final call when tools are active', async () => {
    mockCreate
      .mockResolvedValueOnce(textResponse('intermediate'))
      .mockResolvedValueOnce(textResponse('{"done":true}'))

    await fireworksProvider.executeRequest({
      ...baseRequest,
      responseFormat: { name: 'my_schema', schema: { type: 'object' } },
      tools: [toolDef],
    })

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(callBody(0).response_format).toBeUndefined()
    expect(callBody(0).tools).toBeDefined()
    expect(callBody(1).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'my_schema', schema: { type: 'object' } },
    })
    expect(callBody(1).tools).toBeUndefined()
  })

  it('runs the tool loop and threads tool results back into the conversation', async () => {
    mockCreate
      .mockResolvedValueOnce(toolCallResponse())
      .mockResolvedValueOnce(textResponse('final answer'))

    const result = await fireworksProvider.executeRequest({ ...baseRequest, tools: [toolDef] })

    expect(mockExecuteTool).toHaveBeenCalledWith('my_tool', { x: 1 }, expect.anything())
    expect(result).toMatchObject({ content: 'final answer' })
    expect((result as { toolCalls?: unknown[] }).toolCalls).toHaveLength(1)

    const followUpMessages = callBody(1).messages
    expect(followUpMessages).toContainEqual(
      expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) })
    )
    expect(followUpMessages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_1' })
    )
  })

  it('replays Fireworks assistant content and reasoning_content on the second request', async () => {
    mockCreate
      .mockResolvedValueOnce(
        toolCallResponse({
          content: 'I will use the tool.',
          reasoning_content: 'Need the tool result.',
        })
      )
      .mockResolvedValueOnce(textResponse('final answer'))

    await fireworksProvider.executeRequest({ ...baseRequest, tools: [toolDef] })

    expect(
      callBody(1).messages.find((message: { role: string }) => message.role === 'assistant')
    ).toEqual({
      role: 'assistant',
      content: 'I will use the tool.',
      reasoning_content: 'Need the tool result.',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'my_tool', arguments: '{"x":1}' },
        },
      ],
    })
  })

  it('streams the settled tool-loop answer without a duplicate provider request', async () => {
    mockCreate.mockResolvedValueOnce(toolCallResponse()).mockResolvedValueOnce(textResponse('done'))

    const result = (await fireworksProvider.executeRequest({
      ...baseRequest,
      stream: true,
      tools: [toolDef],
    })) as StreamingExecution

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(result.execution.output).toMatchObject({
      content: 'done',
      tokens: { input: 18, output: 9, total: 27 },
      toolCalls: { count: 1 },
    })
    const reader = result.stream.getReader()
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text_delta', text: 'done', turn: 'final' },
    })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  })
})
