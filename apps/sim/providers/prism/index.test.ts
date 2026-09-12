/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '@/providers/types'

const { mockCalculateCost, mockClientOptions, mockCreate, mockCreateToolStream, mockPrepareTools } =
  vi.hoisted(() => ({
    mockCalculateCost: vi.fn(() => ({
      input: 0.000003,
      output: 0.000006,
      total: 0.000009,
      pricing: {
        input: 0.3,
        cachedInput: 0.07,
        output: 1.2,
        updatedAt: '2026-09-12',
      },
    })),
    mockClientOptions: vi.fn(),
    mockCreate: vi.fn(),
    mockCreateToolStream: vi.fn(),
    mockPrepareTools: vi.fn(),
  }))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }

      constructor(options: unknown) {
        mockClientOptions(options)
      }
    }
  ),
}))

vi.mock('@/providers/models', () => ({
  getProviderModels: vi.fn(() => ['prism/deepseek-v4.1-flash', 'prism/deepseek-v4-flash']),
  getProviderDefaultModel: vi.fn(() => 'prism/deepseek-v4.1-flash'),
}))

vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: vi.fn((messages) => messages),
}))

vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))

vi.mock('@/providers/openai-compat/streaming-tool-loop', () => ({
  createOpenAICompatStreamingToolLoopStream: mockCreateToolStream,
}))

vi.mock('@/providers/transport', () => ({
  openAICompatTransport: vi.fn(() => ({})),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: mockCalculateCost,
  enforceStrictSchema: vi.fn((schema: Record<string, unknown>) => ({
    ...schema,
    required: ['answer'],
    additionalProperties: false,
  })),
  prepareToolsWithUsageControl: mockPrepareTools,
}))

import { PRISM_BASE_URL, prismProvider } from '@/providers/prism'

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: 'prism/deepseek-v4.1-flash',
    apiKey: 'prism_sk_test',
    systemPrompt: 'Be concise.',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.4,
    maxTokens: 321,
    reasoningEffort: 'high',
    responseFormat: {
      name: 'answer',
      schema: { type: 'object', properties: { answer: { type: 'string' } } },
    },
    ...overrides,
  }
}

describe('prismProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"answer":"Hi"}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
  })

  it('uses the fixed endpoint and sends the canonical model ID unchanged', async () => {
    await prismProvider.executeRequest(request())

    expect(mockClientOptions).toHaveBeenCalledWith({
      apiKey: 'prism_sk_test',
      baseURL: PRISM_BASE_URL,
    })
    expect(mockCreate).toHaveBeenCalledWith(
      {
        model: 'prism/deepseek-v4.1-flash',
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.4,
        max_tokens: 321,
        reasoning_effort: 'high',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'answer',
            schema: {
              type: 'object',
              properties: { answer: { type: 'string' } },
              required: ['answer'],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      },
      undefined
    )
  })

  it('uses the shared tool loop with reasoning replay and returns tool results', async () => {
    mockPrepareTools.mockReturnValue({
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Look up a value',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
      toolChoice: 'auto',
      forcedTools: [],
    })
    mockCreateToolStream.mockImplementation(
      (options: { onComplete: (result: Record<string, unknown>) => void }) => {
        options.onComplete({
          content: 'Found it',
          tokens: { input: 10, output: 5, total: 15 },
          cost: { input: 0, output: 0, toolCost: 0.25, total: 0.25 },
          toolCalls: { list: [], count: 0 },
          toolResults: [{ value: 'result' }],
          modelTime: 1,
          toolsTime: 1,
          firstResponseTime: 1,
          iterations: 2,
        })
        return new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
      }
    )

    const result = await prismProvider.executeRequest(
      request({
        responseFormat: undefined,
        tools: [
          {
            id: 'lookup',
            description: 'Look up a value',
            params: {},
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      })
    )

    expect(mockCreateToolStream).toHaveBeenCalledWith(
      expect.objectContaining({
        providerName: 'Prism',
        preserveAssistantReasoning: true,
        basePayload: expect.objectContaining({
          model: 'prism/deepseek-v4.1-flash',
          tool_choice: 'auto',
        }),
      })
    )
    expect(result).toMatchObject({ toolResults: [{ value: 'result' }] })
    expect(mockCalculateCost).toHaveBeenCalledWith('prism/deepseek-v4.1-flash', 10, 5)
    expect(result.cost).toEqual({
      input: 0.000003,
      output: 0.000006,
      toolCost: 0.25,
      total: 0.250009,
      pricing: {
        input: 0.3,
        cachedInput: 0.07,
        output: 1.2,
        updatedAt: '2026-09-12',
      },
    })
  })

  it.each(['none', 'low', 'medium', 'high'])('sends Prism reasoning effort %s', async (value) => {
    await prismProvider.executeRequest(request({ reasoningEffort: value }))
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning_effort: value }),
      undefined
    )
  })

  it.each([undefined, 'auto'])('omits Prism reasoning effort %s', async (value) => {
    await prismProvider.executeRequest(request({ reasoningEffort: value }))
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ reasoning_effort: expect.anything() }),
      undefined
    )
  })

  it('rejects reasoning effort values unsupported by Prism', async () => {
    await expect(
      prismProvider.executeRequest(request({ reasoningEffort: 'xhigh' }))
    ).rejects.toThrow('Unsupported Prism reasoning effort: xhigh')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('requires a Prism API key', async () => {
    await expect(prismProvider.executeRequest(request({ apiKey: undefined }))).rejects.toThrow(
      'API key is required for Prism'
    )
  })
})
