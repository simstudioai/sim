import { resetEnvMock, setEnv } from '@sim/testing'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersAttachmentsMock } from '@sim/testing/mocks/providers-attachments.mock'
import {
  providersConversationHistoryMock,
  providersConversationHistoryMockFns,
} from '@sim/testing/mocks/providers-conversation-history.mock'
import { providersModelsMock } from '@sim/testing/mocks/providers-models.mock'
import { providersTraceEnrichmentMock } from '@sim/testing/mocks/providers-trace-enrichment.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckForced, mockCreateStream, pinnedFetchFn } = vi.hoisted(() => ({
  mockCheckForced: vi.fn(),
  mockCreateStream: vi.fn(),
  pinnedFetchFn: vi.fn(),
}))

vi.mock('openai', () => openaiMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)

vi.mock('@/providers', () => providersMock)
vi.mock('@/providers/models', () => providersModelsMock)
vi.mock('@/providers/attachments', () => providersAttachmentsMock)
vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/providers/vllm/utils', () => ({
  checkForForcedToolUsage: mockCheckForced,
  createReadableStreamFromVLLMStream: mockCreateStream,
}))
vi.mock('@/tools', () => toolsMock)
vi.mock('@/stores/providers', () => ({
  useProvidersStore: { getState: () => ({ setProviderModels: vi.fn() }) },
}))

import { clearProviderClientCacheForTests } from '@/providers/client-cache'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderToolConfig } from '@/providers/types'
import { vllmProvider } from '@/providers/vllm/index'

const mockCreate = openaiMockFns.mockChatCompletionsCreate
const mockCapture = providersConversationHistoryMockFns.mockCaptureProviderConversationStep
const mockRecordUsage = providersConversationHistoryMockFns.mockRecordProviderConversationUsage
/** Options each `new OpenAI(...)` received, in construction order. */
const openAIArgs = () =>
  openaiMockFns.mockOpenAI.mock.calls.map(
    (call) => (call as unknown[])[0] as Record<string, unknown>
  )

const mockValidateUrlWithDNS = inputValidationMockFns.mockValidateUrlWithDNS
const mockCreatePinnedFetch = inputValidationMockFns.mockCreatePinnedFetch
mockCreatePinnedFetch.mockImplementation(() => pinnedFetchFn)

