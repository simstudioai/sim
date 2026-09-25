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

const mockOpenAIConstructor = vi.hoisted(() => vi.fn())

vi.mock('openai', () => {
  const OpenAI = vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
      constructor(opts: unknown) {
        mockOpenAIConstructor(opts)
      }
    }
  )
  ;(OpenAI as unknown as { APIError: typeof MockAPIError }).APIError = MockAPIError
  return { default: OpenAI }
})

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 20 }))
vi.mock('@/providers/models', () => ({
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getProviderModels: vi.fn().mockReturnValue([]),
  getProviderDefaultModel: vi.fn().mockReturnValue(''),
}))
vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: (messages: unknown) => messages,
}))
vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))
vi.mock('@/providers/ollama-cloud/utils', () => ({
  createReadableStreamFromOllamaCloudStream: (
    _stream: unknown,
    onComplete: (content: string, usage: StreamUsage) => void
  ) => {
    streamOnComplete.current = onComplete
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
  },
}))
vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  calculateCost: () => ({ input: 0, output: 0, total: 0, pricing: null }),
  generateSchemaInstructions: () => 'SCHEMA_INSTRUCTIONS',
  prepareToolExecution: (_tool: unknown, args: Record<string, unknown>) => ({
    toolParams: args,
    executionParams: args,
  }),
  sumToolCosts: () => 0,
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { ollamaCloudProvider } from '@/providers/ollama-cloud'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

type ToolCallChunk = { id: string; type: 'function'; function: { name: string; arguments: string } }

function completion(
  opts: {
    content?: string | null
    toolCalls?: ToolCallChunk[]
    usage?: StreamUsage
    reasoning?: string
  } = {}
) {
  return {
    choices: [
      {
        message: {
          content: opts.content ?? null,
          tool_calls: opts.toolCalls,
          ...(opts.reasoning !== undefined ? { reasoning: opts.reasoning } : {}),
        },
      },
    ],
    usage: opts.usage ?? { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  }
}

const baseRequest: ProviderRequest = {
  model: 'ollama-cloud/gpt-oss:120b',
  messages: [{ role: 'user', content: 'hi' }],
  apiKey: 'oc-test-key',
}

describe('ollamaCloudProvider.executeRequest', () => {
  beforeEach(() => {
    streamOnComplete.current = undefined
    mockCreate.mockResolvedValue(completion({ content: 'hello' }))
    mockExecuteTool.mockResolvedValue({ success: true, output: { ok: true } })
  })

  it('throws when the API key is missing (BYOK is required)', async () => {
    await expect(
      ollamaCloudProvider.executeRequest({ ...baseRequest, apiKey: undefined })
    ).rejects.toThrow('API key is required for Ollama Cloud')
  })

  it('builds the OpenAI client with the cloud base URL and the user key', async () => {
    await ollamaCloudProvider.executeRequest(baseRequest)
    expect(mockOpenAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'oc-test-key',
        baseURL: 'https://ollama.com/v1',
      })
    )
  })

  it('strips the ollama-cloud/ prefix before calling the API and reports the stripped model id', async () => {
    const result = (await ollamaCloudProvider.executeRequest(baseRequest)) as ProviderResponse
    expect(mockCreate.mock.calls[0][0].model).toBe('gpt-oss:120b')
    expect(result).toMatchObject({ content: 'hello', model: 'gpt-oss:120b' })
  })

  it.each([
    ['ollama-cloud/deepseek-v4.1-flash', 'deepseek-v4.1-flash'],
    ['ollama-cloud/glm-5.3', 'glm-5.3'],
    ['OLLAMA-CLOUD/Org/CustomModel', 'Org/CustomModel'],
  ])(
    'forwards new and custom cloud models without changing their IDs: %s',
    async (model, wireModel) => {
      await ollamaCloudProvider.executeRequest({ ...baseRequest, model })
      expect(mockCreate.mock.calls[0][0].model).toBe(wireModel)
    }
  )
})
