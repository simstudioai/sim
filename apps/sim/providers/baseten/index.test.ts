/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  getProviderModels: vi.fn().mockReturnValue([]),
  getProviderDefaultModel: vi.fn().mockReturnValue('openai/gpt-oss-120b'),
}))

vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: vi.fn((messages) => messages),
}))

vi.mock('@/providers/baseten/utils', () => ({
  supportsNativeStructuredOutputs: mockSupportsNativeStructuredOutputs,
  createReadableStreamFromOpenAIStream: vi.fn(() => ({}) as ReadableStream),
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

import { basetenProvider } from '@/providers/baseten/index'
import { ProviderError } from '@/providers/types'

const textResponse = (content: string) => ({
  choices: [{ message: { content, tool_calls: [] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
})

const toolCallResponse = () => ({
  choices: [
    {
      message: {
        content: null,
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

describe('basetenProvider', () => {
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
    model: 'baseten/openai/gpt-oss-120b',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    apiKey: 'bt-test-key',
  }

  it('throws when the API key is missing', async () => {
    await expect(
      basetenProvider.executeRequest({ ...baseRequest, apiKey: undefined })
    ).rejects.toThrow('API key is required for Baseten')
  })

  it('returns content and token usage for a simple request', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('hi there'))

    const result = await basetenProvider.executeRequest(baseRequest)

    expect(result).toMatchObject({
      content: 'hi there',
      model: 'openai/gpt-oss-120b',
      tokens: { input: 10, output: 5, total: 15 },
    })
  })

  it('strips only the leading baseten/ prefix from the model id', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('ok'))

    await basetenProvider.executeRequest(baseRequest)

    expect(callBody(0).model).toBe('openai/gpt-oss-120b')
  })

  it('wraps API errors in a ProviderError', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'))

    await expect(basetenProvider.executeRequest(baseRequest)).rejects.toBeInstanceOf(ProviderError)
  })

  it('streams directly when there are no tools', async () => {
    mockCreate.mockResolvedValueOnce({})

    const result = await basetenProvider.executeRequest({ ...baseRequest, stream: true })

    expect(lastCallBody()).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(result).toHaveProperty('stream')
    expect(result).toHaveProperty('execution')
  })

  it('sends a json_schema response_format with no strict field', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('{}'))

    await basetenProvider.executeRequest({
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

    await basetenProvider.executeRequest({
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

    await basetenProvider.executeRequest({
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

    const result = await basetenProvider.executeRequest({ ...baseRequest, tools: [toolDef] })

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

  it("forces tool_choice 'none' on the final streaming call after tools run", async () => {
    mockCreate
      .mockResolvedValueOnce(toolCallResponse())
      .mockResolvedValueOnce(textResponse('done'))
      .mockResolvedValueOnce({})

    await basetenProvider.executeRequest({ ...baseRequest, stream: true, tools: [toolDef] })

    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(lastCallBody()).toMatchObject({ tool_choice: 'none', stream: true })
  })
})
