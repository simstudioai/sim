/**
 * @vitest-environment node
 *
 * OpenAI Responses reasoning payload: summaries are requested on agent-events
 * runs and whenever an explicit effort is set (staging parity), legacy runs
 * without explicit effort keep a reasoning-free payload, and the
 * unverified-organization 400 falls back to a summary-free retry.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
import type { ProviderRequest } from '@/providers/types'
import { executeTool } from '@/tools'

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

vi.mock('@/providers/utils', () => ({
  calculateCost: () => ({ input: 0, output: 0, total: 0 }),
  sumToolCosts: () => 0,
  enforceStrictSchema: (schema: unknown) => schema,
  prepareToolExecution: () => ({ toolParams: {}, executionParams: {} }),
  prepareToolsWithUsageControl: () => ({
    tools: [],
    toolChoice: undefined,
    forcedTools: [],
    hasFilteredTools: false,
  }),
  trackForcedToolUsage: () => ({ hasUsedForcedTool: false, usedForcedTools: [] }),
  supportsReasoningEffort: (model: string) => ['gpt-5.5', 'o3'].includes(model),
}))

vi.mock('@/tools', () => ({ executeTool: vi.fn() }))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const COMPLETED_RESPONSE = {
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
}

describe('executeResponsesProviderRequest reasoning payload', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any

  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(COMPLETED_RESPONSE))
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

  describe('agent-events runs', () => {
    it('requests reasoning.summary auto when effort is auto', async () => {
      await run({ model: 'gpt-5.5', agentEvents: true, reasoningEffort: 'auto' })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.reasoning).toEqual({ summary: 'auto' })
    })

    it('requests reasoning.summary auto when effort is unset', async () => {
      await run({ model: 'o3', agentEvents: true })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.reasoning).toEqual({ summary: 'auto' })
    })

    it('requests summary and effort when effort is explicit', async () => {
      await run({ model: 'gpt-5.5', agentEvents: true, reasoningEffort: 'high' })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.reasoning).toEqual({ summary: 'auto', effort: 'high' })
    })

    it('retries without summary when the organization is not verified', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: {
                message:
                  "Your organization must be verified to generate reasoning summaries. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization. (param: 'reasoning.summary')",
                param: 'reasoning.summary',
                code: 'unsupported_value',
              },
            },
            400
          )
        )
        .mockResolvedValueOnce(jsonResponse(COMPLETED_RESPONSE))

      const result = await run({ model: 'o3', agentEvents: true, reasoningEffort: 'high' })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
      expect(retryBody.reasoning).toEqual({ effort: 'high' })
      expect((result as { content: string }).content).toBe('hello')
    })

    it('does not retry on unrelated 400s', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { message: 'Invalid value for input' } }, 400)
      )
      await expect(run({ model: 'o3', agentEvents: true })).rejects.toThrow('Invalid value')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('legacy runs (no agent events)', () => {
    it('omits reasoning entirely when effort is unset', async () => {
      await run({ model: 'o3' })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.reasoning).toBeUndefined()
    })

    it('omits reasoning when effort is auto', async () => {
      await run({ model: 'gpt-5.5', reasoningEffort: 'auto' })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.reasoning).toBeUndefined()
    })

    it('keeps the staging payload (effort + summary) when effort is explicit', async () => {
      // Pre-agent-events payloads always paired summary:'auto' with an
      // explicit effort — legacy runs must stay byte-identical.
      await run({ model: 'gpt-5.5', reasoningEffort: 'high' })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.reasoning).toEqual({ summary: 'auto', effort: 'high' })
    })
  })

  it('omits reasoning for non-reasoning models', async () => {
    await run({ model: 'gpt-4o', agentEvents: true })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.reasoning).toBeUndefined()
  })

  describe('final regenerated stream after the tool loop', () => {
    const TOOL_CALL_RESPONSE = {
      id: 'resp_tool',
      status: 'completed',
      output: [{ type: 'function_call', call_id: 'call_1', name: 'exa_search', arguments: '{}' }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }

    const SETTLED_ANSWER_RESPONSE = {
      id: 'resp_answer',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Settled answer from loop' }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }

    /** An SSE stream that ends without any output_text (dead function_call turn). */
    function emptySseResponse() {
      return new Response('data: {"type":"response.completed"}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    async function collect(stream: ReadableStream<unknown>) {
      const events: unknown[] = []
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        events.push(value)
      }
      return events
    }

    it('forces tool_choice none and keeps the tool-loop answer when the stream has no text', async () => {
      ;(executeTool as Mock).mockResolvedValue({ success: true, output: { results: [] } })
      fetchMock
        .mockResolvedValueOnce(jsonResponse(TOOL_CALL_RESPONSE))
        .mockResolvedValueOnce(jsonResponse(SETTLED_ANSWER_RESPONSE))
        .mockResolvedValueOnce(emptySseResponse())

      const result = (await run({
        model: 'gpt-5.5',
        stream: true,
        tools: [{ id: 'exa_search', name: 'exa_search', description: 'd', parameters: {} }] as any,
      })) as { stream: ReadableStream<unknown>; execution: { output: { content: string } } }

      expect(fetchMock).toHaveBeenCalledTimes(3)
      const streamBody = JSON.parse(fetchMock.mock.calls[2][1].body as string)
      expect(streamBody.stream).toBe(true)
      // The regeneration exists to stream prose; streamed calls are never executed.
      expect(streamBody.tool_choice).toBe('none')

      const events = await collect(result.stream)
      // Settled chips for the silent loop's executed calls ride ahead of the answer.
      expect(events[0]).toEqual({ type: 'tool_call_start', id: 'call_1', name: 'exa_search' })
      expect(events[1]).toEqual({
        type: 'tool_call_end',
        id: 'call_1',
        name: 'exa_search',
        status: 'success',
      })
      expect(result.execution.output.content).toBe('Settled answer from loop')
    })
  })
})
