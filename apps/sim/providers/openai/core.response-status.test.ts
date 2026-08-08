/**
 * @vitest-environment node
 *
 * Pins the non-streaming status/error gate, and pins its `incomplete` policy to the one
 * `streamResponsesTurn` applies so the two paths cannot silently diverge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: () => false,
  calculateCost: () => ({ input: 0, output: 0, total: 0 }),
  sumToolCosts: () => 0,
  enforceStrictSchema: (schema: unknown) => schema,
  prepareToolExecution: () => ({ toolParams: {}, executionParams: {} }),
  prepareToolsWithUsageControl: (tools: unknown[]) => ({
    tools,
    toolChoice: undefined,
    forcedTools: [],
    hasFilteredTools: false,
  }),
  trackForcedToolUsage: () => ({ hasUsedForcedTool: false, usedForcedTools: [] }),
  supportsReasoningEffort: () => false,
}))

const { mockExecuteProviderTool } = vi.hoisted(() => ({
  mockExecuteProviderTool: vi.fn(),
}))

vi.mock('@/providers/runtime-context', () => ({
  executeProviderTool: mockExecuteProviderTool,
}))

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  }
}

const USAGE = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }

function message(text: string) {
  return {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  }
}

function functionCall(args: string) {
  return { type: 'function_call', call_id: 'call_1', name: 'exa_search', arguments: args }
}

const COMPLETED_RESPONSE = {
  id: 'resp_1',
  status: 'completed',
  error: null,
  incomplete_details: null,
  output: [message('hello')],
  usage: USAGE,
}

describe('OpenAI non-streaming response status handling', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any

  beforeEach(() => {
    vi.clearAllMocks()
    const response = { success: true, output: { results: [] } }
    mockExecuteProviderTool.mockResolvedValue({ rawResponse: response, modelResponse: response })
  })

  function run(fetchMock: unknown, request: Partial<ProviderRequest> = {}) {
    return executeResponsesProviderRequest(
      { apiKey: 'k', model: 'gpt-5.5', messages: [{ role: 'user', content: 'hi' }], ...request },
      {
        providerId: 'openai',
        providerLabel: 'OpenAI',
        modelName: 'gpt-5.5',
        endpoint: 'https://api.openai.com/v1/responses',
        headers: { Authorization: 'Bearer k' },
        logger,
        fetch: fetchMock as typeof fetch,
      }
    )
  }

  const TOOL_REQUEST: Partial<ProviderRequest> = {
    tools: [{ id: 'exa_search', name: 'exa_search', description: 'search', params: {} }],
  }

  it('fails the block on a 200 carrying status "failed", surfacing the API error message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'resp_1',
        status: 'failed',
        error: { code: 'server_error', message: 'The model produced an invalid response.' },
        incomplete_details: null,
        output: [],
        usage: USAGE,
      })
    )

    await expect(run(fetchMock)).rejects.toThrow('The model produced an invalid response.')
  })

  it('fails the block when error is populated but status is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'resp_1',
        error: { code: null, message: 'Upstream provider rejected the request.' },
        incomplete_details: null,
        output: [],
        usage: USAGE,
      })
    )

    await expect(run(fetchMock)).rejects.toThrow('Upstream provider rejected the request.')
  })

  /** Policy is shared with `streamResponsesTurn` — keep both in step. */
  it('returns the partial content of a max_output_tokens incomplete response instead of failing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'resp_1',
        status: 'incomplete',
        error: null,
        incomplete_details: { reason: 'max_output_tokens' },
        output: [message('a truncated but usable answer')],
        usage: USAGE,
      })
    )

    const result = (await run(fetchMock)) as ProviderResponse
    expect(result.content).toBe('a truncated but usable answer')
  })

  it('fails the block on an incomplete response whose reason is not max_output_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'resp_1',
        status: 'incomplete',
        error: null,
        incomplete_details: { reason: 'content_filter' },
        output: [message('partial')],
        usage: USAGE,
      })
    )

    await expect(run(fetchMock)).rejects.toThrow(/content_filter/)
  })

  /**
   * The confusing-failure case: a truncated `function_call` holds half-written JSON.
   * Executing it made `parseToolArguments` throw, reporting a tool bug rather than the
   * truncation that actually happened.
   */
  it('does not execute a tool call from a non-completed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'resp_1',
        status: 'incomplete',
        error: null,
        incomplete_details: { reason: 'max_output_tokens' },
        output: [functionCall('{"query": "half writ')],
        usage: USAGE,
      })
    )

    await expect(run(fetchMock, TOOL_REQUEST)).rejects.toThrow(/max_output_tokens/)
    expect(mockExecuteProviderTool).not.toHaveBeenCalled()
  })

  it('leaves a healthy completed response entirely unaffected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(COMPLETED_RESPONSE))

    const result = (await run(fetchMock)) as ProviderResponse
    expect(result.content).toBe('hello')
    expect(result.toolCalls).toBeUndefined()
    expect(result.tokens?.total).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still runs the multi-turn tool loop end to end', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'resp_tool',
          status: 'completed',
          error: null,
          incomplete_details: null,
          output: [functionCall('{"query":"sim"}')],
          usage: USAGE,
        })
      )
      .mockResolvedValueOnce(jsonResponse(COMPLETED_RESPONSE))

    const result = (await run(fetchMock, TOOL_REQUEST)) as ProviderResponse

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockExecuteProviderTool).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls?.[0].success).toBe(true)
    expect(result.content).toBe('hello')
    expect(result.tokens?.total).toBe(4)
  })

  /** The gate lives in `postResponses`, so continuation turns are covered too. */
  it('fails the block when a later tool-loop turn comes back failed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'resp_tool',
          status: 'completed',
          error: null,
          incomplete_details: null,
          output: [functionCall('{"query":"sim"}')],
          usage: USAGE,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'resp_2',
          status: 'failed',
          error: { code: 'server_error', message: 'Second turn blew up.' },
          incomplete_details: null,
          output: [],
          usage: USAGE,
        })
      )

    await expect(run(fetchMock, TOOL_REQUEST)).rejects.toThrow('Second turn blew up.')
    expect(mockExecuteProviderTool).toHaveBeenCalledTimes(1)
  })
})
