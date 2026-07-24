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
  prepareToolsWithUsageControl: (tools: unknown[]) => ({
    tools,
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

function sseResponse(events: unknown[]) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
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
    vi.clearAllMocks()
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

    it('remembers summary rejection for later tool-loop turns', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: {
                message:
                  "Your organization must be verified to generate reasoning summaries. (param: 'reasoning.summary')",
              },
            },
            400
          )
        )
        .mockResolvedValueOnce(
          jsonResponse({
            id: 'resp_tool',
            status: 'completed',
            output: [
              { type: 'function_call', call_id: 'call_1', name: 'exa_search', arguments: '{}' },
            ],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          })
        )
        .mockResolvedValueOnce(jsonResponse(COMPLETED_RESPONSE))
      ;(executeTool as Mock).mockResolvedValue({ success: true, output: { results: [] } })

      await run({
        model: 'o3',
        agentEvents: true,
        tools: [{ id: 'exa_search', name: 'exa_search', description: 'd', parameters: {} }] as any,
      })

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).reasoning).toEqual({
        summary: 'auto',
      })
      expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).reasoning).toBeUndefined()
      expect(JSON.parse(fetchMock.mock.calls[2][1].body as string).reasoning).toBeUndefined()
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

  describe('live streaming tool loop', () => {
    it('streams reasoning and tool lifecycle in real time without a regeneration call', async () => {
      const toolTurnResponse = {
        id: 'resp_tool',
        status: 'completed',
        output: [
          {
            id: 'rs_1',
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'I should search.' }],
          },
          {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'exa_search',
            arguments: '{}',
            status: 'completed',
          },
        ],
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      }
      const answerTurnResponse = {
        id: 'resp_answer',
        status: 'completed',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'Final answer', annotations: [] }],
          },
        ],
        usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 },
      }

      fetchMock
        .mockResolvedValueOnce(
          sseResponse([
            {
              type: 'response.reasoning_summary_text.delta',
              item_id: 'rs_1',
              output_index: 0,
              summary_index: 0,
              sequence_number: 1,
              delta: 'I should search.',
            },
            {
              type: 'response.output_item.added',
              output_index: 1,
              sequence_number: 2,
              item: {
                id: 'fc_1',
                type: 'function_call',
                call_id: 'call_1',
                name: 'exa_search',
                arguments: '',
                status: 'in_progress',
              },
            },
            {
              type: 'response.completed',
              sequence_number: 3,
              response: toolTurnResponse,
            },
          ])
        )
        .mockResolvedValueOnce(
          sseResponse([
            {
              type: 'response.reasoning_summary_text.delta',
              item_id: 'rs_2',
              output_index: 0,
              summary_index: 0,
              sequence_number: 1,
              delta: 'I have the result.',
            },
            {
              type: 'response.output_text.delta',
              item_id: 'msg_1',
              output_index: 1,
              content_index: 0,
              sequence_number: 2,
              delta: 'Final answer',
              logprobs: [],
            },
            {
              type: 'response.completed',
              sequence_number: 3,
              response: answerTurnResponse,
            },
          ])
        )
      let resolveTool!: (value: { success: true; output: { results: string[] } }) => void
      ;(executeTool as Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveTool = resolve
        })
      )

      const result = (await run({
        model: 'gpt-5.5',
        stream: true,
        agentEvents: true,
        tools: [{ id: 'exa_search', name: 'exa_search', description: 'd', parameters: {} }] as any,
      })) as { stream: ReadableStream<unknown>; execution: { output: { content: string } } }

      const reader = result.stream.getReader()
      const events: unknown[] = []
      for (let index = 0; index < 3; index++) {
        const next = await reader.read()
        expect(next.done).toBe(false)
        events.push(next.value)
      }

      expect(events).toEqual([
        { type: 'thinking_delta', text: 'I should search.' },
        { type: 'tool_call_start', id: 'call_1', name: 'exa_search' },
        { type: 'turn_end', turn: 'intermediate' },
      ])
      expect(fetchMock).toHaveBeenCalledTimes(1)

      resolveTool({ success: true, output: { results: ['hit'] } })
      while (true) {
        const next = await reader.read()
        if (next.done) break
        events.push(next.value)
      }

      expect(events).toEqual([
        { type: 'thinking_delta', text: 'I should search.' },
        { type: 'tool_call_start', id: 'call_1', name: 'exa_search' },
        { type: 'turn_end', turn: 'intermediate' },
        { type: 'tool_call_end', id: 'call_1', name: 'exa_search', status: 'success' },
        { type: 'thinking_delta', text: 'I have the result.' },
        { type: 'text_delta', text: 'Final answer', turn: 'pending' },
        { type: 'turn_end', turn: 'final' },
      ])
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
      expect(firstBody.stream).toBe(true)
      expect(secondBody.stream).toBe(true)
      expect(secondBody.input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'rs_1', type: 'reasoning' }),
          expect.objectContaining({ call_id: 'call_1', type: 'function_call' }),
          expect.objectContaining({ call_id: 'call_1', type: 'function_call_output' }),
        ])
      )
      expect(result.execution.output.content).toBe('Final answer')
    })

    it('fails an unexpected tool AbortError and preserves completed usage', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          {
            type: 'response.output_item.added',
            output_index: 0,
            sequence_number: 1,
            item: {
              id: 'fc_1',
              type: 'function_call',
              call_id: 'call_1',
              name: 'exa_search',
              arguments: '{}',
              status: 'completed',
            },
          },
          {
            type: 'response.completed',
            sequence_number: 2,
            response: {
              id: 'resp_tool',
              status: 'completed',
              output: [
                {
                  id: 'fc_1',
                  type: 'function_call',
                  call_id: 'call_1',
                  name: 'exa_search',
                  arguments: '{}',
                  status: 'completed',
                },
              ],
              usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
            },
          },
        ])
      )
      ;(executeTool as Mock).mockRejectedValueOnce(
        new DOMException('tool aborted unexpectedly', 'AbortError')
      )

      const result = (await run({
        model: 'gpt-5.5',
        stream: true,
        tools: [{ id: 'exa_search', name: 'exa_search', description: 'd', parameters: {} }] as any,
      })) as {
        stream: ReadableStream<unknown>
        execution: { output: { tokens: { input: number; output: number; total: number } } }
      }

      await expect(collect(result.stream)).rejects.toMatchObject({ name: 'AbortError' })
      expect(result.execution.output.tokens).toEqual({ input: 2, output: 3, total: 5 })
    })

    it('makes the final answer turn after the maximum tool batches', async () => {
      for (let index = 0; index < 5; index++) {
        const callId = `call_${index}`
        fetchMock.mockResolvedValueOnce(
          sseResponse([
            {
              type: 'response.output_item.added',
              output_index: 0,
              sequence_number: 1,
              item: {
                id: `fc_${index}`,
                type: 'function_call',
                call_id: callId,
                name: 'exa_search',
                arguments: '',
                status: 'in_progress',
              },
            },
            {
              type: 'response.completed',
              sequence_number: 2,
              response: {
                id: `resp_${index}`,
                status: 'completed',
                output: [
                  {
                    id: `fc_${index}`,
                    type: 'function_call',
                    call_id: callId,
                    name: 'exa_search',
                    arguments: '{}',
                    status: 'completed',
                  },
                ],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
              },
            },
          ])
        )
      }
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          {
            type: 'response.output_text.delta',
            item_id: 'msg_final',
            output_index: 0,
            content_index: 0,
            sequence_number: 1,
            delta: 'Answer after five tools',
            logprobs: [],
          },
          {
            type: 'response.completed',
            sequence_number: 2,
            response: {
              id: 'resp_final',
              status: 'completed',
              output: [
                {
                  id: 'msg_final',
                  type: 'message',
                  role: 'assistant',
                  status: 'completed',
                  content: [
                    { type: 'output_text', text: 'Answer after five tools', annotations: [] },
                  ],
                },
              ],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ])
      )
      ;(executeTool as Mock).mockResolvedValue({ success: true, output: { results: [] } })

      const result = (await run({
        model: 'gpt-5.5',
        stream: true,
        agentEvents: true,
        tools: [{ id: 'exa_search', name: 'exa_search', description: 'd', parameters: {} }] as any,
      })) as { stream: ReadableStream<unknown>; execution: { output: { content: string } } }

      await collect(result.stream)

      expect(fetchMock).toHaveBeenCalledTimes(6)
      expect(executeTool).toHaveBeenCalledTimes(5)
      const finalBody = JSON.parse(fetchMock.mock.calls[5][1].body as string)
      expect(finalBody.tool_choice).toBe('none')
      expect(finalBody.tools).toBeUndefined()
      expect(result.execution.output.content).toBe('Answer after five tools')
    })

    it('finalizes truncated text when max_output_tokens is reached without a tool call', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          {
            type: 'response.output_text.delta',
            item_id: 'msg_partial',
            output_index: 0,
            content_index: 0,
            sequence_number: 1,
            delta: 'Partial answer',
            logprobs: [],
          },
          {
            type: 'response.incomplete',
            sequence_number: 2,
            response: {
              id: 'resp_incomplete',
              status: 'incomplete',
              incomplete_details: { reason: 'max_output_tokens' },
              output: [],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ])
      )

      const result = (await run({
        model: 'gpt-5.5',
        stream: true,
        agentEvents: true,
        tools: [{ id: 'exa_search', name: 'exa_search', description: 'd', parameters: {} }] as any,
      })) as {
        stream: ReadableStream<unknown>
        execution: {
          output: {
            content: string
            tokens: { input: number; output: number; total: number }
          }
        }
      }

      await expect(collect(result.stream)).resolves.toEqual([
        { type: 'text_delta', text: 'Partial answer', turn: 'pending' },
        { type: 'turn_end', turn: 'final' },
      ])
      expect(result.execution.output).toMatchObject({
        content: 'Partial answer',
        tokens: { input: 1, output: 1, total: 2 },
      })
    })

    it('rejects a max_output_tokens turn containing a partial tool call', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          {
            type: 'response.output_item.added',
            output_index: 0,
            sequence_number: 1,
            item: {
              id: 'fc_partial',
              type: 'function_call',
              call_id: 'call_partial',
              name: 'exa_search',
              arguments: '',
              status: 'in_progress',
            },
          },
          {
            type: 'response.function_call_arguments.delta',
            item_id: 'fc_partial',
            output_index: 0,
            sequence_number: 2,
            delta: '{"query":',
          },
          {
            type: 'response.incomplete',
            sequence_number: 3,
            response: {
              id: 'resp_incomplete_tool',
              status: 'incomplete',
              incomplete_details: { reason: 'max_output_tokens' },
              output: [
                {
                  id: 'fc_partial',
                  type: 'function_call',
                  call_id: 'call_partial',
                  name: 'exa_search',
                  arguments: '{"query":',
                  status: 'incomplete',
                },
              ],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ])
      )

      const result = (await run({
        model: 'gpt-5.5',
        stream: true,
        agentEvents: true,
        tools: [{ id: 'exa_search', name: 'exa_search', description: 'd', parameters: {} }] as any,
      })) as { stream: ReadableStream<unknown> }

      await expect(collect(result.stream)).rejects.toThrow(
        'OpenAI Responses stream incomplete: max_output_tokens'
      )
      expect(executeTool).not.toHaveBeenCalled()
    })

    it('aborts the active Responses stream when its consumer cancels', async () => {
      let requestSignal: AbortSignal | undefined
      const encoder = new TextEncoder()
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'response.reasoning_summary_text.delta',
                    item_id: 'rs_1',
                    output_index: 0,
                    summary_index: 0,
                    sequence_number: 1,
                    delta: 'Still working',
                  })}\n\n`
                )
              )
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      })

      const result = (await run({
        model: 'gpt-5.5',
        stream: true,
        agentEvents: true,
        tools: [{ id: 'exa_search', name: 'exa_search', description: 'd', parameters: {} }] as any,
      })) as { stream: ReadableStream<unknown> }

      const reader = result.stream.getReader()
      expect(await reader.read()).toEqual({
        done: false,
        value: { type: 'thinking_delta', text: 'Still working' },
      })

      await reader.cancel('client disconnected')

      expect(requestSignal?.aborted).toBe(true)
    })
  })
})