const mockPrepareTools = providersUtilsMockFns.mockPrepareToolsWithUsageControl
const mockExecuteTool = toolsMockFns.mockExecuteTool

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function chatResponse(
  content: string | null,
  toolCalls?: ToolCall[],
  reasoning?: { reasoning?: string; reasoning_content?: string }
) {
  return {
    choices: [{ message: { content, tool_calls: toolCalls, ...reasoning } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

function makeTool(id: string): ProviderToolConfig {
  return {
    id,
    description: '',
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

const toolCall = (id: string, name: string, args = '{}'): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: args },
})

/** Payload passed to the Nth `chat.completions.create` call. */
const createPayload = (callIndex: number) => mockCreate.mock.calls[callIndex][0]

async function readAgentEvents(stream: ReadableStream<AgentStreamEvent>) {
  const events: AgentStreamEvent[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return events
    events.push(value)
  }
}

afterAll(resetEnvMock)

describe('vllmProvider', () => {
  beforeEach(() => {
    clearProviderClientCacheForTests()
    setEnv({ VLLM_BASE_URL: 'http://localhost:8000', VLLM_API_KEY: undefined })
    mockPrepareTools.mockReturnValue({
      tools: [{ type: 'function', function: { name: 'myTool' } }],
      toolChoice: 'auto',
      forcedTools: [],
      hasFilteredTools: false,
    })
    mockCheckForced.mockReturnValue({ hasUsedForcedTool: false, usedForcedTools: [] })
    mockCreateStream.mockReturnValue(new ReadableStream({ start: (c) => c.close() }))
    mockExecuteTool.mockResolvedValue({ success: true, output: { result: 'ok' } })
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mockCreatePinnedFetch.mockReturnValue(pinnedFetchFn)
  })

  it.each([false, true])(
    'keeps capped decisions unexecuted and accounts usage when synthesis failure is %s',
    async (failsSynthesis) => {
      let generated = 0
      mockCreate.mockImplementation((payload) => {
        const final = !payload.tools
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
                        function: { name: 'myTool', arguments: '{}' },
                      },
                    ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })
      })
      const result = vllmProvider.executeRequest({
        model: 'vllm/model',
        messages: [{ role: 'user', content: 'Run' }],
        tools: [makeTool('myTool')],
      })
      if (failsSynthesis) await expect(result).rejects.toThrow('synthesis failed')
      else
        await expect(result).resolves.toMatchObject({
          tokens: { input: 110, output: 66, total: 176 },
        })
      expect(mockExecuteTool).toHaveBeenCalledTimes(20)
      expect(generated).toBe(21)
      expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        input: 5,
        output: 3,
        cacheRead: 0,
      })
      const capturedCalls = mockCapture.mock.calls.flatMap(
        ([, , message]) => message.tool_calls?.map((call: { id: string }) => call.id) ?? []
      )
      expect(capturedCalls).toEqual(Array.from({ length: 20 }, (_, index) => `call-${index + 1}`))
      expect(capturedCalls).not.toContain('call-21')
    }
  )

  it('preserves a custom served-model name when stripping an uppercase namespace', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse('hello'))
    await vllmProvider.executeRequest({
      model: 'VLLM/Org/CustomModel',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(createPayload(0).model).toBe('Org/CustomModel')
  })

  describe('endpoint SSRF protection', () => {
    it('does not validate or pin when no endpoint is supplied (uses env base URL)', async () => {
      mockCreate.mockResolvedValueOnce(chatResponse('hi'))

      await vllmProvider.executeRequest({
        model: 'vllm/llama-3',
        messages: [{ role: 'user', content: 'hi' }],
      })

      expect(mockValidateUrlWithDNS).not.toHaveBeenCalled()
      expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
      expect(openAIArgs()[0].baseURL).toBe('http://localhost:8000/v1')
      expect(openAIArgs()[0].fetch).toBeUndefined()
    })

    it('does not duplicate an existing /v1 API prefix', async () => {
      setEnv({ VLLM_BASE_URL: 'http://localhost:1234/v1', VLLM_API_KEY: undefined })
      mockCreate.mockResolvedValueOnce(chatResponse('hi'))

      await vllmProvider.executeRequest({
        model: 'vllm/lmstudio-model',
        messages: [{ role: 'user', content: 'hi' }],
      })

      expect(openAIArgs()[0].baseURL).toBe('http://localhost:1234/v1')
    })

    it('validates a user-supplied endpoint and pins the connection to the resolved IP', async () => {
      mockCreate.mockResolvedValueOnce(chatResponse('hi'))

      await vllmProvider.executeRequest({
        model: 'vllm/llama-3',
        messages: [{ role: 'user', content: 'hi' }],
        azureEndpoint: 'https://my-vllm.example.com',
      })

      expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
        'https://my-vllm.example.com',
        'vLLM endpoint',
        'selfHostedService'
      )
      expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10', {
        profile: 'selfHostedService',
      })
      expect(openAIArgs()[0].baseURL).toBe('https://my-vllm.example.com/v1')
      expect(openAIArgs()[0].fetch).toBe(pinnedFetchFn)
    })

    it('preserves an existing /v1 prefix on a user-supplied endpoint', async () => {
      mockCreate.mockResolvedValueOnce(chatResponse('hi'))

      await vllmProvider.executeRequest({
        model: 'vllm/llama-3',
        messages: [{ role: 'user', content: 'hi' }],
        azureEndpoint: 'https://my-vllm.example.com/v1',
      })

      expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
        'https://my-vllm.example.com/v1',
        'vLLM endpoint',
        'selfHostedService'
      )
      expect(openAIArgs()[0].baseURL).toBe('https://my-vllm.example.com/v1')
      expect(openAIArgs()[0].fetch).toBe(pinnedFetchFn)
    })

    it('rejects a user-supplied endpoint that fails SSRF validation without issuing a request', async () => {
      mockValidateUrlWithDNS.mockResolvedValueOnce({
        isValid: false,
        error: 'vLLM endpoint resolves to a blocked IP address',
      })

      await expect(
        vllmProvider.executeRequest({
          model: 'vllm/llama-3',
          messages: [{ role: 'user', content: 'hi' }],
          azureEndpoint: 'http://169.254.169.254',
        })
      ).rejects.toThrow('Invalid vLLM endpoint')

      expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
      expect(openAIArgs()).toHaveLength(0)
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  it('builds a chat payload with the vllm/ prefix stripped and messages assembled in order', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse('hello'))

    const result = await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      systemPrompt: 'be helpful',
      context: 'prior context',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 256,
    })

    const payload = createPayload(0)
    expect(payload.model).toBe('llama-3')
    expect(payload.temperature).toBe(0.7)
    expect(payload.max_tokens).toBe(256)
    expect(payload.max_completion_tokens).toBeUndefined()
    expect(payload.messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'user',
    ])
    expect(result.content).toBe('hello')
    expect(result.tokens).toEqual({ input: 10, output: 5, total: 15 })
  })

  it('sends response_format as json_schema with strict when a responseFormat is provided', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse('{}'))

    await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: { name: 'out', schema: { type: 'object' }, strict: true },
    })

    expect(createPayload(0).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'out', schema: { type: 'object' }, strict: true },
    })
  })

  it('strips markdown code fences from structured-output content', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse('```json\n{"a":1}\n```'))

    const result = await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: { name: 'out', schema: { type: 'object' }, strict: true },
    })

    expect(result.content).toBe('{"a":1}')
  })

  it('runs the tool loop: executes tools, appends assistant + tool messages, returns results', async () => {
    mockCreate
      .mockResolvedValueOnce(chatResponse(null, [toolCall('call_1', 'myTool', '{"x":1}')]))
      .mockResolvedValueOnce(chatResponse('final answer'))

    const result = await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      messages: [{ role: 'user', content: 'use a tool' }],
      tools: [makeTool('myTool')],
    })

    expect(mockExecuteTool).toHaveBeenCalledWith('myTool', { x: 1 }, expect.anything())

    const [assistantMessage, toolMessage] = createPayload(1).messages.slice(-2)
    expect(assistantMessage).toMatchObject({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'myTool' } }],
    })
    expect(toolMessage).toMatchObject({ role: 'tool', tool_call_id: 'call_1' })
    expect(toolMessage).not.toHaveProperty('name')

    expect(result.content).toBe('final answer')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls?.[0]).toMatchObject({ name: 'myTool', success: true })
    expect(result.toolResults).toHaveLength(1)
  })

  it('replays vLLM assistant content and emitted reasoning fields on the second request', async () => {
    mockCreate
      .mockResolvedValueOnce(
        chatResponse('I will use the tool.', [toolCall('call_1', 'myTool', '{"x":1}')], {
          reasoning: 'Current vLLM reasoning.',
          reasoning_content: 'Legacy vLLM reasoning.',
        })
      )
      .mockResolvedValueOnce(chatResponse('final answer'))

    await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      messages: [{ role: 'user', content: 'use a tool' }],
      tools: [makeTool('myTool')],
    })

    const assistant = createPayload(1).messages.find(
      (message: { role: string }) => message.role === 'assistant'
    )
    expect(assistant).toEqual({
      role: 'assistant',
      content: 'I will use the tool.',
      reasoning: 'Current vLLM reasoning.',
      reasoning_content: 'Legacy vLLM reasoning.',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'myTool', arguments: '{"x":1}' },
        },
      ],
    })
  })

  it('records a failed tool result without throwing', async () => {
    mockExecuteTool.mockResolvedValueOnce({ success: false, error: 'tool blew up' })
    mockCreate
      .mockResolvedValueOnce(chatResponse(null, [toolCall('call_1', 'myTool')]))
      .mockResolvedValueOnce(chatResponse('done'))

    const result = await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      messages: [{ role: 'user', content: 'go' }],
      tools: [makeTool('myTool')],
    })

    expect(result.toolCalls?.[0]).toMatchObject({ name: 'myTool', success: false })
    const toolMessage = createPayload(1).messages.at(-1)
    expect(JSON.parse(toolMessage.content)).toMatchObject({ error: true, tool: 'myTool' })
  })

  it('surfaces a ProviderError when a follow-up model call fails mid-loop', async () => {
    mockCreate
      .mockResolvedValueOnce(chatResponse(null, [toolCall('call_1', 'myTool')]))
      .mockRejectedValueOnce(new Error('connection reset'))

    await expect(
      vllmProvider.executeRequest({
        model: 'vllm/llama-3',
        messages: [{ role: 'user', content: 'go' }],
        tools: [makeTool('myTool')],
      })
    ).rejects.toThrow('connection reset')

    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
  })

  it('cycles forced tools: forces the next forced tool after the first is used', async () => {
    mockPrepareTools.mockReturnValue({
      tools: [{ type: 'function', function: { name: 'toolA' } }],
      toolChoice: { type: 'function', function: { name: 'toolA' } },
      forcedTools: ['toolA', 'toolB'],
      hasFilteredTools: false,
    })
    mockCheckForced
      .mockReturnValueOnce({ hasUsedForcedTool: true, usedForcedTools: ['toolA'] })
      .mockReturnValueOnce({ hasUsedForcedTool: true, usedForcedTools: ['toolA', 'toolB'] })
    mockCreate
      .mockResolvedValueOnce(chatResponse(null, [toolCall('c1', 'toolA')]))
      .mockResolvedValueOnce(chatResponse('done'))

    await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      messages: [{ role: 'user', content: 'go' }],
      tools: [makeTool('toolA'), makeTool('toolB')],
    })

    expect(createPayload(1).tool_choice).toEqual({ type: 'function', function: { name: 'toolB' } })
  })

  it('streams directly when there are no tools, requesting usage in the stream', async () => {
    mockCreate.mockResolvedValueOnce({})

    const result = await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const payload = createPayload(0)
    expect(payload.stream).toBe(true)
    expect(payload.stream_options).toEqual({ include_usage: true })
    expect('stream' in result && 'execution' in result).toBe(true)
  })

  it('projects the settled tool-loop answer without a final streaming call', async () => {
    mockCreate
      .mockResolvedValueOnce(chatResponse(null, [toolCall('call_1', 'myTool')]))
      .mockResolvedValueOnce(chatResponse('answer'))

    const result = await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      tools: [makeTool('myTool')],
    })

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect('stream' in result).toBe(true)
    if (!('stream' in result)) throw new Error('Expected streaming execution')
    expect(result.execution.output.content).toBe('answer')
    expect(result.execution.output.tokens).toEqual({ input: 20, output: 10, total: 30 })
    expect(result.execution.output.providerTiming?.iterations).toBe(2)
    expect(
      result.execution.output.providerTiming?.timeSegments?.filter(
        (segment) => segment.type === 'model'
      )
    ).toHaveLength(2)
    await expect(
      readAgentEvents(result.stream as ReadableStream<AgentStreamEvent>)
    ).resolves.toEqual([{ type: 'text_delta', text: 'answer', turn: 'final' }])
  })

  it('throws a ProviderError carrying the vLLM error message on API failure', async () => {
    mockCreate.mockRejectedValueOnce({
      error: { message: 'bad request', type: 'invalid', code: 400 },
    })

    await expect(
      vllmProvider.executeRequest({
        model: 'vllm/llama-3',
        messages: [{ role: 'user', content: 'hi' }],
      })
    ).rejects.toThrow('bad request')
  })

  it('throws when no base URL is configured', async () => {
    setEnv({ VLLM_BASE_URL: '' })

    await expect(
      vllmProvider.executeRequest({
        model: 'vllm/llama-3',
        messages: [{ role: 'user', content: 'hi' }],
      })
    ).rejects.toThrow('VLLM_BASE_URL is required')
  })
})
