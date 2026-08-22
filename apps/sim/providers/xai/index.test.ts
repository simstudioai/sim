/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreate, mockExecuteProviderTool } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExecuteProviderTool: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 20 }))

vi.mock('@/providers/runtime-context', () => ({
  executeProviderTool: mockExecuteProviderTool,
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

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
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
  checkForForcedToolUsageOpenAI: vi.fn(() => ({
    hasUsedForcedTool: false,
    usedForcedTools: [],
  })),
}))

import type { StreamingExecution } from '@/executor/types'
import type { ProviderRequest, ProviderResponse, ProviderToolConfig } from '@/providers/types'
import { xAIProvider } from '@/providers/xai'

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
    vi.clearAllMocks()
    mockCreate.mockResolvedValue(chat({ content: 'hello' }))
    mockExecuteProviderTool.mockResolvedValue({
      rawResponse: { success: true, output: { ok: true } },
      modelResponse: { success: true, output: { ok: true } },
    })
  })

  it('maps temperature and max_completion_tokens', async () => {
    await run({ temperature: 0.5, maxTokens: 256 })

    const payload = firstPayload()
    expect(payload.model).toBe('grok-4.6')
    expect(payload.temperature).toBe(0.5)
    expect(payload.max_completion_tokens).toBe(256)
  })

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
