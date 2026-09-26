import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersAttachmentsMock } from '@sim/testing/mocks/providers-attachments.mock'
import {
  providersConversationHistoryMock,
  providersConversationHistoryMockFns,
} from '@sim/testing/mocks/providers-conversation-history.mock'
import {
  providersModelsMock,
  providersModelsMockFns,
} from '@sim/testing/mocks/providers-models.mock'
import { providersTraceEnrichmentMock } from '@sim/testing/mocks/providers-trace-enrichment.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCapabilities, mockSupportsNative, mockCheckForced, mockCreateStream } = vi.hoisted(
  () => ({
    mockCapabilities: vi.fn(),
    mockSupportsNative: vi.fn(),
    mockCheckForced: vi.fn(() => ({ hasUsedForcedTool: false, usedForcedTools: [] })),
    mockCreateStream: vi.fn(),
  })
)

vi.mock('openai', () => openaiMock)

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)

vi.mock('@/providers', () => providersMock)

vi.mock('@/tools', () => toolsMock)

vi.mock('@/providers/models', () => providersModelsMock)

vi.mock('@/providers/attachments', () => providersAttachmentsMock)

vi.mock('@/providers/openrouter/utils', () => ({
  supportsNativeStructuredOutputs: mockSupportsNative,
  getOpenRouterModelCapabilities: mockCapabilities,
  createReadableStreamFromOpenAIStream: mockCreateStream,
  checkForForcedToolUsage: mockCheckForced,
}))

vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)

vi.mock('@/providers/utils', () => providersUtilsMock)

import type { StreamingExecution } from '@/executor/types'
import { openRouterProvider } from '@/providers/openrouter/index'
import type { OpenRouterReasoningDetail } from '@/providers/openrouter/reasoning'
import type { ProviderRequest, ProviderResponse, ProviderToolConfig } from '@/providers/types'

const mockCreate = openaiMockFns.mockChatCompletionsCreate
providersMock.MAX_TOOL_ITERATIONS = 10
providersModelsMockFns.mockGetMaxOutputTokensForModel.mockReturnValue(100)
const mockConversationContext =
  providersConversationHistoryMockFns.mockGetConversationRequestContext
const mockCapture = providersConversationHistoryMockFns.mockCaptureProviderConversationStep
const mockRecordUsage = providersConversationHistoryMockFns.mockRecordProviderConversationUsage

const mockExecuteTool = toolsMockFns.mockExecuteTool
const mockPrepareTools = providersUtilsMockFns.mockPrepareToolsWithUsageControl
mockPrepareTools.mockImplementation((tools) => ({
  tools,
  toolChoice: 'auto',
  forcedTools: [],
  hasFilteredTools: false,
}))

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

