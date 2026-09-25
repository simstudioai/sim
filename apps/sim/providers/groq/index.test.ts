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
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICompatStreamingToolLoopStream } from '@/providers/openai-compat/streaming-tool-loop'
import type { ProviderRequest } from '@/providers/types'

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}))

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)

vi.mock('groq-sdk', () => ({
  Groq: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))

vi.mock('@/providers', () => providersMock)

vi.mock('@/providers/models', () => providersModelsMock)

vi.mock('@/providers/attachments', () => providersAttachmentsMock)

vi.mock('@/providers/groq/utils', () => ({
  createReadableStreamFromGroqStream: vi.fn(),
}))

vi.mock('@/providers/openai-compat/streaming-tool-loop', () => ({
  createOpenAICompatStreamingToolLoopStream: vi.fn(),
}))

vi.mock('@/providers/streaming-execution', () => ({
  createStreamingExecution: vi.fn((args) => args),
}))

vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)

vi.mock('@/providers/utils', () => providersUtilsMock)

vi.mock('@/tools', () => toolsMock)

import { groqProvider } from '@/providers/groq/index'

providersMock.MAX_TOOL_ITERATIONS = 5
const mockCapture = providersConversationHistoryMockFns.mockCaptureProviderConversationStep
const mockRecordUsage = providersConversationHistoryMockFns.mockRecordProviderConversationUsage
const mockRecordError = providersConversationHistoryMockFns.mockRecordProviderConversationToolError

const mockExecuteTool = toolsMockFns.mockExecuteTool
const mockPrepareToolsWithUsageControl = providersUtilsMockFns.mockPrepareToolsWithUsageControl

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: 'groq/openai/gpt-oss-120b',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  }
}

