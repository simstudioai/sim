/**
 * @vitest-environment node
 *
 * OpenAI Responses harden: reasoning models always request summary: 'auto'
 * even when effort is auto / unset.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
import type { ProviderRequest } from '@/providers/types'

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

vi.mock('@/providers/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/utils')>()
  return {
    ...actual,
    calculateCost: () => ({ input: 0, output: 0, total: 0 }),
    sumToolCosts: () => 0,
    prepareToolsWithUsageControl: () => ({
      tools: [],
      toolChoice: undefined,
      forcedTools: [],
      hasFilteredTools: false,
    }),
  }
})

vi.mock('@/tools', () => ({ executeTool: vi.fn() }))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('executeResponsesProviderRequest reasoning harden', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any

  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'resp_1',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'hello' }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      })
    )
  })

  function run(request: Partial<ProviderRequest> & { model: string }) {
    return executeResponsesProviderRequest(
      {
        apiKey: 'k',
        messages: [{ role: 'user', content: 'hi' }],
        ...request,
      },
      {
        providerId: 'openai',
        providerLabel: 'OpenAI',
        modelName: request.model,
        endpoint: 'https://api.openai.com/v1/responses',
        headers: { Authorization: 'Bearer k' },
        logger,
        fetch: fetchMock as unknown as typeof fetch,
      }
    )
  }

  it('includes reasoning.summary auto when effort is auto', async () => {
    await run({ model: 'gpt-5.5', reasoningEffort: 'auto' })
    expect(fetchMock).toHaveBeenCalled()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.reasoning).toEqual({ summary: 'auto' })
  })

  it('includes reasoning.summary auto when effort is unset', async () => {
    await run({ model: 'o3' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.reasoning).toEqual({ summary: 'auto' })
  })

  it('includes effort and summary when effort is explicit', async () => {
    await run({ model: 'gpt-5.5', reasoningEffort: 'high' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.reasoning).toEqual({ summary: 'auto', effort: 'high' })
  })

  it('omits reasoning for non-reasoning models', async () => {
    await run({ model: 'gpt-4o' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.reasoning).toBeUndefined()
  })
})
