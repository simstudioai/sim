/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreate,
  mockExecuteTool,
  mockSupportsNative,
  mockPrepareTools,
  mockCheckForced,
  mockCreateStream,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockSupportsNative: vi.fn(),
  mockPrepareTools: vi.fn((tools: unknown) => ({
    tools,
    toolChoice: 'auto',
    forcedTools: [],
    hasFilteredTools: false,
  })),
  mockCheckForced: vi.fn(() => ({ hasUsedForcedTool: false, usedForcedTools: [] })),
  mockCreateStream: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 10 }))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

vi.mock('@/providers/models', () => ({
  getProviderModels: vi.fn().mockReturnValue([]),
  getProviderDefaultModel: vi.fn().mockReturnValue(''),
}))

vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: vi.fn((messages: unknown) => messages),
}))

vi.mock('@/providers/openrouter/utils', () => ({
  supportsNativeStructuredOutputs: mockSupportsNative,
  createReadableStreamFromOpenAIStream: mockCreateStream,
  checkForForcedToolUsage: mockCheckForced,
}))

vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn(() => ({ input: 0, output: 0, total: 0 })),
  prepareToolsWithUsageControl: mockPrepareTools,
  prepareToolExecution: vi.fn((_tool: unknown, toolArgs: Record<string, unknown>) => ({
    toolParams: toolArgs,
    executionParams: toolArgs,
  })),
  sumToolCosts: vi.fn(() => 0),
  generateSchemaInstructions: vi.fn(() => 'SCHEMA_INSTRUCTIONS'),
}))

import { openRouterProvider } from '@/providers/openrouter/index'
import type { ProviderRequest, ProviderResponse, ProviderToolConfig } from '@/providers/types'

interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

function textResponse(
  content: string,
  usage: Usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
) {
  return {
    choices: [{ message: { content, tool_calls: undefined }, finish_reason: 'stop' }],
    usage,
  }
}

function toolCallResponse(name: string, args: Record<string, unknown>, id = 'call_1') {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  }
}