describe('groqProvider reasoning payload', () => {
  beforeEach(() => {
    mockCapture.mockReset()
    mockRecordError.mockReset()
    mockCreate.mockReset()
    mockExecuteTool.mockReset()
    mockPrepareToolsWithUsageControl.mockReset()
    mockPrepareToolsWithUsageControl.mockReturnValue({
      tools: [],
      toolChoice: undefined,
      forcedTools: [],
      hasFilteredTools: false,
    })
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  })

  it('does not admit tool decisions beyond the iteration limit into continuation', async () => {
    mockPrepareToolsWithUsageControl.mockImplementation((tools) => ({
      tools,
      toolChoice: 'auto',
      forcedTools: [],
      hasFilteredTools: false,
    }))
    mockExecuteTool.mockResolvedValue({ success: true, output: {} })
    let generated = 0
    mockCreate.mockImplementation((payload) => {
      const final = false
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
    await groqProvider.executeRequest(
      request({
        tools: [
          {
            id: 'lookup',
            description: '',
            params: {},
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      })
    )
    expect(mockExecuteTool).toHaveBeenCalledTimes(5)
    expect(generated).toBe(6)
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      input: 5,
      output: 3,
      cacheRead: 0,
    })
    const capturedCalls = mockCapture.mock.calls.flatMap(
      ([, , message]) => message.tool_calls?.map((call: { id: string }) => call.id) ?? []
    )
    expect(capturedCalls).toEqual(Array.from({ length: 5 }, (_, index) => `call-${index + 1}`))
    expect(capturedCalls).not.toContain('call-6')
  })

  it('captures native calls before dispatch and captures the final answer', async () => {
    const assistant = {
      role: 'assistant',
      content: null,
      reasoning: 'look up the record',
      tool_calls: [
        { id: 'call-a', type: 'function', function: { name: 'lookup', arguments: '{}' } },
      ],
    }
    mockCreate.mockResolvedValueOnce({ choices: [{ message: assistant }] })
    mockExecuteTool.mockImplementation(async () => {
      expect(mockCapture).toHaveBeenCalledWith(
        expect.anything(),
        'chat-completions',
        assistant,
        undefined
      )
      return { success: true, output: { value: 'found' } }
    })
    await groqProvider.executeRequest(
      request({ tools: [{ id: 'lookup', name: 'Lookup', parameters: {} }] })
    )

    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect(mockCapture).toHaveBeenCalledTimes(2)
    expect(mockCapture).toHaveBeenLastCalledWith(
      expect.anything(),
      'chat-completions',
      {
        content: 'ok',
        tool_calls: [],
      },
      expect.anything()
    )
  })

  it('records malformed arguments as a terminal tool result without executing them', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'bad-call', type: 'function', function: { name: 'lookup', arguments: '{' } },
            ],
          },
        },
      ],
    })
    await groqProvider.executeRequest(
      request({ tools: [{ id: 'lookup', name: 'Lookup', parameters: {} }] })
    )
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(mockRecordError).toHaveBeenCalledWith(
      expect.anything(),
      'bad-call',
      'lookup',
      expect.any(String)
    )
  })

  it('GPT-OSS sets include_reasoning and reasoning_effort', async () => {
    await groqProvider.executeRequest(
      request({ model: 'groq/openai/gpt-oss-120b', reasoningEffort: 'high' })
    )
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.model).toBe('openai/gpt-oss-120b')
    expect(payload.include_reasoning).toBe(true)
    expect(payload.reasoning_effort).toBe('high')
    expect(payload.reasoning_format).toBeUndefined()
  })

  it('GPT-OSS sends no reasoning params when effort and thinking are unset (legacy request shape)', async () => {
    await groqProvider.executeRequest(request({ model: 'groq/openai/gpt-oss-20b' }))
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.include_reasoning).toBeUndefined()
    expect(payload.reasoning_effort).toBeUndefined()
  })

  it('GPT-OSS defaults reasoning_effort to medium when only a thinking level is set', async () => {
    await groqProvider.executeRequest(
      request({ model: 'groq/openai/gpt-oss-20b', thinkingLevel: 'enabled' })
    )
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.include_reasoning).toBe(true)
    expect(payload.reasoning_effort).toBe('medium')
  })

  it('Qwen sets reasoning_format parsed when thinking enabled', async () => {
    await groqProvider.executeRequest(
      request({
        model: 'groq/qwen/qwen3-32b',
        thinkingLevel: 'enabled',
      })
    )
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.reasoning_format).toBe('parsed')
    expect(payload.include_reasoning).toBeUndefined()
  })

  it('Qwen disables reasoning via reasoning_effort none when thinking is none', async () => {
    await groqProvider.executeRequest(
      request({
        model: 'groq/qwen/qwen3.6-27b',
        thinkingLevel: 'none',
      })
    )
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.reasoning_format).toBeUndefined()
    expect(payload.reasoning_effort).toBe('none')
  })

  it.each(['none', 'low', 'medium', 'high'] as const)(
    'Qwen 3.8 forwards explicit reasoning effort %s',
    async (reasoningEffort) => {
      await groqProvider.executeRequest(
        request({ model: 'groq/qwen/qwen3.8-27b', reasoningEffort })
      )
      const payload = mockCreate.mock.calls[0][0]
      expect(payload.reasoning_effort).toBe(reasoningEffort)
      expect(payload.reasoning_format).toBe(reasoningEffort === 'none' ? undefined : 'parsed')
    }
  )

  it('strips only the leading routing prefix and preserves custom model case', async () => {
    await groqProvider.executeRequest(request({ model: 'Groq/Custom/Model-A' }))
    expect(mockCreate.mock.calls[0][0].model).toBe('Custom/Model-A')
  })

  it('selects the live tool loop without a caller flag', async () => {
    mockPrepareToolsWithUsageControl.mockReturnValue({
      tools: [
        {
          type: 'function',
          function: { name: 'lookup', description: 'Lookup', parameters: {} },
        },
      ],
      toolChoice: 'auto',
      forcedTools: [],
      hasFilteredTools: false,
    })
    vi.mocked(createOpenAICompatStreamingToolLoopStream).mockReturnValue(
      new ReadableStream() as never
    )

    const result = (await groqProvider.executeRequest(
      request({
        stream: true,
        tools: [
          {
            id: 'lookup',
            name: 'lookup',
            description: 'Lookup',
            params: {},
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      })
    )) as unknown as {
      createStream: (handles: {
        output: { content?: string }
        finalizeTiming: () => void
      }) => ReadableStream<unknown>
    }

    const output: { content?: string } = {}
    result.createStream({ output, finalizeTiming: vi.fn() })

    expect(createOpenAICompatStreamingToolLoopStream).toHaveBeenCalledTimes(1)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
