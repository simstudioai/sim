/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreate, mockExecuteTool } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExecuteTool: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 20 }))

vi.mock('@/lib/core/config/env', () => ({
  env: { LITELLM_BASE_URL: 'http://litellm.test', LITELLM_API_KEY: '' },
}))

vi.mock('@/stores/providers', () => ({
  useProvidersStore: { getState: () => ({ setProviderModels: vi.fn() }) },
}))

vi.mock('@/providers/models', () => ({
  getProviderModels: () => [],
  getProviderDefaultModel: () => '',
}))

vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: (messages: unknown) => messages,
}))

vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))

vi.mock('@/providers/litellm/utils', () => ({
  createReadableStreamFromLiteLLMStream: vi.fn(
    () => new ReadableStream({ start: (c) => c.close() })
  ),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn(() => ({ input: 0, output: 0, total: 0 })),
  sumToolCosts: vi.fn(() => 0),
  prepareToolExecution: vi.fn((_tool, toolArgs) => ({
    toolParams: toolArgs,
    executionParams: toolArgs,
  })),
  prepareToolsWithUsageControl: vi.fn((tools) => ({
    tools,
    toolChoice: 'auto',
    forcedTools: [],
    hasFilteredTools: false,
  })),
  trackForcedToolUsage: vi.fn(() => ({ hasUsedForcedTool: false, usedForcedTools: [] })),
  enforceStrictSchema: vi.fn((schema) => ({ ...schema, additionalProperties: false })),
}))

import { litellmProvider } from '@/providers/litellm'
import { ProviderError } from '@/providers/types'

