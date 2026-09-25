import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersAttachmentsMock } from '@sim/testing/mocks/providers-attachments.mock'
import { providersModelsMock } from '@sim/testing/mocks/providers-models.mock'
import { providersTraceEnrichmentMock } from '@sim/testing/mocks/providers-trace-enrichment.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type StreamUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number }

const { streamOnComplete } = vi.hoisted(() => ({
  streamOnComplete: {
    current: undefined as undefined | ((content: string, usage: StreamUsage) => void),
  },
}))

vi.mock('openai', () => openaiMock)
vi.mock('@/providers', () => providersMock)
vi.mock('@/providers/models', () => providersModelsMock)
vi.mock('@/providers/attachments', () => providersAttachmentsMock)
vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)
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
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/tools', () => toolsMock)

import { ollamaCloudProvider } from '@/providers/ollama-cloud'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

const mockCreate = openaiMockFns.mockChatCompletionsCreate
const mockOpenAIConstructor = openaiMockFns.mockOpenAI
const mockExecuteTool = toolsMockFns.mockExecuteTool
providersUtilsMockFns.mockCalculateCost.mockReturnValue({
  input: 0,
  output: 0,
  total: 0,
  pricing: null,
})

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
