/**
 * OpenAI prompt caching is automatic, so the only lever is routing stickiness:
 * a `prompt_cache_key` that is stable for one agent block and distinct between
 * blocks. Sharing a key across blocks with different prefixes would lower the
 * hit rate rather than raise it.
 */
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
import type { ProviderRequest } from '@/providers/types'

providersMock.MAX_TOOL_ITERATIONS = 5

providersUtilsMockFns.mockPrepareToolExecution.mockReturnValue({
  toolParams: {},
  executionParams: {},
})
providersUtilsMockFns.mockPrepareToolsWithUsageControl.mockImplementation((tools) => ({
  tools,
  toolChoice: undefined,
  forcedTools: [],
  hasFilteredTools: false,
}))

vi.mock('@/providers', () => providersMock)

vi.mock('@/providers/utils', () => providersUtilsMock)

vi.mock('@/tools', () => toolsMock)

const COMPLETED_RESPONSE = {
  id: 'resp_1',
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
}

describe('executeResponsesProviderRequest prompt cache key', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // A Response body reads once, so each call needs its own instance.
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(COMPLETED_RESPONSE), {
          headers: { 'Content-Type': 'application/json' },
        })
    )
  })

  async function sentCacheKey(request: Partial<ProviderRequest>): Promise<string | undefined> {
    await executeResponsesProviderRequest(
      {
        model: 'gpt-5.5',
        apiKey: 'k',
        messages: [{ role: 'user', content: 'hi' }],
        ...request,
      },
      {
        providerId: 'openai',
        providerLabel: 'OpenAI',
        modelName: 'gpt-5.5',
        endpoint: 'https://api.openai.com/v1/responses',
        headers: { Authorization: 'Bearer k' },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        fetch: fetchMock as unknown as typeof fetch,
      }
    )
    const body = JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body as string)
    return body.prompt_cache_key
  }

  it('sends the same key for repeat runs of one block', async () => {
    const first = await sentCacheKey({ workflowId: 'wf-1', blockId: 'block-a' })
    const second = await sentCacheKey({ workflowId: 'wf-1', blockId: 'block-a' })

    expect(first).toBeTruthy()
    expect(second).toBe(first)
  })

  it('sends a different key for another block in the same workflow', async () => {
    const blockA = await sentCacheKey({ workflowId: 'wf-1', blockId: 'block-a' })
    const blockB = await sentCacheKey({ workflowId: 'wf-1', blockId: 'block-b' })

    expect(blockB).not.toBe(blockA)
  })

  it('sends a different key for the same block id in another workflow', async () => {
    const workflowOne = await sentCacheKey({ workflowId: 'wf-1', blockId: 'block-a' })
    const workflowTwo = await sentCacheKey({ workflowId: 'wf-2', blockId: 'block-a' })

    expect(workflowTwo).not.toBe(workflowOne)
  })

  it('leaks no internal identifier into the key', async () => {
    const key = await sentCacheKey({ workflowId: 'wf-1', blockId: 'block-a' })

    expect(key).not.toContain('wf-1')
    expect(key).not.toContain('block-a')
  })

  it('omits the key when the caller has no stable identity', async () => {
    expect(await sentCacheKey({ workflowId: 'wf-1' })).toBeUndefined()
    expect(await sentCacheKey({ blockId: 'block-a' })).toBeUndefined()
  })
})
