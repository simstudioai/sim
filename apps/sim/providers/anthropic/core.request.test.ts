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