interface ChatOptions {
  content?: string | null
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

function chat({ content = null, toolCalls, usage }: ChatOptions = {}) {
  return {
    choices: [
      {
        message: { content, tool_calls: toolCalls },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: usage ?? { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  }
}

function tool(name: string) {
  return { id: name, name, description: 'd', parameters: {} }
}

function run(request: Record<string, unknown>) {
  return litellmProvider.executeRequest!({
    model: 'litellm/llama-3',
    messages: [{ role: 'user', content: 'Hi' }],
    ...request,
  } as never) as Promise<any>
}

const firstPayload = () => mockCreate.mock.calls[0][0]
const lastPayload = () => mockCreate.mock.calls.at(-1)![0]

describe('litellmProvider.executeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockResolvedValue(chat({ content: 'hello' }))
    mockExecuteTool.mockResolvedValue({ success: true, output: { ok: true } })
  })

  it('assembles messages, strips the model prefix, and maps params', async () => {
    const result = await run({
      systemPrompt: 'You are helpful.',
      context: 'Some context',
      temperature: 0.5,
      maxTokens: 256,
    })

    const payload = firstPayload()
    expect(payload.model).toBe('llama-3')
    expect(payload.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Some context' },
      { role: 'user', content: 'Hi' },
    ])
    expect(payload.temperature).toBe(0.5)
    expect(payload.max_completion_tokens).toBe(256)
    expect(result.content).toBe('hello')
    expect(result.tokens).toEqual({ input: 5, output: 3, total: 8 })
  })

  it('forwards reasoning_effort only when set to a non-default value', async () => {
    await run({ reasoningEffort: 'high' })
    expect(firstPayload().reasoning_effort).toBe('high')

    mockCreate.mockClear()
    await run({ reasoningEffort: 'auto' })
    expect(firstPayload().reasoning_effort).toBeUndefined()

    mockCreate.mockClear()
    await run({})
    expect(firstPayload().reasoning_effort).toBeUndefined()
  })

  it('sanitizes the schema for strict response_format and passes it through otherwise', async () => {
    await run({ responseFormat: { name: 'r', schema: { type: 'object', properties: {} } } })
    let rf = firstPayload().response_format
    expect(rf.type).toBe('json_schema')
    expect(rf.json_schema.strict).toBe(true)
    expect(rf.json_schema.schema.additionalProperties).toBe(false)

    mockCreate.mockClear()
    await run({
      responseFormat: { name: 'r', schema: { type: 'object', properties: {} }, strict: false },
    })
    rf = firstPayload().response_format
    expect(rf.json_schema.strict).toBe(false)
    expect(rf.json_schema.schema.additionalProperties).toBeUndefined()
  })

  it('defers response_format past the tool loop and keeps tools on the final call', async () => {
    mockCreate
      .mockResolvedValueOnce(
        chat({ toolCalls: [{ id: 'c1', function: { name: 'known', arguments: '{"q":1}' } }] })
      )
      .mockResolvedValueOnce(chat({ content: 'mid' }))
      .mockResolvedValueOnce(chat({ content: '{"answer":1}' }))

    const result = await run({
      tools: [tool('known')],
      reasoningEffort: 'high',
      responseFormat: { name: 'r', schema: { type: 'object', properties: {} } },
    })

    expect(firstPayload().response_format).toBeUndefined()
    expect(firstPayload().tools).toBeDefined()

    const final = lastPayload()
    expect(final.response_format.type).toBe('json_schema')
    expect(final.tools).toBeDefined()
    expect(final.tool_choice).toBe('none')
    expect(final.parallel_tool_calls).toBe(false)
    expect(final.reasoning_effort).toBe('high')
    expect(result.content).toBe('{"answer":1}')
  })

  it('defers response_format into the final streaming call while keeping tools', async () => {
    mockCreate
      .mockResolvedValueOnce(
        chat({ toolCalls: [{ id: 'c1', function: { name: 'known', arguments: '{}' } }] })
      )
      .mockResolvedValueOnce(chat({ content: 'mid' }))

    const result = await run({
      stream: true,
      tools: [tool('known')],
      responseFormat: { name: 'r', schema: { type: 'object', properties: {} } },
    })

    const final = lastPayload()
    expect(final.stream).toBe(true)
    expect(final.response_format.type).toBe('json_schema')
    expect(final.tools).toBeDefined()
    expect(final.tool_choice).toBe('none')
    expect(final.parallel_tool_calls).toBe(false)
    expect(result.execution.isStreaming).toBe(true)
  })

  it('threads assistant tool_calls and a named tool response, and reports toolCalls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        chat({ toolCalls: [{ id: 'c1', function: { name: 'known', arguments: '{}' } }] })
      )
      .mockResolvedValueOnce(chat({ content: 'done' }))
    mockExecuteTool.mockResolvedValue({ success: true, output: { temp: 72 } })

    const result = await run({ tools: [tool('known')] })

    const followupMessages = mockCreate.mock.calls[1][0].messages
    expect(followupMessages).toContainEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'known', arguments: '{}' } }],
    })
    expect(followupMessages).toContainEqual({
      role: 'tool',
      tool_call_id: 'c1',
      name: 'known',
      content: JSON.stringify({ temp: 72 }),
    })
    expect(result.toolCalls).toHaveLength(1)
    expect(result.content).toBe('done')
  })

  it('emits a stub tool response for an unanswered tool_call_id', async () => {
    mockCreate
      .mockResolvedValueOnce(
        chat({ toolCalls: [{ id: 'cX', function: { name: 'ghost', arguments: '{}' } }] })
      )
      .mockResolvedValueOnce(chat({ content: 'recovered' }))

    await run({ tools: [tool('known')] })

    expect(mockExecuteTool).not.toHaveBeenCalled()
    const followupMessages = mockCreate.mock.calls[1][0].messages
    const toolMsg = followupMessages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'cX')
    expect(toolMsg).toBeDefined()
    expect(toolMsg.content).toContain('not available')
  })

  it('executes a tool with empty arguments without failing', async () => {
    mockCreate
      .mockResolvedValueOnce(
        chat({ toolCalls: [{ id: 'c1', function: { name: 'ping', arguments: '' } }] })
      )
      .mockResolvedValueOnce(chat({ content: 'pong' }))

    await run({ tools: [tool('ping')] })

    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    const toolMsg = mockCreate.mock.calls[1][0].messages.find((m: any) => m.role === 'tool')
    expect(toolMsg.content).not.toContain('"error":true')
  })

  it('stops the tool loop at MAX_TOOL_ITERATIONS', async () => {
    mockCreate.mockResolvedValue(
      chat({ toolCalls: [{ id: 'c1', function: { name: 'known', arguments: '{}' } }] })
    )

    await run({ tools: [tool('known')] })

    expect(mockCreate).toHaveBeenCalledTimes(1 + 20)
    expect(mockExecuteTool).toHaveBeenCalledTimes(20)
  })

  it('returns a streaming execution when streaming without active tools', async () => {
    const result = await run({ stream: true })

    expect(firstPayload().stream).toBe(true)
    expect(firstPayload().stream_options).toEqual({ include_usage: true })
    expect(result.stream).toBeInstanceOf(ReadableStream)
    expect(result.execution.isStreaming).toBe(true)
  })

  it('wraps API errors in a ProviderError using the error envelope message', async () => {
    mockCreate.mockRejectedValue({
      error: { message: 'rate limited', type: 'rate_limit_error', code: '429' },
    })

    await expect(run({})).rejects.toBeInstanceOf(ProviderError)
    await expect(run({})).rejects.toThrow('rate limited')
  })
})
