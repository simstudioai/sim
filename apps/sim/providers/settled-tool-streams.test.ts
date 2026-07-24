/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import { basetenProvider } from '@/providers/baseten/index'
import { cerebrasProvider } from '@/providers/cerebras'
import { fireworksProvider } from '@/providers/fireworks/index'
import { kimiProvider } from '@/providers/kimi'
import { metaProvider } from '@/providers/meta'
import { nvidiaProvider } from '@/providers/nvidia'
import { openRouterProvider } from '@/providers/openrouter/index'
import { sakanaProvider } from '@/providers/sakana'
import { togetherProvider } from '@/providers/together/index'
import type { ProviderConfig, ProviderResponse, ProviderToolConfig } from '@/providers/types'
import { xAIProvider } from '@/providers/xai'
import { zaiProvider } from '@/providers/zai'

const { mockCreate, mockExecuteTool } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExecuteTool: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))

vi.mock('@cerebras/cerebras_cloud_sdk', () => ({
  Cerebras: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 1 }))

vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: vi.fn((messages) => messages),
}))

vi.mock('@/providers/models', () => ({
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getModelCapabilities: vi.fn(),
  getProviderModels: vi.fn((provider: string) => [`${provider}/test-model`]),
  getProviderDefaultModel: vi.fn((provider: string) => `${provider}/test-model`),
}))

vi.mock('@/providers/tool-schema-adapter', () => ({
  adaptOpenAIChatToolSchema: vi.fn((tool: ProviderToolConfig) => ({
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description,
      parameters: tool.parameters,
    },
  })),
}))

vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn(() => ({ input: 1, output: 2, total: 3 })),
  enforceStrictSchema: vi.fn((schema) => schema),
  generateSchemaInstructions: vi.fn(() => 'SCHEMA_INSTRUCTIONS'),
  prepareToolExecution: vi.fn((_tool, args) => ({
    toolParams: args,
    executionParams: args,
  })),
  prepareToolsWithUsageControl: vi.fn(() => ({
    tools: [{ type: 'function', function: { name: 'lookup' } }],
    toolChoice: 'auto',
    forcedTools: [],
    hasFilteredTools: false,
  })),
  sumToolCosts: vi.fn(() => 4),
  trackForcedToolUsage: vi.fn(() => ({
    hasUsedForcedTool: false,
    usedForcedTools: [],
  })),
}))

vi.mock('@/providers/baseten/utils', () => ({
  checkForForcedToolUsage: vi.fn(() => ({
    hasUsedForcedTool: false,
    usedForcedTools: [],
  })),
  createReadableStreamFromOpenAIStream: vi.fn(() => createEmptyStream()),
  supportsNativeStructuredOutputs: vi.fn(() => true),
}))
vi.mock('@/providers/fireworks/utils', () => ({
  checkForForcedToolUsage: vi.fn(() => ({
    hasUsedForcedTool: false,
    usedForcedTools: [],
  })),
  createReadableStreamFromOpenAIStream: vi.fn(() => createEmptyStream()),
  supportsNativeStructuredOutputs: vi.fn(() => true),
}))
vi.mock('@/providers/openrouter/utils', () => ({
  checkForForcedToolUsage: vi.fn(() => ({
    hasUsedForcedTool: false,
    usedForcedTools: [],
  })),
  createReadableStreamFromOpenAIStream: vi.fn(() => createEmptyStream()),
  supportsNativeStructuredOutputs: vi.fn(() => true),
}))
vi.mock('@/providers/together/utils', () => ({
  checkForForcedToolUsage: vi.fn(() => ({
    hasUsedForcedTool: false,
    usedForcedTools: [],
  })),
  createReadableStreamFromOpenAIStream: vi.fn(() => createEmptyStream()),
  supportsNativeStructuredOutputs: vi.fn(() => true),
}))
vi.mock('@/providers/cerebras/utils', () => ({
  createReadableStreamFromCerebrasStream: vi.fn(() => createEmptyStream()),
}))
vi.mock('@/providers/kimi/utils', () => ({
  createReadableStreamFromKimiStream: vi.fn(() => createEmptyStream()),
}))
vi.mock('@/providers/meta/utils', () => ({
  createReadableStreamFromMetaStream: vi.fn(() => createEmptyStream()),
}))
vi.mock('@/providers/nvidia/utils', () => ({
  createReadableStreamFromNvidiaStream: vi.fn(() => createEmptyStream()),
}))
vi.mock('@/providers/sakana/utils', () => ({
  createReadableStreamFromSakanaStream: vi.fn(() => createEmptyStream()),
}))
vi.mock('@/providers/zai/utils', () => ({
  createReadableStreamFromZaiStream: vi.fn(() => createEmptyStream()),
}))
vi.mock('@/providers/xai/utils', () => ({
  checkForForcedToolUsage: vi.fn(() => ({
    hasUsedForcedTool: false,
    usedForcedTools: [],
  })),
  createReadableStreamFromXAIStream: vi.fn(() => createEmptyStream()),
  createResponseFormatPayload: vi.fn(() => ({})),
}))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const TOOL: ProviderToolConfig = {
  id: 'lookup',
  name: 'lookup',
  description: 'Looks up a value',
  params: {},
  parameters: { type: 'object', properties: {}, required: [] },
}

