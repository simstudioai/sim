import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersAttachmentsMock } from '@sim/testing/mocks/providers-attachments.mock'
import { providersConversationHistoryMock } from '@sim/testing/mocks/providers-conversation-history.mock'
import { providersTraceEnrichmentMock } from '@sim/testing/mocks/providers-trace-enrichment.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import type { ProviderResponse } from '@/providers/types'

vi.mock('openai', () => openaiMock)
vi.mock('@/providers', () => providersMock)
vi.mock('@/providers/attachments', () => providersAttachmentsMock)
vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)
vi.mock('@/tools', () => toolsMock)

import { xAIProvider } from '@/providers/xai'

const mockCreate = openaiMockFns.mockChatCompletionsCreate
const usage = (prompt: number, cached: number, answer: number, reasoning: number) => ({
  prompt_tokens: prompt,
  completion_tokens: answer,
  total_tokens: prompt + answer + reasoning,
  prompt_tokens_details: { cached_tokens: cached },
  completion_tokens_details: { reasoning_tokens: reasoning },
})
const reply = (tokens: ReturnType<typeof usage>, callTool = false) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: callTool ? null : 'done',
        ...(callTool
          ? {
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
              ],
            }
          : {}),
      },
    },
  ],
  usage: tokens,
})

async function settled(result: ProviderResponse | ReadableStream | StreamingExecution) {
  if ('stream' in result) {
    const reader = result.stream.getReader()
    while (!(await reader.read()).done) {}
    return result.execution.output
  }
  if ('content' in result) return result
  throw new Error('Expected a provider response')
}

describe('xAI provider billing at the SDK boundary', () => {
  beforeEach(() => {
    toolsMockFns.mockExecuteTool.mockResolvedValue({ success: true, output: { ok: true } })
  })

  it.each([false, true])(
    'prices separate reasoning and cached prompt tokens (streaming: %s)',
    async (stream) => {
      const tokens = usage(1269, 1152, 5, 88)
      async function* chunks() {
        yield { choices: [{ delta: { content: 'done' }, index: 0 }] }
        yield { choices: [], usage: tokens }
      }
      mockCreate.mockResolvedValueOnce(stream ? chunks() : reply(tokens))
      const output = await settled(
        await xAIProvider.executeRequest({
          model: 'grok-4.7',
          apiKey: 'key',
          messages: [{ role: 'user', content: 'Hi' }],
          stream,
        })
      )
      expect(output.tokens).toMatchObject({ input: 117, cacheRead: 1152, output: 93, total: 1362 })
      expect(output.cost).toMatchObject({ input: 0.00081, output: 0.000558, total: 0.001368 })
    }
  )

  it.each([false, true])(
    'prices each below-threshold tool prompt separately (streaming: %s)',
    async (stream) => {
      const tokens = usage(130000, 100000, 2, 8)
      mockCreate.mockResolvedValueOnce(reply(tokens, true)).mockResolvedValueOnce(reply(tokens))
      const output = await settled(
        await xAIProvider.executeRequest({
          model: 'grok-4.7',
          apiKey: 'key',
          messages: [{ role: 'user', content: 'Use a tool' }],
          tools: [
            {
              id: 'lookup',
              name: 'lookup',
              description: '',
              params: {},
              parameters: { type: 'object', properties: {}, required: [] },
            },
          ],
          stream,
        })
      )
      expect(output.tokens).toMatchObject({
        input: 60000,
        cacheRead: 200000,
        output: 20,
        total: 260020,
      })
      expect(output.cost).toMatchObject({ input: 0.22, output: 0.00012, total: 0.22012 })
    }
  )

  it.each([false, true])(
    'applies the inclusive long-context boundary using cache-inclusive prompts (streaming: %s)',
    async (stream) => {
      mockCreate
        .mockResolvedValueOnce(reply(usage(199999, 0, 5, 5), true))
        .mockResolvedValueOnce(reply(usage(200000, 100000, 5, 5)))
      const output = await settled(
        await xAIProvider.executeRequest({
          model: 'grok-4.7',
          apiKey: 'key',
          messages: [{ role: 'user', content: 'Use a tool' }],
          tools: [
            {
              id: 'lookup',
              name: 'lookup',
              description: '',
              params: {},
              parameters: { type: 'object', properties: {}, required: [] },
            },
          ],
          stream,
        })
      )
      expect(output.cost).toMatchObject({ input: 0.899998, output: 0.00018, total: 0.900178 })
    }
  )

  it.each([false, true])(
    'includes final synthesis usage after the tool cap (streaming: %s)',
    async (stream) => {
      const previousLimit = providersMock.MAX_TOOL_ITERATIONS
      providersMock.MAX_TOOL_ITERATIONS = 1
      try {
        const tokens = usage(1269, 1152, 5, 88)
        mockCreate
          .mockResolvedValueOnce(reply(tokens, true))
          .mockResolvedValueOnce(reply(tokens, true))
          .mockResolvedValueOnce(reply(tokens))
        const output = await settled(
          await xAIProvider.executeRequest({
            model: 'grok-4.7',
            apiKey: 'key',
            messages: [{ role: 'user', content: 'Use a tool' }],
            tools: [
              {
                id: 'lookup',
                name: 'lookup',
                description: '',
                params: {},
                parameters: { type: 'object', properties: {}, required: [] },
              },
            ],
            stream,
          })
        )
        expect(output.tokens).toMatchObject({
          input: 351,
          cacheRead: 3456,
          output: 279,
          total: 4086,
        })
        expect(output.cost).toMatchObject({ total: 0.004104 })
      } finally {
        providersMock.MAX_TOOL_ITERATIONS = previousLimit
      }
    }
  )
})