function toolCallResponse(
  name: string,
  args: Record<string, unknown>,
  id = 'call_1',
  assistant: {
    content?: string | null
    reasoning?: string
    reasoning_details?: OpenRouterReasoningDetail[]
  } = {}
) {
  return {
    choices: [
      {
        message: {
          content: assistant.content ?? null,
          ...(assistant.reasoning !== undefined ? { reasoning: assistant.reasoning } : {}),
          ...(assistant.reasoning_details !== undefined
            ? { reasoning_details: assistant.reasoning_details }
            : {}),
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
    mockConversationContext.mockReturnValue(undefined)
    mockCapabilities.mockResolvedValue(null)
    mockCreate.mockReset()
    mockExecuteTool.mockReset()
    mockSupportsNative.mockResolvedValue(false)
    mockCreateStream.mockReturnValue(
      new ReadableStream({ start: (controller) => controller.close() })
    )
  })

  it.each([
    { contextWindow: 512, historySize: 2000, retained: false },
    { contextWindow: 128_000, historySize: 35_000, retained: true },
  ])(
    'budgets dynamic context $contextWindow from the existing capability cache',
    async ({ contextWindow, historySize, retained }) => {
      mockConversationContext.mockReturnValue({
        agentConversation: {},
        agentMemoryContext: { historyTokens: 64_000 },
      })
      mockCapabilities.mockResolvedValue({ contextWindow })
      mockCreate.mockResolvedValueOnce(textResponse('done'))
      const prior = { role: 'user' as const, content: 'x'.repeat(historySize) }
      const prompt = { role: 'user' as const, content: 'Current task' }
      const controller = new AbortController()
      await openRouterProvider.executeRequest({
        ...baseRequest,
        model: 'openrouter/custom-model',
        messages: [prior, prompt],
        maxTokens: 32,
        abortSignal: controller.signal,
      })
      expect(mockCapabilities).toHaveBeenCalledExactlyOnceWith(
        'openrouter/custom-model',
        controller.signal
      )
      const payload = mockCreate.mock.calls[0][0]
      expect(payload.messages.includes(prior)).toBe(retained)
      expect(payload.messages).toContain(prompt)
      expect(payload).not.toHaveProperty('contextWindow')
    }
  )

  it.each([false, true])(
    'keeps capped decisions unexecuted and accounts usage when synthesis failure is %s',
    async (failsSynthesis) => {
      let generated = 0
      mockCreate.mockImplementation((payload) => {
        const final = payload.tool_choice === 'none'
        if (final && failsSynthesis) return Promise.reject(new Error('synthesis failed'))
        return Promise.resolve({
          choices: [
            {
              message: {
                role: 'assistant',
                content: final ? 'Tool limit reached' : null,
                tool_calls: final
                  ? []
                  : [
                      {
                        id: `call-${++generated}`,
                        type: 'function',
                        function: { name: 'lookup', arguments: '{}' },
                      },
                    ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })
      })
      const result = openRouterProvider.executeRequest({ ...baseRequest, tools: [tool('lookup')] })
      if (failsSynthesis) await expect(result).rejects.toThrow('synthesis failed')
      else
        await expect(result).resolves.toMatchObject({
          tokens: { input: 60, output: 36, total: 96 },
        })
      expect(mockExecuteTool).toHaveBeenCalledTimes(10)
      expect(generated).toBe(11)
      expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        input: 5,
        output: 3,
        cacheRead: 0,
      })
      const capturedCalls = mockCapture.mock.calls.flatMap(
        ([, , message]) => message.tool_calls?.map((call: { id: string }) => call.id) ?? []
      )
      expect(capturedCalls).toEqual(Array.from({ length: 10 }, (_, index) => `call-${index + 1}`))
      expect(capturedCalls).not.toContain('call-11')
    }
  )

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

  it('preserves custom provider paths when stripping an uppercase namespace', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('ok'))
    await openRouterProvider.executeRequest({ ...baseRequest, model: 'OPENROUTER/Org/CustomModel' })
    expect(mockCreate.mock.calls[0][0].model).toBe('Org/CustomModel')
  })

  it('inserts context as a user message between system and history', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('ok'))

    await openRouterProvider.executeRequest({ ...baseRequest, context: 'CTX' })

    const { messages } = mockCreate.mock.calls[0][0]
    expect(messages[0]).toEqual({ role: 'system', content: 'You are helpful.' })
    expect(messages[1]).toEqual({ role: 'user', content: 'CTX' })
    expect(messages[2]).toEqual({ role: 'user', content: 'Hello' })
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

  it('replays OpenRouter reasoning_details unchanged with assistant content', async () => {
    const reasoningDetails: OpenRouterReasoningDetail[] = [
      {
        type: 'reasoning.summary',
        summary: 'Need current weather.',
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
        type: 'reasoning.text',
        text: 'Call the weather tool.',
        signature: null,
        id: 'reasoning-3',
        format: 'anthropic-claude-v1',
        index: 2,
      },
    ]
    mockCreate
      .mockResolvedValueOnce(
        toolCallResponse('get_weather', { city: 'SF' }, 'call_1', {
          content: 'I will check.',
          reasoning_details: reasoningDetails,
        })
      )
      .mockResolvedValueOnce(textResponse('done'))
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: { temp: 70 } })

    await openRouterProvider.executeRequest({
      ...baseRequest,
      tools: [tool('get_weather')],
    })

    const assistant = mockCreate.mock.calls[1][0].messages.find(
      (message: { role: string }) => message.role === 'assistant'
    )
    expect(assistant).toEqual({
      role: 'assistant',
      content: 'I will check.',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"SF"}' },
        },
      ],
      reasoning_details: reasoningDetails,
    })
  })

  it('does not add OpenRouter reasoning fields when the provider omitted them', async () => {
    mockCreate
      .mockResolvedValueOnce(
        toolCallResponse('get_weather', { city: 'SF' }, 'call_1', {
          content: 'I will check.',
        })
      )
      .mockResolvedValueOnce(textResponse('done'))
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: { temp: 70 } })

    await openRouterProvider.executeRequest({
      ...baseRequest,
      tools: [tool('get_weather')],
    })

    const assistant = mockCreate.mock.calls[1][0].messages.find(
      (message: { role: string }) => message.role === 'assistant'
    )
    expect(assistant).not.toHaveProperty('reasoning')
    expect(assistant).not.toHaveProperty('reasoning_details')
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

  it('streams the settled tool-loop answer without a duplicate provider request', async () => {
    mockCreate
      .mockResolvedValueOnce(toolCallResponse('get_weather', { city: 'SF' }))
      .mockResolvedValueOnce(
        textResponse('It is sunny', { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 })
      )
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: { temp: 70 } })

    const res = (await openRouterProvider.executeRequest({
      ...baseRequest,
      stream: true,
      tools: [tool('get_weather')],
    })) as StreamingExecution

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(res.execution.output).toMatchObject({
      content: 'It is sunny',
      tokens: { input: 28, output: 10, total: 38 },
      toolCalls: { count: 1 },
    })
    const reader = res.stream.getReader()
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text_delta', text: 'It is sunny', turn: 'final' },
    })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  })

  it('stops the tool loop at MAX_TOOL_ITERATIONS', async () => {
    mockCreate.mockImplementation((payload) =>
      payload.tool_choice === 'none'
        ? textResponse('iteration limit answer')
        : toolCallResponse('looping', {})
    )
    mockExecuteTool.mockResolvedValue({ success: true, output: {} })

    const res = (await openRouterProvider.executeRequest({
      ...baseRequest,
      tools: [tool('looping')],
    })) as ProviderResponse

    expect(mockCreate).toHaveBeenCalledTimes(12)
    expect(mockExecuteTool).toHaveBeenCalledTimes(10)
    expect(res.toolCalls?.length).toBe(10)
    expect(res.content).toBe('iteration limit answer')
    expect(mockCreate.mock.calls.at(-1)?.[0]).toMatchObject({ tool_choice: 'none' })
  })
})
