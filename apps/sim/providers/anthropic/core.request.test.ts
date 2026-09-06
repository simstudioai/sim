/**
 * @vitest-environment node
 */
import type Anthropic from '@anthropic-ai/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAnthropicProviderRequest } from '@/providers/anthropic/core'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
}))

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

  it('drops forced tool_choice when the catalog model disables Force', async () => {
    const { payload, warn } = await runWithForcedTool('claude-fable-5-1')
    expect(payload.tools?.map((tool) => tool.name)).toEqual(['publish'])
    expect(payload).not.toHaveProperty('tool_choice')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rejects forced tool_choice'))
  })
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
