import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersAttachmentsMock } from '@sim/testing/mocks/providers-attachments.mock'
import { providersTraceEnrichmentMock } from '@sim/testing/mocks/providers-trace-enrichment.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '@/providers/types'

vi.mock('openai', () => openaiMock)

vi.mock('@cerebras/cerebras_cloud_sdk', () => ({
  Cerebras: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: openaiMockFns.mockChatCompletionsCreate } }
    }
  ),
}))

vi.mock('@/providers', () => providersMock)
vi.mock('@/providers/attachments', () => providersAttachmentsMock)
vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)
vi.mock('@/providers/runtime-context', () => ({
  getProviderRuntimeContext: () => undefined,
  executeProviderTool: vi.fn().mockResolvedValue({
    rawResponse: { success: true, output: { result: 'found' } },
    modelResponse: { success: true, output: { result: 'found' } },
  }),
}))

import { cerebrasProvider } from '@/providers/cerebras'
import { kimiProvider } from '@/providers/kimi'

const mockCreate = openaiMockFns.mockChatCompletionsCreate
providersMock.MAX_TOOL_ITERATIONS = 3

function request(model: string, overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model,
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  }
}

describe('specialist provider reasoning parameters', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  })

  it.each(['none', 'low', 'medium', 'high'] as const)(
    'Cerebras forwards Qwen 3.8 effort %s',
    async (reasoningEffort) => {
      await cerebrasProvider.executeRequest(
        request('cerebras/qwen-3.8-27b', { reasoningEffort, maxTokens: 40960 })
      )
      expect(mockCreate.mock.calls[0][0]).toMatchObject({
        model: 'qwen-3.8-27b',
        reasoning_effort: reasoningEffort,
        max_completion_tokens: 40960,
      })
    }
  )

  it.each(['low', 'high', 'max'] as const)(
    'Kimi K3 forwards effort %s',
    async (reasoningEffort) => {
      await kimiProvider.executeRequest(request('kimi-k3', { reasoningEffort, temperature: 0.2 }))
      const payload = mockCreate.mock.calls[0][0]
      expect(payload.reasoning_effort).toBe(reasoningEffort)
      expect(payload.temperature).toBeUndefined()
      expect(payload.thinking).toBeUndefined()
    }
  )

  it.each([
    { provider: cerebrasProvider, model: 'cerebras/qwen-3.8-27b' },
    { provider: kimiProvider, model: 'kimi-k3' },
  ])('preserves the server default for $model', async ({ provider, model }) => {
    await provider.executeRequest(request(model, { reasoningEffort: 'auto' }))
    expect(mockCreate.mock.calls[0][0].reasoning_effort).toBeUndefined()
  })

  it('preserves custom Cerebras identifiers while removing only the leading prefix', async () => {
    await cerebrasProvider.executeRequest(request('Cerebras/Organization/Model-A'))
    expect(mockCreate.mock.calls[0][0].model).toBe('Organization/Model-A')
  })

  it('K3 requires each forced tool, then restores all tools with automatic choice', async () => {
    for (const name of ['search', 'lookup']) {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              reasoning_content: `Use ${name}`,
              tool_calls: [
                { id: `call-${name}`, type: 'function', function: { name, arguments: '{}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    }
    await kimiProvider.executeRequest(
      request('kimi-k3', {
        tools: ['search', 'lookup', 'optional'].map((id) => ({
          id,
          name: id,
          description: id,
          params: {},
          parameters: { type: 'object', properties: {} },
          usageControl: id === 'optional' ? 'auto' : 'force',
        })),
      })
    )
    const payloads = mockCreate.mock.calls.map(([payload]) => payload)
    expect(payloads).toHaveLength(3)
    expect(payloads[0].tool_choice).toBe('required')
    expect(
      payloads[0].tools.map((tool: { function: { name: string } }) => tool.function.name)
    ).toEqual(['search'])
    expect(payloads[1].tool_choice).toBe('required')
    expect(
      payloads[1].tools.map((tool: { function: { name: string } }) => tool.function.name)
    ).toEqual(['lookup'])
    expect(payloads[2].tool_choice).toBe('auto')
    expect(payloads[2].tools).toHaveLength(3)
    expect(payloads[1].messages).toContainEqual(
      expect.objectContaining({ reasoning_content: 'Use search' })
    )
  })

  it.each(['kimi-k2.7-code', 'kimi-k2.7-code-highspeed'])(
    '%s keeps automatic tool choice when forced selection is unsupported',
    async (model) => {
      await kimiProvider.executeRequest(
        request(model, {
          tools: [
            {
              id: 'lookup',
              description: 'Lookup',
              params: {},
              parameters: {},
              usageControl: 'force',
            },
          ],
        })
      )
      expect(mockCreate.mock.calls[0][0].tool_choice).toBe('auto')
      expect(mockCreate.mock.calls[0][0].thinking).toBeUndefined()
    }
  )
})
