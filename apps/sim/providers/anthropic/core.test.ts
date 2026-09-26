import type Anthropic from '@anthropic-ai/sdk'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import { buildThinkingConfig, executeAnthropicProviderRequest } from '@/providers/anthropic/core'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'
import { describeModelLevel } from '@/providers/utils'

const mockExecuteTool = toolsMockFns.mockExecuteTool

vi.mock('@/tools', () => toolsMock)

describe('executeAnthropicProviderRequest request identity and usage', () => {
  beforeEach(() => {
    mockExecuteTool.mockReset()
  })

  it('keeps registry identity while sending the resolved wire model and aggregating cache usage', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'msg-test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'Done' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_creation: null,
        output_tokens: 40,
      },
    })

    const result = (await executeAnthropicProviderRequest(
      {
        model: 'azure-anthropic/claude-sonnet-4-5',
        apiKey: 'test-key',
        maxTokens: 1024,
        messages: [{ role: 'system', content: 'Remain concise.' }],
      },
      {
        providerId: 'azure-anthropic',
        providerLabel: 'Azure Anthropic',
        resolveWireModel: () => 'claude-sonnet-4-5',
        createClient: () => ({ messages: { create } }) as never,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      }
    )) as ProviderResponse

    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'claude-sonnet-4-5',
      // System is always block-shaped so cache_control has somewhere to live.
      system: [{ type: 'text', text: 'Remain concise.' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    })
    expect(result.model).toBe('azure-anthropic/claude-sonnet-4-5')
    expect(result.tokens).toEqual({
      input: 10,
      output: 40,
      total: 100,
      cacheRead: 20,
      cacheWrite: 30,
    })
    expect(result.cost).toMatchObject({
      input: 0.0001485,
      output: 0.0006,
      total: 0.0007485,
    })
    expect(result.timing?.timeSegments?.[0]).toMatchObject({
      provider: 'azure-anthropic',
      tokens: {
        input: 10,
        output: 40,
        total: 100,
        cacheRead: 20,
        cacheWrite: 30,
      },
    })
  })

  it('applies tool post-processing consistently in non-streaming tool loops', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, output: { posted: true } })
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'msg-tool',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'publish', input: {} }],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 2 },
      })
      .mockResolvedValueOnce({
        id: 'msg-answer',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'Published' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 2 },
      })

    await executeAnthropicProviderRequest(
      {
        model: 'claude-sonnet-4-5',
        apiKey: 'test-key',
        maxTokens: 1024,
        messages: [{ role: 'user', content: 'Publish this' }],
        tools: [
          {
            id: 'publish',
            name: 'publish',
            description: 'Publish a post',
            params: {},
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      },
      {
        providerId: 'anthropic',
        providerLabel: 'Anthropic',
        createClient: () => ({ messages: { create } }) as never,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      }
    )

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'publish',
      expect.any(Object),
      expect.not.objectContaining({ skipPostProcess: true })
    )
  })
})

describe('executeAnthropicProviderRequest prompt caching', () => {
  function answerOnce() {
    return vi.fn().mockResolvedValue({
      id: 'msg-cache',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'Done' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 2, output_tokens: 2 },
    })
  }

  const tools = [
    {
      id: 'first',
      name: 'first',
      description: 'First tool',
      params: {},
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      id: 'second',
      name: 'second',
      description: 'Second tool',
      params: {},
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ]

  async function sendRequest(overrides: Partial<ProviderRequest>) {
    const create = answerOnce()
    await executeAnthropicProviderRequest(
      {
        model: 'claude-sonnet-4-5',
        apiKey: 'test-key',
        maxTokens: 1024,
        systemPrompt: 'Remain concise.',
        messages: [{ role: 'user', content: 'Hello' }],
        ...overrides,
      },
      {
        providerId: 'anthropic',
        providerLabel: 'Anthropic',
        createClient: () => ({ messages: { create } }) as never,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }
    )
    return create.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams
  }

  beforeEach(() => {
    mockExecuteTool.mockReset()
  })

  it('breaks the cache after the last tool and the last system block when enabled', async () => {
    const payload = await sendRequest({ promptCaching: true, tools })

    expect(payload.system).toEqual([
      { type: 'text', text: 'Remain concise.', cache_control: { type: 'ephemeral' } },
    ])
    expect(payload.tools?.map((tool) => tool.cache_control)).toEqual([
      undefined,
      { type: 'ephemeral' },
    ])
  })

  it('sends no breakpoints when caching is off', async () => {
    const payload = await sendRequest({ tools })

    expect(payload.system).toEqual([{ type: 'text', text: 'Remain concise.' }])
    expect(payload.tools?.some((tool) => tool.cache_control)).toBe(false)
  })

  it('appends schema instructions as a block and caches only the last one', async () => {
    const payload = await sendRequest({
      // Opus 4.1 lacks native structured outputs, so the schema is injected
      // into the system prompt — the path that used to string-concatenate.
      model: 'claude-opus-4-1',
      promptCaching: true,
      responseFormat: { name: 'answer', schema: { type: 'object', properties: {} } },
    })

    const blocks = payload.system as Anthropic.Messages.TextBlockParam[]
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ type: 'text', text: 'Remain concise.' })
    expect(blocks[1].text).toContain('answer')
    expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('omits the system field entirely when there is no system text', async () => {
    const payload = await sendRequest({ promptCaching: true, systemPrompt: undefined })

    expect(payload.system).toBeUndefined()
  })
})

