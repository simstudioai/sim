import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersAttachmentsMock } from '@sim/testing/mocks/providers-attachments.mock'
import { providersModelsMock } from '@sim/testing/mocks/providers-models.mock'
import { providersTraceEnrichmentMock } from '@sim/testing/mocks/providers-trace-enrichment.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICompatStreamingToolLoopStream } from '@/providers/openai-compat/streaming-tool-loop'
import type { ProviderRequest } from '@/providers/types'

vi.mock('openai', () => openaiMock)

vi.mock('@/providers', () => providersMock)

vi.mock('@/providers/models', () => providersModelsMock)

vi.mock('@/providers/attachments', () => providersAttachmentsMock)

vi.mock('@/providers/deepseek/utils', () => ({
  createReadableStreamFromDeepseekStream: vi.fn(),
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

import { deepseekProvider } from '@/providers/deepseek/index'

providersMock.MAX_TOOL_ITERATIONS = 5

const mockCreate = openaiMockFns.mockChatCompletionsCreate
const mockPrepareToolsWithUsageControl = providersUtilsMockFns.mockPrepareToolsWithUsageControl
const mockExecuteTool = toolsMockFns.mockExecuteTool

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: 'deepseek-chat',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  }
}

describe('deepseekProvider thinking payload', () => {
  beforeEach(() => {
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

  it('sets thinking: { type: enabled } when thinkingLevel is enabled', async () => {
    await deepseekProvider.executeRequest(request({ thinkingLevel: 'enabled' }))
    expect(mockCreate).toHaveBeenCalled()
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.thinking).toEqual({ type: 'enabled' })
  })

  it('sets thinking: { type: disabled } when thinkingLevel is none (API default is enabled)', async () => {
    await deepseekProvider.executeRequest(request({ thinkingLevel: 'none' }))
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.thinking).toEqual({ type: 'disabled' })
  })

  it('omits thinking when thinkingLevel is unset', async () => {
    await deepseekProvider.executeRequest(request())
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.thinking).toBeUndefined()
  })

  it.each([
    ['low', 'low'],
    ['minimal', 'low'],
    ['medium', 'high'],
    ['xhigh', 'high'],
    ['max', 'max'],
  ] as const)('maps Flash reasoning effort %s to %s', async (reasoningEffort, expected) => {
    await deepseekProvider.executeRequest(request({ model: 'deepseek-flash', reasoningEffort }))
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      model: 'deepseek-flash',
      reasoning_effort: expected,
    })
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

    const result = (await deepseekProvider.executeRequest(
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
