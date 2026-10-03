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
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteProviderTool } = vi.hoisted(() => ({
  mockExecuteProviderTool: vi.fn(),
}))

vi.mock('openai', () => openaiMock)

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)

vi.mock('@/providers', () => providersMock)

vi.mock('@/providers/runtime-context', () => ({
  getProviderRuntimeContext: () => undefined,
  executeProviderTool: mockExecuteProviderTool,
}))

vi.mock('@/providers/models', () => providersModelsMock)

vi.mock('@/providers/attachments', () => providersAttachmentsMock)

vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)

vi.mock('@/providers/transport', () => ({ openAICompatTransport: () => ({}) }))

vi.mock('@/providers/tool-schema-adapter', () => ({
  adaptOpenAIChatToolSchema: (tool: { id: string }) => ({
    type: 'function',
    function: { name: tool.id, parameters: {} },
  }),
}))

vi.mock('@/providers/openai-compat/assistant-history', () => ({
  createOpenAICompatAssistantHistory: () => ({ role: 'assistant', content: '' }),
}))

vi.mock('@/providers/openai-compat/stream-events', () => ({
  createOpenAICompatibleAgentEventStream: () => new ReadableStream({ start: (c) => c.close() }),
}))

vi.mock('@/providers/stream-events', () => ({
  createSettledAgentEventStream: () => new ReadableStream({ start: (c) => c.close() }),
}))

vi.mock('@/providers/streaming-execution', () => ({
  createStreamingExecution: vi.fn(() => ({ stream: null, execution: null })),
}))

vi.mock('@/providers/utils', () => providersUtilsMock)

import type { StreamingExecution } from '@/executor/types'
import type { ProviderRequest, ProviderResponse, ProviderToolConfig } from '@/providers/types'
import { xAIProvider } from '@/providers/xai'

const mockCreate = openaiMockFns.mockChatCompletionsCreate
const mockCapture = providersConversationHistoryMockFns.mockCaptureProviderConversationStep
const mockRecordUsage = providersConversationHistoryMockFns.mockRecordProviderConversationUsage

providersUtilsMockFns.mockPrepareToolsWithUsageControl.mockImplementation((tools) => ({
  tools,
  toolChoice: 'auto',
  forcedTools: [],
  hasFilteredTools: false,
}))

interface ChatOptions {
  content?: string | null
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>
}

function chat({ content = null, toolCalls }: ChatOptions = {}) {
  return {
    choices: [
      {
        message: { content, tool_calls: toolCalls },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  }
}

function tool(name: string): ProviderToolConfig {
  return {
    id: name,
    name,
    description: 'd',
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

function run(
  request: Partial<ProviderRequest> = {}
): Promise<ProviderResponse | StreamingExecution> {
  return xAIProvider.executeRequest!({
    model: 'grok-4.6',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'Hi' }],
    ...request,
  })
}

const firstPayload = () => mockCreate.mock.calls[0][0]
const lastPayload = () => mockCreate.mock.calls.at(-1)![0]

describe('xAIProvider.executeRequest', () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue(chat({ content: 'hello' }))
    mockExecuteProviderTool.mockResolvedValue({
      rawResponse: { success: true, output: { ok: true } },
      modelResponse: { success: true, output: { ok: true } },
    })
  })

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
      const result = run({ tools: [tool('lookup')] })
      if (failsSynthesis) await expect(result).rejects.toThrow('synthesis failed')
      else
        await expect(result).resolves.toMatchObject({
          tokens: { input: 110, output: 66, total: 176 },
        })
      expect(mockExecuteProviderTool).toHaveBeenCalledTimes(20)
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

  it('forwards reasoning_effort only when set to a non-default value', async () => {
    await run({ reasoningEffort: 'xhigh' })
    expect(firstPayload().reasoning_effort).toBe('xhigh')

    mockCreate.mockClear()
    await run({ reasoningEffort: 'auto' })
    expect(firstPayload().reasoning_effort).toBeUndefined()

    mockCreate.mockClear()
    await run({})
    expect(firstPayload().reasoning_effort).toBeUndefined()
  })

  it('keeps reasoning_effort on every follow-up call in the tool loop', async () => {
    mockCreate
      .mockResolvedValueOnce(
        chat({ toolCalls: [{ id: 'c1', function: { name: 'known', arguments: '{"q":1}' } }] })
      )
      .mockResolvedValueOnce(chat({ content: 'done' }))

    await run({ tools: [tool('known')], reasoningEffort: 'high' })

    expect(mockCreate.mock.calls.length).toBeGreaterThan(1)
    for (const [payload] of mockCreate.mock.calls) {
      expect(payload.reasoning_effort).toBe('high')
    }
  })

  it('keeps reasoning_effort on the response_format request', async () => {
    await run({
      reasoningEffort: 'low',
      responseFormat: { name: 'r', schema: { type: 'object', properties: {} } },
    })

    const payload = lastPayload()
    expect(payload.response_format.type).toBe('json_schema')
    expect(payload.reasoning_effort).toBe('low')
  })

  it('keeps reasoning_effort on the direct streaming request', async () => {
    await run({ reasoningEffort: 'medium', stream: true })

    const payload = firstPayload()
    expect(payload.stream).toBe(true)
    expect(payload.reasoning_effort).toBe('medium')
  })
})