describe('executeAnthropicProviderRequest forced tool use', () => {
  const forcedTool = {
    id: 'publish',
    name: 'publish',
    description: 'Publish a post',
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
    usageControl: 'force' as const,
  }

  const textReply = {
    id: 'msg-answer',
    type: 'message',
    role: 'assistant',
    model: 'claude-fable-5-1',
    content: [{ type: 'text', text: 'Done' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 2, output_tokens: 2 },
  }

  async function runWithForcedTool(model: string) {
    const create = vi.fn().mockResolvedValue({ ...textReply, model })
    const warn = vi.fn()
    await executeAnthropicProviderRequest(
      {
        model,
        apiKey: 'test-key',
        maxTokens: 1024,
        messages: [{ role: 'user', content: 'Publish this' }],
        tools: [forcedTool],
      },
      {
        providerId: 'anthropic',
        providerLabel: 'Anthropic',
        createClient: () => ({ messages: { create } }) as never,
        logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
      }
    )
    return { payload: create.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams, warn }
  }

  it('forces the tool on models that accept forced tool_choice', async () => {
    const { payload } = await runWithForcedTool('claude-sonnet-4-5')
    expect(payload.tool_choice).toEqual({ type: 'tool', name: 'publish' })
  })

  it.each(['claude-fable-5-1', 'claude-opus-5-5'])(
    'drops forced tool_choice when the catalog model disables Force (%s)',
    async (model) => {
      const { payload, warn } = await runWithForcedTool(model)
      expect(payload.tools?.map((tool) => tool.name)).toEqual(['publish'])
      expect(payload).not.toHaveProperty('tool_choice')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('rejects forced tool_choice'))
    }
  )
})