const PROVIDERS = [
  { name: 'Cerebras', provider: cerebrasProvider, model: 'cerebras/test-model' },
  { name: 'Z.ai', provider: zaiProvider, model: 'zai/test-model' },
  { name: 'Sakana', provider: sakanaProvider, model: 'sakana/test-model' },
  { name: 'Kimi', provider: kimiProvider, model: 'kimi/test-model' },
  { name: 'Meta', provider: metaProvider, model: 'meta/test-model' },
  { name: 'NVIDIA', provider: nvidiaProvider, model: 'nvidia/test-model' },
  { name: 'xAI', provider: xAIProvider, model: 'xai/test-model' },
] as const

const REASONING_HISTORY_PROVIDERS = [
  {
    name: 'Cerebras',
    provider: cerebrasProvider,
    model: 'cerebras/test-model',
    field: 'reasoning',
  },
  {
    name: 'Kimi',
    provider: kimiProvider,
    model: 'kimi/test-model',
    field: 'reasoning_content',
  },
  {
    name: 'NVIDIA',
    provider: nvidiaProvider,
    model: 'nvidia/test-model',
    field: 'reasoning_content',
  },
  {
    name: 'xAI',
    provider: xAIProvider,
    model: 'xai/test-model',
    field: 'reasoning_content',
  },
  {
    name: 'Z.ai',
    provider: zaiProvider,
    model: 'zai/test-model',
    field: 'reasoning_content',
  },
] as const

const CAPPED_PROVIDERS = [
  {
    name: 'Cerebras',
    provider: cerebrasProvider,
    model: 'cerebras/test-model',
    disablesTools: 'none',
  },
  { name: 'Z.ai', provider: zaiProvider, model: 'zai/test-model', disablesTools: 'omit' },
  {
    name: 'Sakana',
    provider: sakanaProvider,
    model: 'sakana/test-model',
    disablesTools: 'none',
  },
  { name: 'Kimi', provider: kimiProvider, model: 'kimi/test-model', disablesTools: 'omit' },
  { name: 'Meta', provider: metaProvider, model: 'meta/test-model', disablesTools: 'omit' },
  {
    name: 'NVIDIA',
    provider: nvidiaProvider,
    model: 'nvidia/test-model',
    disablesTools: 'none',
  },
] as const

const STRUCTURED_OUTPUT_PROVIDERS = [
  {
    name: 'Baseten',
    provider: basetenProvider,
    model: 'baseten/test-model',
    responseFormatType: 'json_schema',
    disablesTools: 'omit',
  },
  {
    name: 'Fireworks',
    provider: fireworksProvider,
    model: 'fireworks/test-model',
    responseFormatType: 'json_schema',
    disablesTools: 'omit',
  },
  {
    name: 'OpenRouter',
    provider: openRouterProvider,
    model: 'openrouter/test-model',
    responseFormatType: 'json_schema',
    disablesTools: 'omit',
  },
  {
    name: 'Together',
    provider: togetherProvider,
    model: 'together/test-model',
    responseFormatType: 'json_schema',
    disablesTools: 'omit',
  },
  {
    name: 'Meta',
    provider: metaProvider,
    model: 'meta/test-model',
    responseFormatType: 'json_schema',
    disablesTools: 'omit',
  },
  {
    name: 'NVIDIA',
    provider: nvidiaProvider,
    model: 'nvidia/test-model',
    responseFormatType: 'json_schema',
    disablesTools: 'none',
  },
  {
    name: 'Sakana',
    provider: sakanaProvider,
    model: 'sakana/test-model',
    responseFormatType: 'json_schema',
    disablesTools: 'none',
  },
  {
    name: 'Z.ai',
    provider: zaiProvider,
    model: 'zai/test-model',
    responseFormatType: 'json_object',
    disablesTools: 'omit',
  },
] as const

function createEmptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

