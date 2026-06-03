/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type StreamUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number }

const { mockCreate, mockExecuteTool, streamOnComplete, MockAPIError } = vi.hoisted(() => {
  class MockAPIError extends Error {
    status?: number
    code?: string | null
    type?: string
    constructor(message: string, opts: { status?: number; code?: string; type?: string } = {}) {
      super(message)
      this.name = 'APIError'
      this.status = opts.status
      this.code = opts.code
      this.type = opts.type
    }
  }
  return {
    mockCreate: vi.fn(),
    mockExecuteTool: vi.fn(),
    streamOnComplete: {
      current: undefined as undefined | ((content: string, usage: StreamUsage) => void),
    },
    MockAPIError,
  }
})

vi.mock('openai', () => {
  const OpenAI = vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  )
  ;(OpenAI as unknown as { APIError: typeof MockAPIError }).APIError = MockAPIError
  return { default: OpenAI }
})

vi.mock('@/lib/core/utils/urls', () => ({ getOllamaUrl: () => 'http://localhost:11434' }))
vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 20 }))
vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: (messages: unknown) => messages,
}))
vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))
vi.mock('@/providers/ollama/utils', () => ({
  createReadableStreamFromOllamaStream: (
    _stream: unknown,
    onComplete: (content: string, usage: StreamUsage) => void
  ) => {
    streamOnComplete.current = onComplete
    return 'OLLAMA_STREAM'
  },
}))
vi.mock('@/providers/utils', () => ({
  calculateCost: () => ({ input: 0, output: 0, total: 0, pricing: null }),
  generateSchemaInstructions: () => 'SCHEMA_INSTRUCTIONS',
  prepareToolExecution: (_tool: unknown, args: Record<string, unknown>) => ({
    toolParams: args,
    executionParams: args,
  }),
  sumToolCosts: () => 0,
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/stores/providers', () => ({
  useProvidersStore: { getState: () => ({ setProviderModels: vi.fn() }) },
}))

import { ollamaProvider } from '@/providers/ollama'
import type { ProviderRequest, ProviderResponse, ProviderToolConfig } from '@/providers/types'

interface StreamingResult {
  stream: string
  execution: {
    output: {
      content: string
      tokens: { input: number; output: number; total: number }
      toolCalls?: { list: unknown[]; count: number }
    }
  }
}

type ToolCallChunk = { id: string; type: 'function'; function: { name: string; arguments: string } }

function completion(
  opts: { content?: string | null; toolCalls?: ToolCallChunk[]; usage?: StreamUsage } = {}
) {
  return {
    choices: [{ message: { content: opts.content ?? null, tool_calls: opts.toolCalls } }],
    usage: opts.usage ?? { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  }
}

function makeTool(id: string, usageControl?: 'auto' | 'force' | 'none'): ProviderToolConfig {
  return {
    id,
    name: id,
    description: `${id} tool`,
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
    ...(usageControl ? { usageControl } : {}),
  }
}

const baseRequest: ProviderRequest = {
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'hi' }],
}