describe('executeAnthropicProviderRequest native structured outputs', () => {
  /** The subset of the wire schema these assertions read back. */
  interface WireSchemaNode {
    type?: string | string[]
    description?: string
    format?: string
    enum?: unknown[]
    const?: unknown
    minItems?: number
    minimum?: number
    additionalProperties?: boolean
    required?: string[]
    properties: Record<string, WireSchemaNode>
    items: WireSchemaNode
    anyOf: WireSchemaNode[]
    $defs: Record<string, WireSchemaNode>
  }

  async function sendSchema(schema: Record<string, unknown>): Promise<WireSchemaNode> {
    const create = vi.fn().mockResolvedValue({
      id: 'msg-schema',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: '{}' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 2, output_tokens: 2 },
    })

    await executeAnthropicProviderRequest(
      {
        model: 'claude-sonnet-4-5',
        apiKey: 'test-key',
        maxTokens: 1024,
        messages: [{ role: 'user', content: 'Extract' }],
        responseFormat: { name: 'extract', schema },
      },
      {
        providerId: 'anthropic',
        providerLabel: 'Anthropic',
        createClient: () => ({ messages: { create } }) as never,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }
    )

    const payload = create.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams & {
      output_config?: { format?: { type: string; schema: WireSchemaNode } }
    }
    return payload.output_config?.format?.schema as WireSchemaNode
  }

  beforeEach(() => {
    mockExecuteTool.mockReset()
  })

  it('keeps enum and const as grammar constraints at every level', async () => {
    const wireSchema = await sendSchema({
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'version', 'entities'],
      properties: {
        kind: { type: 'string', enum: ['person', 'org'] },
        version: { type: 'string', const: 'v1' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['role'],
            properties: {
              role: {
                type: 'string',
                description: 'Which role applies.',
                enum: ['owner', 'viewer'],
              },
            },
          },
        },
      },
    })

    expect(wireSchema.properties.kind.enum).toEqual(['person', 'org'])
    expect(wireSchema.properties.version.const).toBe('v1')
    expect(wireSchema.properties.entities.items.properties.role.enum).toEqual(['owner', 'viewer'])
  })

  it('does not leave enum duplicated as description prose', async () => {
    const wireSchema = await sendSchema({
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { type: 'string', description: 'Which heading.', enum: ['goal', 'status'] },
      },
    })

    expect(wireSchema.properties.kind.description).toBe('Which heading.')
    expect(wireSchema.properties.kind.enum).toEqual(['goal', 'status'])
  })

  it('preserves enum inside $defs and anyOf branches', async () => {
    const wireSchema = await sendSchema({
      type: 'object',
      additionalProperties: false,
      required: ['status', 'choice'],
      $defs: {
        Status: { type: 'string', enum: ['open', 'closed'] },
      },
      properties: {
        status: { $ref: '#/$defs/Status' },
        choice: {
          oneOf: [
            { type: 'string', enum: ['a', 'b'] },
            { type: 'string', const: 'c' },
          ],
        },
      },
    })

    expect(wireSchema.$defs.Status.enum).toEqual(['open', 'closed'])
    expect(wireSchema.properties.choice.anyOf[0].enum).toEqual(['a', 'b'])
    expect(wireSchema.properties.choice.anyOf[1].const).toBe('c')
  })

  it('still sanitizes the constraints the API rejects', async () => {
    const wireSchema = await sendSchema({
      type: 'object',
      required: ['tags', 'score', 'slug'],
      properties: {
        tags: { type: 'array', minItems: 5, items: { type: 'string', enum: ['x', 'y'] } },
        score: { type: 'number', minimum: 1, maximum: 10 },
        slug: { type: 'string', format: 'slug' },
      },
    })

    expect(wireSchema.additionalProperties).toBe(false)
    expect(wireSchema.properties.tags.minItems).toBeUndefined()
    expect(wireSchema.properties.tags.items.enum).toEqual(['x', 'y'])
    expect(wireSchema.properties.score.minimum).toBeUndefined()
    expect(wireSchema.properties.score.description).toContain('minimum')
    expect(wireSchema.properties.slug.format).toBeUndefined()
  })

  it.each<[string, Record<string, unknown>, 'enum' | 'const']>([
    ['object enum members', { type: 'object', enum: [{ a: 1 }, { a: 2 }] }, 'enum'],
    [
      'array enum members',
      { type: 'array', items: { type: 'string' }, enum: [['a'], ['b']] },
      'enum',
    ],
    ['enum containing null on a string node', { type: 'string', enum: ['a', null] }, 'enum'],
    ['mixed-type enum on a string node', { type: 'string', enum: ['a', 1] }, 'enum'],
    ['string enum on a number node', { type: 'number', enum: ['a', 'b'] }, 'enum'],
    ['empty enum', { type: 'string', enum: [] }, 'enum'],
    ['enum on a node with no declared type', { anyOf: [{ type: 'string' }], enum: ['a'] }, 'enum'],
    ['const with an object value', { type: 'object', const: { a: 1 } }, 'const'],
    [
      'const with an array value',
      { type: 'array', items: { type: 'string' }, const: ['a'] },
      'const',
    ],
  ])(
    'leaves %s demoted into description, exactly as the SDK transform does today',
    async (_name, node, keyword) => {
      const wireSchema = await sendSchema({
        type: 'object',
        additionalProperties: false,
        required: ['field'],
        properties: { field: node as Record<string, unknown> },
      })

      expect(wireSchema.properties.field[keyword]).toBeUndefined()
      expect(wireSchema.properties.field.description).toContain(`${keyword}:`)
    }
  )

  it('lifts the primitive const and enum shapes the API does grammar-check', async () => {
    const wireSchema = await sendSchema({
      type: 'object',
      additionalProperties: false,
      required: ['count', 'flag', 'rank', 'nothing', 'fixed', 'zero', 'off'],
      properties: {
        count: { type: 'number', enum: [1, 2, 3] },
        flag: { type: 'boolean', enum: [true, false] },
        rank: { type: 'integer', enum: [1, 2] },
        nothing: { type: 'null', enum: [null] },
        fixed: { type: 'string', const: 'v1' },
        zero: { type: 'number', const: 0 },
        off: { type: 'boolean', const: false },
      },
    })

    expect(wireSchema.properties.count.enum).toEqual([1, 2, 3])
    expect(wireSchema.properties.flag.enum).toEqual([true, false])
    expect(wireSchema.properties.rank.enum).toEqual([1, 2])
    expect(wireSchema.properties.nothing.enum).toEqual([null])
    expect(wireSchema.properties.fixed.const).toBe('v1')
    expect(wireSchema.properties.zero.const).toBe(0)
    expect(wireSchema.properties.off.const).toBe(false)
  })

  it("does not mutate the caller's schema, so parallel iterations reuse it safely", async () => {
    const shared = {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { type: 'string', enum: ['a', 'b'], description: 'd' } },
    }
    const before = JSON.stringify(shared)

    const first = await sendSchema(shared)
    const second = await sendSchema(shared)

    expect(JSON.stringify(shared)).toBe(before)
    expect(first.properties.kind.enum).toEqual(['a', 'b'])
    expect(second.properties.kind.enum).toEqual(['a', 'b'])
  })

  it('does not mistake a property literally named enum for a keyword', async () => {
    const wireSchema = await sendSchema({
      type: 'object',
      additionalProperties: false,
      required: ['enum'],
      properties: {
        enum: { type: 'string', enum: ['left', 'right'] },
      },
    })

    expect(wireSchema.properties.enum.type).toBe('string')
    expect(wireSchema.properties.enum.enum).toEqual(['left', 'right'])
  })
})