function tool(id: string): ProviderToolConfig {
  return {
    id,
    name: id,
    description: 'test tool',
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

const baseRequest: ProviderRequest = {
  apiKey: 'sk-or-test',
  model: 'openrouter/anthropic/claude-3.5-sonnet',
  systemPrompt: 'You are helpful.',
  messages: [{ role: 'user', content: 'Hello' }],
}

describe('openRouterProvider.executeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockReset()
    mockExecuteTool.mockReset()
    mockSupportsNative.mockResolvedValue(false)
  })

  it('requires an API key', async () => {
    await expect(
      openRouterProvider.executeRequest({ model: 'openrouter/x', messages: [] })
    ).rejects.toThrow('API key is required for OpenRouter')
  })

  it('strips the openrouter/ prefix and returns content + tokens', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('Hi there'))

    const res = (await openRouterProvider.executeRequest(baseRequest)) as ProviderResponse

    expect(res.content).toBe('Hi there')
    expect(res.model).toBe('anthropic/claude-3.5-sonnet')
    expect(res.tokens).toEqual({ input: 10, output: 5, total: 15 })

    const payload = mockCreate.mock.calls[0][0]
    expect(payload.model).toBe('anthropic/claude-3.5-sonnet')
    expect(payload.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' })
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'Hello' })
  })

  it('inserts context as a user message between system and history', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('ok'))

    await openRouterProvider.executeRequest({ ...baseRequest, context: 'CTX' })

    const { messages } = mockCreate.mock.calls[0][0]
    expect(messages[0]).toEqual({ role: 'system', content: 'You are helpful.' })
    expect(messages[1]).toEqual({ role: 'user', content: 'CTX' })
    expect(messages[2]).toEqual({ role: 'user', content: 'Hello' })
  })

  it('forwards maxTokens as max_tokens and temperature', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('ok'))

    await openRouterProvider.executeRequest({ ...baseRequest, maxTokens: 256, temperature: 0.4 })

    const payload = mockCreate.mock.calls[0][0]
    expect(payload.max_tokens).toBe(256)
    expect(payload.temperature).toBe(0.4)
  })

  it('runs the tool loop: executes the tool, echoes tool_calls, returns the tool result, sums tokens', async () => {
    mockCreate
      .mockResolvedValueOnce(toolCallResponse('get_weather', { city: 'SF' }))
      .mockResolvedValueOnce(
        textResponse('It is sunny', { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 })
      )
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: { temp: 70 } })

    const res = (await openRouterProvider.executeRequest({
      ...baseRequest,
      tools: [tool('get_weather')],
    })) as ProviderResponse

    expect(mockExecuteTool).toHaveBeenCalledWith('get_weather', { city: 'SF' }, expect.anything())
    expect(res.content).toBe('It is sunny')
    expect(res.toolCalls?.[0]).toMatchObject({
      name: 'get_weather',
      result: { temp: 70 },
      success: true,
    })
    expect(res.toolResults).toEqual([{ temp: 70 }])
    expect(res.tokens).toEqual({ input: 28, output: 10, total: 38 })

    const secondMessages = mockCreate.mock.calls[1][0].messages
    const assistant = secondMessages.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant).toMatchObject({
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather' } }],
    })
    const toolMsg = secondMessages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMsg).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: JSON.stringify({ temp: 70 }),
    })
  })

  it('reports a failed tool result as an error payload to the model', async () => {
    mockCreate
      .mockResolvedValueOnce(toolCallResponse('get_weather', { city: 'SF' }))
      .mockResolvedValueOnce(textResponse('done'))
    mockExecuteTool.mockResolvedValueOnce({ success: false, output: undefined, error: 'boom' })

    const res = (await openRouterProvider.executeRequest({
      ...baseRequest,
      tools: [tool('get_weather')],
    })) as ProviderResponse

    expect(res.toolResults).toBeUndefined()
    expect(res.toolCalls?.[0]).toMatchObject({ success: false })
    const toolMsg = mockCreate.mock.calls[1][0].messages.find(
      (m: { role: string }) => m.role === 'tool'
    )
    expect(JSON.parse(toolMsg.content)).toEqual({
      error: true,
      message: 'boom',
      tool: 'get_weather',
    })
  })

  it('applies native structured outputs (json_schema + require_parameters) when no tools are active', async () => {
    mockSupportsNative.mockResolvedValue(true)
    mockCreate.mockResolvedValueOnce(textResponse('{"x":1}'))

    await openRouterProvider.executeRequest({
      ...baseRequest,
      responseFormat: {
        name: 'out',
        schema: { type: 'object', properties: { x: { type: 'number' } } },
        strict: true,
      },
    })

    const payload = mockCreate.mock.calls[0][0]
    expect(payload.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'out', strict: true },
    })
    expect(payload.provider).toMatchObject({ require_parameters: true })
  })

  it('falls back to json_object + prompt instructions when native structured outputs are unsupported', async () => {
    mockSupportsNative.mockResolvedValue(false)
    mockCreate.mockResolvedValueOnce(textResponse('{"x":1}'))

    await openRouterProvider.executeRequest({
      ...baseRequest,
      responseFormat: { name: 'out', schema: { type: 'object' } },
    })

    const payload = mockCreate.mock.calls[0][0]
    expect(payload.response_format).toEqual({ type: 'json_object' })
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'SCHEMA_INSTRUCTIONS' })
  })

  it('defers response_format until after the tool loop when tools are active', async () => {
    mockSupportsNative.mockResolvedValue(true)
    mockCreate
      .mockResolvedValueOnce(textResponse('interim'))
      .mockResolvedValueOnce(textResponse('{"x":1}'))

    const res = (await openRouterProvider.executeRequest({
      ...baseRequest,
      tools: [tool('get_weather')],
      responseFormat: { name: 'out', schema: { type: 'object' }, strict: true },
    })) as ProviderResponse

    const toolCall = mockCreate.mock.calls[0][0]
    expect(toolCall.tools).toBeDefined()
    expect(toolCall.response_format).toBeUndefined()

    const finalCall = mockCreate.mock.calls[1][0]
    expect(finalCall.response_format).toMatchObject({ type: 'json_schema' })
    expect(finalCall.tools).toBeUndefined()
    expect(finalCall.tool_choice).toBeUndefined()
    expect(res.content).toBe('{"x":1}')
  })

  it('forces the next tool after a forced tool is used', async () => {
    mockPrepareTools.mockReturnValueOnce({
      tools: [tool('a')],
      toolChoice: { type: 'function', function: { name: 'a' } },
      forcedTools: ['a', 'b'],
      hasFilteredTools: false,
    })
    mockCheckForced.mockReturnValueOnce({ hasUsedForcedTool: true, usedForcedTools: ['a'] })
    mockCreate
      .mockResolvedValueOnce(toolCallResponse('a', {}))
      .mockResolvedValueOnce(textResponse('done'))
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: {} })

    await openRouterProvider.executeRequest({ ...baseRequest, tools: [tool('a'), tool('b')] })

    expect(mockCreate.mock.calls[0][0].tool_choice).toEqual({
      type: 'function',
      function: { name: 'a' },
    })
    expect(mockCreate.mock.calls[1][0].tool_choice).toEqual({
      type: 'function',
      function: { name: 'b' },
    })
  })

  it('streams directly when there are no tools and sends usage opt-in', async () => {
    mockCreate.mockResolvedValueOnce({})

    const res = await openRouterProvider.executeRequest({ ...baseRequest, stream: true })

    const payload = mockCreate.mock.calls[0][0]
    expect(payload.stream).toBe(true)
    expect(payload.stream_options).toEqual({ include_usage: true })
    expect(mockCreateStream).toHaveBeenCalledTimes(1)
    expect(res).toHaveProperty('stream')
    expect(res).toHaveProperty('execution.output.model', 'anthropic/claude-3.5-sonnet')
  })

  it('stops the tool loop at MAX_TOOL_ITERATIONS', async () => {
    mockCreate.mockResolvedValue(toolCallResponse('looping', {}))
    mockExecuteTool.mockResolvedValue({ success: true, output: {} })

    const res = (await openRouterProvider.executeRequest({
      ...baseRequest,
      tools: [tool('looping')],
    })) as ProviderResponse

    expect(mockCreate).toHaveBeenCalledTimes(11)
    expect(mockExecuteTool).toHaveBeenCalledTimes(10)
    expect(res.toolCalls?.length).toBe(10)
  })

  it('wraps SDK errors in a ProviderError', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limited'))

    await expect(openRouterProvider.executeRequest(baseRequest)).rejects.toThrow('rate limited')
  })
})
