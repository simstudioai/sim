/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreate,
  mockExecuteTool,
  mockPrepareTools,
  mockCheckForced,
  mockCreateStream,
  envState,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockPrepareTools: vi.fn(),
  mockCheckForced: vi.fn(),
  mockCreateStream: vi.fn(),
  envState: {
    VLLM_BASE_URL: 'http://localhost:8000',
    VLLM_API_KEY: undefined as string | undefined,
  },
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))
vi.mock('@/lib/core/config/env', () => ({ env: envState }))
vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 20 }))
vi.mock('@/providers/models', () => ({
  getProviderModels: vi.fn(() => []),
  getProviderDefaultModel: vi.fn(() => 'vllm/generic'),
}))
vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: vi.fn((messages) => messages),
}))
vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))
vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn(() => ({ input: 0, output: 0, total: 0 })),
  prepareToolExecution: vi.fn((_tool, args) => ({ toolParams: args, executionParams: args })),
  prepareToolsWithUsageControl: mockPrepareTools,
  sumToolCosts: vi.fn(() => 0),
}))
vi.mock('@/providers/vllm/utils', () => ({
  checkForForcedToolUsage: mockCheckForced,
  createReadableStreamFromVLLMStream: mockCreateStream,
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/stores/providers', () => ({
  useProvidersStore: { getState: () => ({ setProviderModels: vi.fn() }) },
}))

import type { ProviderToolConfig } from '@/providers/types'
import { vllmProvider } from '@/providers/vllm/index'

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function chatResponse(content: string | null, toolCalls?: ToolCall[]) {
  return {
    choices: [{ message: { content, tool_calls: toolCalls } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

function makeTool(id: string): ProviderToolConfig {
  return {
    id,
    name: id,
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

describe('vllmProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envState.VLLM_BASE_URL = 'http://localhost:8000'
    envState.VLLM_API_KEY = undefined
    mockPrepareTools.mockReturnValue({
      tools: [{ type: 'function', function: { name: 'myTool' } }],
      toolChoice: 'auto',
      forcedTools: [],
      hasFilteredTools: false,
    })
    mockCheckForced.mockReturnValue({ hasUsedForcedTool: false, usedForcedTools: [] })
    mockCreateStream.mockReturnValue(new ReadableStream({ start: (c) => c.close() }))
    mockExecuteTool.mockResolvedValue({ success: true, output: { result: 'ok' } })
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
    expect(payload.max_completion_tokens).toBe(256)
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

  it('uses tool_choice "none" on the final streaming call after tool processing', async () => {
    mockCreate.mockResolvedValueOnce(chatResponse('answer')).mockResolvedValueOnce({})

    await vllmProvider.executeRequest({
      model: 'vllm/llama-3',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      tools: [makeTool('myTool')],
    })

    const streamingPayload = createPayload(1)
    expect(streamingPayload.stream).toBe(true)
    expect(streamingPayload.tool_choice).toBe('none')
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
    envState.VLLM_BASE_URL = ''

    await expect(
      vllmProvider.executeRequest({
        model: 'vllm/llama-3',
        messages: [{ role: 'user', content: 'hi' }],
      })
    ).rejects.toThrow('VLLM_BASE_URL is required')
  })
})