describe('streaming', () => {
  function message(content: unknown[], stopReason: string) {
    return {
      id: `msg-${stopReason}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 2, output_tokens: 2 },
    }
  }

  function stream(events: unknown[], finalMessage: ReturnType<typeof message>) {
    return {
      async *[Symbol.asyncIterator]() {
        yield* events
      },
      finalMessage: async () => finalMessage,
    }
  }

  async function collectEvents(result: StreamingExecution): Promise<AgentStreamEvent[]> {
    const events: AgentStreamEvent[] = []
    const reader = result.stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) return events
      events.push(value)
    }
  }

  describe('executeAnthropicProviderRequest live tool streaming', () => {
    it.each([
      ['anthropic', 'Anthropic'],
      ['azure-anthropic', 'Azure Anthropic'],
    ] as const)(
      'uses the live loop for %s streaming tool requests without a caller flag',
      async (providerId, providerLabel) => {
        const model =
          providerId === 'azure-anthropic'
            ? 'azure-anthropic/claude-sonnet-4-5'
            : 'claude-sonnet-4-5'
        mockExecuteTool.mockResolvedValue({ success: true, output: { value: 'tool result' } })

        const toolMessage = message(
          [{ type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} }],
          'tool_use'
        )
        const answerMessage = message([{ type: 'text', text: 'settled answer' }], 'end_turn')
        const createStream = vi
          .fn()
          .mockReturnValueOnce(
            stream(
              [
                {
                  type: 'content_block_start',
                  index: 0,
                  content_block: {
                    type: 'tool_use',
                    id: 'tool-1',
                    name: 'lookup',
                    input: {},
                  },
                },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_stop' },
              ],
              toolMessage
            )
          )
          .mockReturnValueOnce(
            stream(
              [
                {
                  type: 'content_block_start',
                  index: 0,
                  content_block: { type: 'text', text: '' },
                },
                {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: 'settled answer' },
                },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_stop' },
              ],
              answerMessage
            )
          )

        const result = (await executeAnthropicProviderRequest(
          {
            model,
            apiKey: 'test-key',
            stream: true,
            maxTokens: 1024,
            messages: [{ role: 'user', content: 'Look this up' }],
            tools: [
              {
                id: 'lookup',
                name: 'lookup',
                description: 'Lookup',
                params: {},
                parameters: { type: 'object', properties: {}, required: [] },
              },
            ],
          },
          {
            providerId,
            providerLabel,
            ...(providerId === 'azure-anthropic'
              ? { resolveWireModel: () => 'claude-sonnet-4-5' }
              : {}),
            createClient: () => ({ messages: { stream: createStream } }) as never,
            logger: {
              info: vi.fn(),
              warn: vi.fn(),
              error: vi.fn(),
              debug: vi.fn(),
            },
          }
        )) as StreamingExecution

        const events = await collectEvents(result)

        expect(createStream).toHaveBeenCalledTimes(2)
        expect(createStream.mock.calls[0][0].model).toBe('claude-sonnet-4-5')
        expect(events).toContainEqual({
          type: 'text_delta',
          text: 'settled answer',
          turn: 'pending',
        })
        expect(events).toContainEqual({ type: 'turn_end', turn: 'final' })
        expect(result.execution.output.content).toBe('settled answer')
        expect(result.execution.output.model).toBe(model)
        expect(
          result.execution.output.providerTiming?.timeSegments
            ?.filter((segment) => segment.type === 'model')
            .map((segment) => segment.provider)
        ).toEqual([providerId, providerId])
      }
    )
  })

  /**
   * Streaming is the common path, and breakpoints are placed on the shared
   * payload before the loop is handed it. A regression that moved placement
   * below the streaming branch would silently stop caching while the
   * non-streaming payload tests still passed.
   */
  describe('executeAnthropicProviderRequest streaming prompt caching', () => {
    it('carries cache breakpoints into every turn of the live tool loop', async () => {
      mockExecuteTool.mockResolvedValue({ success: true, output: { value: 'tool result' } })

      const createStream = vi
        .fn()
        .mockReturnValueOnce(
          stream(
            [{ type: 'message_stop' }],
            message([{ type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} }], 'tool_use')
          )
        )
        .mockReturnValueOnce(
          stream([{ type: 'message_stop' }], message([{ type: 'text', text: 'done' }], 'end_turn'))
        )

      const result = (await executeAnthropicProviderRequest(
        {
          model: 'claude-sonnet-4-5',
          apiKey: 'test-key',
          stream: true,
          maxTokens: 1024,
          promptCaching: true,
          systemPrompt: 'Remain concise.',
          messages: [{ role: 'user', content: 'Look this up' }],
          tools: [
            {
              id: 'lookup',
              name: 'lookup',
              description: 'Lookup',
              params: {},
              parameters: { type: 'object', properties: {}, required: [] },
            },
          ],
        },
        {
          providerId: 'anthropic',
          providerLabel: 'Anthropic',
          createClient: () => ({ messages: { stream: createStream } }) as never,
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        }
      )) as StreamingExecution

      await collectEvents(result)

      expect(createStream).toHaveBeenCalledTimes(2)
      for (const call of createStream.mock.calls) {
        const payload = call[0]
        expect(payload.system).toEqual([
          { type: 'text', text: 'Remain concise.', cache_control: { type: 'ephemeral' } },
        ])
        expect(payload.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' })
      }
    })
  })
})

/**
 * Anthropic thinking config: the summarized-display opt-in is requested only
 * on agent-events runs and only for models whose registry marks summarized
 * streaming (the omitted-display Claude generations). Legacy runs keep the
 * exact pre-agent-events request shape.
 */
describe('buildThinkingConfig', () => {
  it('requests summarized display for omitted-display models on agent-events runs', () => {
    for (const model of [
      'claude-fable-5-1',
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
    ]) {
      const config = buildThinkingConfig(model, 'high', true)
      expect(config?.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
      expect(config?.outputConfig).toEqual({ effort: 'high' })
    }
  })

  it('never adds display on legacy runs (no agent events)', () => {
    for (const model of [
      'claude-fable-5-1',
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
    ]) {
      const config = buildThinkingConfig(model, 'high', false)
      expect(config?.thinking).toEqual({ type: 'adaptive' })
    }
  })

  it('requests summarized display for adaptive models marked as summary-streamed', () => {
    for (const model of ['claude-opus-4-6', 'claude-sonnet-4-6']) {
      const config = buildThinkingConfig(model, 'high', true)
      expect(config?.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    }
  })

  it('keeps budget-token models on the extended thinking path', () => {
    const config = buildThinkingConfig('claude-sonnet-4-5', 'high', true)
    expect(config?.thinking).toMatchObject({ type: 'enabled' })
    expect(config?.thinking).not.toHaveProperty('display')
  })

  it('returns null for unknown levels and non-thinking models', () => {
    expect(buildThinkingConfig('claude-fable-5', 'not-a-level', true)).toBeNull()
    expect(buildThinkingConfig('gpt-4o', 'high', true)).toBeNull()
  })
})

/**
 * A thinking level that is not one the model declares reaches this adapter, by design — Sim's
 * per-model lists can lag a provider. The adapter logs that it is ignoring it, and since the
 * field is reference-bound, the value it logs can be whatever a mistyped `{{ENV_VAR}}` or block
 * reference resolved to.
 */
describe('unsupported thinking level logging', () => {
  it('returns null for a level the model does not declare', () => {
    expect(buildThinkingConfig('claude-sonnet-5', 'sk-proj-abcdef0123456789', false)).toBeNull()
  })

  it('redacts the level in the ignore warning instead of echoing it', () => {
    const secret = 'sk-proj-abcdef0123456789'
    expect(describeModelLevel(secret)).toBe(`[redacted ${secret.length} chars]`)
    expect(describeModelLevel('high')).toBe('high')
  })
})