describe('ollamaProvider.executeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamOnComplete.current = undefined
    mockCreate.mockResolvedValue(completion({ content: 'hello' }))
    mockExecuteTool.mockResolvedValue({ success: true, output: { ok: true } })
  })

  it('assembles system, context, then history in order and forwards params', async () => {
    const result = (await ollamaProvider.executeRequest({
      ...baseRequest,
      systemPrompt: 'be nice',
      context: 'ctx',
      temperature: 0.5,
      maxTokens: 128,
    })) as ProviderResponse

    expect(result).toMatchObject({ content: 'hello', model: 'llama3.2' })
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.messages).toEqual([
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'ctx' },
      { role: 'user', content: 'hi' },
    ])
    expect(payload.model).toBe('llama3.2')
    expect(payload.temperature).toBe(0.5)
    expect(payload.max_tokens).toBe(128)
  })

  it('returns content verbatim (keeps ```json fences) when no responseFormat', async () => {
    const fenced = '```json\n{"a":1}\n```'
    mockCreate.mockResolvedValue(completion({ content: fenced }))
    const result = (await ollamaProvider.executeRequest(baseRequest)) as ProviderResponse
    expect(result.content).toBe(fenced)
  })

  it('strips ```json fences and requests JSON mode with schema instructions when responseFormat is set', async () => {
    mockCreate.mockResolvedValue(completion({ content: '```json\n{"a":1}\n```' }))
    const result = (await ollamaProvider.executeRequest({
      ...baseRequest,
      responseFormat: { name: 'r', schema: { type: 'object' }, strict: true },
    })) as ProviderResponse
    expect(result.content).toBe('{"a":1}')
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.response_format).toEqual({ type: 'json_object' })
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'SCHEMA_INSTRUCTIONS' })
  })

  it('defers structured output while tools run, then makes a final JSON-mode call', async () => {
    mockCreate
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            { id: 'call_1', type: 'function', function: { name: 'mytool', arguments: '{}' } },
          ],
        })
      )
      .mockResolvedValueOnce(completion({ content: 'intermediate' }))
      .mockResolvedValueOnce(completion({ content: '{"a":1}' }))

    const result = (await ollamaProvider.executeRequest({
      ...baseRequest,
      tools: [makeTool('mytool')],
      responseFormat: { name: 'r', schema: { type: 'object' } },
    })) as ProviderResponse

    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(mockCreate.mock.calls[0][0].response_format).toBeUndefined()
    expect(mockCreate.mock.calls[0][0].tools).toBeDefined()

    const finalCall = mockCreate.mock.calls[2][0]
    expect(finalCall.response_format).toEqual({ type: 'json_object' })
    expect(finalCall.tools).toBeUndefined()
    expect(finalCall.messages.at(-1)).toEqual({ role: 'user', content: 'SCHEMA_INSTRUCTIONS' })
    expect(result.content).toBe('{"a":1}')
  })

  it('runs the tool loop: parses string args, feeds results back, then terminates', async () => {
    mockCreate
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            { id: 'call_1', type: 'function', function: { name: 'mytool', arguments: '{"x":1}' } },
          ],
        })
      )
      .mockResolvedValueOnce(completion({ content: 'done' }))

    const result = (await ollamaProvider.executeRequest({
      ...baseRequest,
      tools: [makeTool('mytool')],
    })) as ProviderResponse

    expect(mockExecuteTool).toHaveBeenCalledWith('mytool', { x: 1 }, expect.anything())
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(result.content).toBe('done')
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: 'mytool', success: true, arguments: { x: 1 } }),
    ])
    expect(result.toolResults).toEqual([{ ok: true }])

    const followUp = mockCreate.mock.calls[1][0].messages
    expect(followUp).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        content: null,
        tool_calls: [
          expect.objectContaining({
            id: 'call_1',
            function: { name: 'mytool', arguments: '{"x":1}' },
          }),
        ],
      })
    )
    expect(followUp).toContainEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: JSON.stringify({ ok: true }),
    })
  })

  it('records a failed tool result without aborting the loop', async () => {
    mockExecuteTool.mockResolvedValue({ success: false, error: 'boom' })
    mockCreate
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            { id: 'call_1', type: 'function', function: { name: 'mytool', arguments: '{}' } },
          ],
        })
      )
      .mockResolvedValueOnce(completion({ content: 'recovered' }))

    const result = (await ollamaProvider.executeRequest({
      ...baseRequest,
      tools: [makeTool('mytool')],
    })) as ProviderResponse

    expect(result.content).toBe('recovered')
    expect(result.toolCalls?.[0]).toMatchObject({ name: 'mytool', success: false })
    const toolMsg = mockCreate.mock.calls[1][0].messages.find(
      (m: { role: string }) => m.role === 'tool'
    )
    expect(JSON.parse(toolMsg.content)).toMatchObject({ error: true, message: 'boom' })
  })

  it('executes parallel tool calls from a single response', async () => {
    mockExecuteTool
      .mockResolvedValueOnce({ success: true, output: { from: 'a' } })
      .mockResolvedValueOnce({ success: true, output: { from: 'b' } })
    mockCreate
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            { id: 'call_a', type: 'function', function: { name: 'a', arguments: '{}' } },
            { id: 'call_b', type: 'function', function: { name: 'b', arguments: '{}' } },
          ],
        })
      )
      .mockResolvedValueOnce(completion({ content: 'summary' }))

    const result = (await ollamaProvider.executeRequest({
      ...baseRequest,
      tools: [makeTool('a'), makeTool('b')],
    })) as ProviderResponse

    expect(mockExecuteTool).toHaveBeenCalledTimes(2)
    expect(result.toolCalls?.map((c) => c.name)).toEqual(['a', 'b'])
    const toolMsgs = mockCreate.mock.calls[1][0].messages.filter(
      (m: { role: string }) => m.role === 'tool'
    )
    expect(toolMsgs.map((m: { tool_call_id: string }) => m.tool_call_id)).toEqual([
      'call_a',
      'call_b',
    ])
  })

  it('filters out tools with usageControl "none"', async () => {
    await ollamaProvider.executeRequest({
      ...baseRequest,
      tools: [makeTool('keep'), makeTool('drop', 'none')],
    })
    const sent = mockCreate.mock.calls[0][0].tools
    expect(sent.map((t: { function: { name: string } }) => t.function.name)).toEqual(['keep'])
  })

  it('never forces tools (Ollama ignores tool_choice) and keeps "auto"', async () => {
    await ollamaProvider.executeRequest({ ...baseRequest, tools: [makeTool('forced', 'force')] })
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.tool_choice).toBe('auto')
    expect(payload.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      'forced',
    ])
  })

  it('surfaces an OpenAI APIError message through ProviderError', async () => {
    mockCreate.mockRejectedValue(
      new MockAPIError('model not found', {
        status: 404,
        code: 'not_found',
        type: 'invalid_request_error',
      })
    )
    await expect(ollamaProvider.executeRequest(baseRequest)).rejects.toThrow('model not found')
  })

  it('streams content and usage when no tools are used', async () => {
    const result = (await ollamaProvider.executeRequest({
      ...baseRequest,
      stream: true,
    })) as unknown as StreamingResult

    expect(result.stream).toBe('OLLAMA_STREAM')
    expect(mockCreate.mock.calls[0][0].stream_options).toEqual({ include_usage: true })

    streamOnComplete.current?.('streamed text', {
      prompt_tokens: 4,
      completion_tokens: 6,
      total_tokens: 10,
    })
    expect(result.execution.output.content).toBe('streamed text')
    expect(result.execution.output.tokens).toMatchObject({ input: 4, output: 6, total: 10 })
  })

  it('strips ```json fences from streamed content when responseFormat is set', async () => {
    const result = (await ollamaProvider.executeRequest({
      ...baseRequest,
      stream: true,
      responseFormat: { name: 'r', schema: { type: 'object' }, strict: true },
    })) as unknown as StreamingResult

    streamOnComplete.current?.('```json\n{"a":1}\n```', {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
    })
    expect(result.execution.output.content).toBe('{"a":1}')
  })

  it('streams the final response after a tool loop, carrying tool calls', async () => {
    mockCreate
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            { id: 'call_1', type: 'function', function: { name: 'mytool', arguments: '{}' } },
          ],
        })
      )
      .mockResolvedValueOnce(completion({ content: 'intermediate' }))

    const result = (await ollamaProvider.executeRequest({
      ...baseRequest,
      stream: true,
      tools: [makeTool('mytool')],
    })) as unknown as StreamingResult

    expect(result.stream).toBe('OLLAMA_STREAM')
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)

    const finalCall = mockCreate.mock.calls[2][0]
    expect(finalCall.tools).toBeUndefined()
    expect(finalCall.tool_choice).toBeUndefined()

    streamOnComplete.current?.('final answer', {
      prompt_tokens: 2,
      completion_tokens: 4,
      total_tokens: 6,
    })
    expect(result.execution.output.content).toBe('final answer')
    expect(result.execution.output.toolCalls).toMatchObject({ count: 1 })
  })
})