function toolCall(id: string, argumentsJson = '{}'): ToolCall {
  return {
    id,
    type: 'function',
    function: { name: 'lookup', arguments: argumentsJson },
  }
}

function response(
  content: string | null,
  toolCalls?: ToolCall[],
  reasoning?: { reasoning?: string; reasoning_content?: string }
) {
  return {
    choices: [{ message: { content, tool_calls: toolCalls, ...reasoning } }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  }
}

async function executeStreamingRequest(
  provider: ProviderConfig,
  model: string
): Promise<ProviderResponse | StreamingExecution> {
  return provider.executeRequest({
    apiKey: 'test-key',
    model,
    messages: [{ role: 'user', content: 'Use the lookup tool' }],
    tools: [TOOL],
    stream: true,
  })
}

async function executeStreamingStructuredRequest(
  provider: ProviderConfig,
  model: string
): Promise<ProviderResponse | StreamingExecution> {
  return provider.executeRequest({
    apiKey: 'test-key',
    model,
    messages: [{ role: 'user', content: 'Use the lookup tool' }],
    tools: [TOOL],
    responseFormat: {
      name: 'lookup_result',
      schema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
      strict: true,
    },
    stream: true,
  })
}

async function readSettledEvents(result: ProviderResponse | StreamingExecution) {
  if (!('stream' in result)) {
    throw new Error('Expected a streaming execution')
  }

  const events: unknown[] = []
  const reader = result.stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }
  return { events, result }
}

function expectModelIterations(result: StreamingExecution, expectedIterations: number) {
  const timing = result.execution.output.providerTiming
  expect(timing?.iterations).toBe(expectedIterations)
  expect(timing?.timeSegments?.filter((segment) => segment.type === 'model')).toHaveLength(
    expectedIterations
  )
}

