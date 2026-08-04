/**
 * @vitest-environment node
 */

import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
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

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 10 }))

vi.mock('@/providers/runtime-context', () => ({
  executeProviderTool: mockExecuteProviderTool,
}))

import type { StreamingExecution } from '@/executor/types'
import type { ProviderRequest, ProviderResponse, ProviderToolConfig } from '@/providers/types'
import { xAIProvider } from '@/providers/xai'

interface XAITestUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: { cached_tokens: number }
  completion_tokens_details?: { reasoning_tokens: number }
  cost_in_usd_ticks?: number
}

function textResponse(
  content: string,
  usage: XAITestUsage,
  serviceTier: 'default' | 'priority' = 'default'
) {
  return {
    choices: [{ message: { content, tool_calls: undefined }, finish_reason: 'stop' }],
    usage,
    service_tier: serviceTier,
  }
}

function toolCallResponse(name: string, args: Record<string, unknown>, usage: XAITestUsage) {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage,
    service_tier: 'default',
  }
}

function tool(id: string): ProviderToolConfig {
  return {
    id,
    name: id,
    description: 'test tool',
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

async function drainStream(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader()
  while (!(await reader.read()).done) {}
}

const baseRequest: ProviderRequest = {
  apiKey: 'xai-test-key',
  model: 'grok-4.5',
  messages: [{ role: 'user', content: 'Hello' }],
}

describe('xAIProvider usage accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockReset()
    mockExecuteProviderTool.mockReset()
  })

  it('returns exact cost and detailed normalized tokens for nonstreaming requests', async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse(
        'Hello back',
        {
          prompt_tokens: 32,
          completion_tokens: 9,
          total_tokens: 135,
          prompt_tokens_details: { cached_tokens: 6 },
          completion_tokens_details: { reasoning_tokens: 94 },
          cost_in_usd_ticks: 12_345_678,
        },
        'priority'
      )
    )

    const response = (await xAIProvider.executeRequest(baseRequest)) as ProviderResponse

    expect(response.tokens).toEqual({
      input: 26,
      output: 103,
      total: 135,
      cacheRead: 6,
      reasoning: 94,
    })
    expect(response.cost?.total).toBe(0.0012345678)
    expect((response.cost?.input ?? 0) + (response.cost?.output ?? 0)).toBeCloseTo(0.0012345678, 10)
    expect(response.timing?.timeSegments?.[0]).toMatchObject({
      tokens: response.tokens,
      cost: { total: 0.0012345678 },
      provider: 'xai',
    })
  })

  it('accumulates exact cost and detailed tokens across tool-loop turns', async () => {
    mockCreate
      .mockResolvedValueOnce(
        toolCallResponse(
          'lookup',
          { id: 7 },
          {
            prompt_tokens: 10,
            completion_tokens: 3,
            total_tokens: 14,
            prompt_tokens_details: { cached_tokens: 2 },
            completion_tokens_details: { reasoning_tokens: 1 },
            cost_in_usd_ticks: 1_000_000,
          }
        )
      )
      .mockResolvedValueOnce(
        textResponse('Found it', {
          prompt_tokens: 20,
          completion_tokens: 4,
          total_tokens: 26,
          prompt_tokens_details: { cached_tokens: 5 },
          completion_tokens_details: { reasoning_tokens: 2 },
          cost_in_usd_ticks: 2_000_000,
        })
      )
    mockExecuteProviderTool.mockResolvedValueOnce({ success: true, output: { value: 42 } })

    const response = (await xAIProvider.executeRequest({
      ...baseRequest,
      tools: [tool('lookup')],
    })) as ProviderResponse

    expect(mockExecuteProviderTool).toHaveBeenCalledWith(
      'lookup',
      expect.objectContaining({ id: 7 }),
      expect.anything()
    )
    expect(response.content).toBe('Found it')
    expect(response.tokens).toEqual({
      input: 23,
      output: 10,
      total: 40,
      cacheRead: 7,
      reasoning: 3,
    })
    expect(response.cost?.total).toBe(0.0003)
    expect(response.toolResults).toEqual([{ value: 42 }])
    expect(
      response.timing?.timeSegments?.filter((segment) => segment.type === 'model')
    ).toHaveLength(2)
    for (const segment of response.timing?.timeSegments?.filter(
      (candidate) => candidate.type === 'model'
    ) ?? []) {
      expect(segment.tokens).toBeDefined()
      expect(segment.cost?.total).toBeGreaterThan(0)
    }
  })

  it('settles exact cost and detailed tokens after draining a direct stream', async () => {
    const usage: XAITestUsage = {
      prompt_tokens: 32,
      completion_tokens: 9,
      total_tokens: 135,
      prompt_tokens_details: { cached_tokens: 6 },
      completion_tokens_details: { reasoning_tokens: 94 },
      cost_in_usd_ticks: 12_345_678,
    }
    const chunks = (async function* (): AsyncGenerator<ChatCompletionChunk> {
      yield {
        id: 'xai-1',
        choices: [{ index: 0, delta: { content: 'Streamed' }, finish_reason: null }],
        created: 0,
        model: 'grok-4.5',
        object: 'chat.completion.chunk',
      }
      yield {
        id: 'xai-1',
        choices: [],
        created: 0,
        model: 'grok-4.5',
        object: 'chat.completion.chunk',
        usage,
        service_tier: 'priority',
      } as unknown as ChatCompletionChunk
    })()
    mockCreate.mockResolvedValueOnce(chunks)

    const result = (await xAIProvider.executeRequest({
      ...baseRequest,
      stream: true,
    })) as StreamingExecution
    await drainStream(result.stream)

    expect(result.execution.output.content).toBe('Streamed')
    expect(result.execution.output.tokens).toEqual({
      input: 26,
      output: 103,
      total: 135,
      cacheRead: 6,
      reasoning: 94,
    })
    expect(result.execution.output.cost?.total).toBe(0.0012345678)
    expect(result.execution.output.providerTiming?.timeSegments?.[0]).toMatchObject({
      assistantContent: 'Streamed',
      tokens: result.execution.output.tokens,
      cost: { total: 0.0012345678 },
      provider: 'xai',
    })
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    })
  })
})