describe('settled provider tool streams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockReset()
    mockExecuteTool.mockReset()
    mockExecuteTool.mockResolvedValue({ success: true, output: { value: 'found' } })
  })

  it.each(PROVIDERS)(
    '$name projects the existing final answer without another provider call',
    async ({ provider, model }) => {
      mockCreate
        .mockResolvedValueOnce(response(null, [toolCall('call-1')]))
        .mockResolvedValueOnce(response('final answer'))

      const { events, result } = await readSettledEvents(
        await executeStreamingRequest(provider, model)
      )

      expect(mockCreate).toHaveBeenCalledTimes(2)
      expect(mockCreate.mock.calls.some(([payload]) => payload.stream === true)).toBe(false)
      expect(result.streamFormat).toBe('agent-events-v1')
      expect(events).toEqual([{ type: 'text_delta', text: 'final answer', turn: 'final' }])
      expect(result.execution.output).toMatchObject({
        content: 'final answer',
        tokens: { input: 10, output: 6, total: 16 },
        cost: { input: 1, output: 2, toolCost: 4, total: 7 },
        toolCalls: { count: 1 },
      })
      expectModelIterations(result, 2)
    }
  )

  it.each(STRUCTURED_OUTPUT_PROVIDERS)(
    '$name performs deferred structured extraction before projecting a settled stream',
    async ({ provider, model, responseFormatType, disablesTools }) => {
      mockCreate
        .mockResolvedValueOnce(response(null, [toolCall('call-1')]))
        .mockResolvedValueOnce(response('intermediate answer'))
        .mockResolvedValueOnce(response('{"value":"found"}'))

      const { events, result } = await readSettledEvents(
        await executeStreamingStructuredRequest(provider, model)
      )

      expect(mockCreate).toHaveBeenCalledTimes(3)
      expect(mockCreate.mock.calls[0][0].response_format).toBeUndefined()
      const finalPayload = mockCreate.mock.calls[2][0]
      expect(finalPayload.response_format).toMatchObject({ type: responseFormatType })
      if (disablesTools === 'none') {
        expect(finalPayload.tool_choice).toBe('none')
      } else {
        expect(finalPayload.tools).toBeUndefined()
        expect(finalPayload.tool_choice).toBeUndefined()
      }
      expect(events).toEqual([{ type: 'text_delta', text: '{"value":"found"}', turn: 'final' }])
      expect(result.execution.output).toMatchObject({
        content: '{"value":"found"}',
        tokens: { input: 15, output: 9, total: 24 },
        cost: { input: 1, output: 2, toolCost: 4, total: 7 },
        toolCalls: { count: 1 },
      })
      expectModelIterations(result, 3)
    }
  )

  it.each(STRUCTURED_OUTPUT_PROVIDERS)(
    '$name makes only one schema-bearing final call when the tool loop reaches its cap',
    async ({ provider, model, responseFormatType }) => {
      mockCreate
        .mockResolvedValueOnce(response(null, [toolCall('call-1')]))
        .mockResolvedValueOnce(response(null, [toolCall('call-2')]))
        .mockResolvedValueOnce(response('{"value":"capped"}'))

      const { events, result } = await readSettledEvents(
        await executeStreamingStructuredRequest(provider, model)
      )

      expect(mockCreate).toHaveBeenCalledTimes(3)
      expect(mockCreate.mock.calls[2][0].response_format).toMatchObject({
        type: responseFormatType,
      })
      expect(events).toEqual([{ type: 'text_delta', text: '{"value":"capped"}', turn: 'final' }])
      expect(result.execution.output).toMatchObject({
        content: '{"value":"capped"}',
        tokens: { input: 15, output: 9, total: 24 },
        cost: { input: 1, output: 2, toolCost: 4, total: 7 },
      })
      expectModelIterations(result, 3)
    }
  )

  it.each(REASONING_HISTORY_PROVIDERS)(
    '$name preserves the complete reasoning-bearing assistant tool turn',
    async ({ provider, model, field }) => {
      mockCreate
        .mockResolvedValueOnce(
          response('I need the lookup result.', [toolCall('call-1')], {
            [field]: 'provider reasoning',
          })
        )
        .mockResolvedValueOnce(response('final answer'))

      await provider.executeRequest({
        apiKey: 'test-key',
        model,
        messages: [{ role: 'user', content: 'Use the lookup tool' }],
        tools: [TOOL],
      })

      const secondPayload = mockCreate.mock.calls[1][0] as {
        messages: Array<Record<string, unknown>>
      }
      const assistant = secondPayload.messages.find((message) => message.role === 'assistant')
      expect(assistant).toEqual({
        role: 'assistant',
        content: 'I need the lookup result.',
        tool_calls: [toolCall('call-1')],
        [field]: 'provider reasoning',
      })
    }
  )

  it.each(PROVIDERS)(
    '$name rejects tool AbortError instead of replaying it as a result',
    async ({ provider, model }) => {
      mockCreate.mockResolvedValueOnce(response(null, [toolCall('call-1')]))
      mockExecuteTool.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))

      await expect(executeStreamingRequest(provider, model)).rejects.toMatchObject({
        name: 'AbortError',
      })
      expect(mockCreate).toHaveBeenCalledTimes(1)
    }
  )

  it.each(PROVIDERS)(
    '$name does not execute malformed tool arguments',
    async ({ provider, model }) => {
      mockCreate
        .mockResolvedValueOnce(response(null, [toolCall('call-1', '{"query":')]))
        .mockResolvedValueOnce(response('recovered'))

      await executeStreamingRequest(provider, model)

      expect(mockExecuteTool).not.toHaveBeenCalled()
      expect(mockCreate).toHaveBeenCalledTimes(2)
    }
  )

  it.each(PROVIDERS)(
    '$name replays a successful false output as a valid tool result',
    async ({ provider, model }) => {
      mockCreate
        .mockResolvedValueOnce(response(null, [toolCall('call-1')]))
        .mockResolvedValueOnce(response('final answer'))
      mockExecuteTool.mockResolvedValueOnce({ success: true, output: false })

      await executeStreamingRequest(provider, model)

      const secondPayload = mockCreate.mock.calls[1][0] as {
        messages: Array<{ role: string; content?: string }>
      }
      expect(secondPayload.messages).toContainEqual(
        expect.objectContaining({ role: 'tool', content: 'false' })
      )
    }
  )

  it.each(CAPPED_PROVIDERS)(
    '$name uses one tool-disabled synthesis when the iteration cap ends on a tool call',
    async ({ provider, model, disablesTools }) => {
      mockCreate
        .mockResolvedValueOnce(response(null, [toolCall('call-1')]))
        .mockResolvedValueOnce(response(null, [toolCall('call-2')]))
        .mockResolvedValueOnce(response('cap synthesis'))

      const { events, result } = await readSettledEvents(
        await executeStreamingRequest(provider, model)
      )

      expect(mockCreate).toHaveBeenCalledTimes(3)
      const finalPayload = mockCreate.mock.calls[2][0]
      expect(finalPayload.stream).toBeUndefined()
      if (disablesTools === 'none') {
        expect(finalPayload.tool_choice).toBe('none')
      } else {
        expect(finalPayload.tools).toBeUndefined()
        expect(finalPayload.tool_choice).toBeUndefined()
      }
      expect(events).toEqual([{ type: 'text_delta', text: 'cap synthesis', turn: 'final' }])
      expectModelIterations(result, 3)
    }
  )
})
