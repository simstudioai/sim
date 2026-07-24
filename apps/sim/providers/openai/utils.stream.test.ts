/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { createReadableStreamFromResponses } from '@/providers/openai/utils'
import type { AgentStreamEvent } from '@/providers/stream-events'

function sseResponse(events: Array<{ event?: string; data: unknown }>): Response {
  const body = events
    .map((e) => {
      const lines = []
      if (e.event) lines.push(`event: ${e.event}`)
      lines.push(`data: ${JSON.stringify(e.data)}`)
      return `${lines.join('\n')}\n\n`
    })
    .join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

async function collectEvents(
  stream: ReadableStream<AgentStreamEvent>
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }
  return events
}

describe('createReadableStreamFromResponses', () => {
  it('emits reasoning summary deltas as thinking and output_text as final text', async () => {
    const onComplete = vi.fn()
    const response = sseResponse([
      {
        event: 'response.reasoning_summary_text.delta',
        data: { type: 'response.reasoning_summary_text.delta', delta: 'Summary thought. ' },
      },
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: 'Answer' },
      },
      {
        event: 'response.completed',
        data: {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 4, output_tokens: 6 },
          },
        },
      },
    ])

    const events = await collectEvents(createReadableStreamFromResponses(response, onComplete))
    expect(events).toEqual([
      { type: 'thinking_delta', text: 'Summary thought. ' },
      { type: 'text_delta', text: 'Answer', turn: 'final' },
    ])
    expect(onComplete.mock.calls[0][0]).toBe('Answer')
    expect(onComplete.mock.calls[0][2]).toBe('Summary thought. ')
  })

  it('stays text-only when no reasoning summary events arrive', async () => {
    const response = sseResponse([
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: 'Hi' },
      },
      {
        event: 'response.completed',
        data: {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      },
    ])
    const events = await collectEvents(createReadableStreamFromResponses(response))
    expect(events).toEqual([{ type: 'text_delta', text: 'Hi', turn: 'final' }])
  })

  it('streams refusal text as the model answer', async () => {
    const response = sseResponse([
      {
        event: 'response.refusal.delta',
        data: { type: 'response.refusal.delta', delta: "I can't help with that." },
      },
      {
        event: 'response.completed',
        data: {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 1, output_tokens: 5 },
          },
        },
      },
    ])

    const events = await collectEvents(createReadableStreamFromResponses(response))
    expect(events).toEqual([{ type: 'text_delta', text: "I can't help with that.", turn: 'final' }])
  })

  it('finalizes truncated text when max_output_tokens is the only incomplete condition', async () => {
    const onComplete = vi.fn()
    const response = sseResponse([
      {
        event: 'response.output_text.delta',
        data: { type: 'response.output_text.delta', delta: 'Truncated answer' },
      },
      {
        event: 'response.incomplete',
        data: {
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [],
            usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
          },
        },
      },
    ])

    const events = await collectEvents(createReadableStreamFromResponses(response, onComplete))

    expect(events).toEqual([{ type: 'text_delta', text: 'Truncated answer', turn: 'final' }])
    expect(onComplete).toHaveBeenCalledWith(
      'Truncated answer',
      {
        promptTokens: 3,
        completionTokens: 5,
        totalTokens: 8,
        cachedTokens: 0,
        reasoningTokens: 0,
      },
      undefined
    )
  })

  it('rejects a max_output_tokens response with a partial function call', async () => {
    const response = sseResponse([
      {
        event: 'response.output_item.added',
        data: {
          type: 'response.output_item.added',
          item: {
            id: 'fc_partial',
            type: 'function_call',
            call_id: 'call_partial',
            name: 'lookup',
            arguments: '',
            status: 'in_progress',
          },
        },
      },
      {
        event: 'response.function_call_arguments.delta',
        data: {
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_partial',
          output_index: 0,
          delta: '{"query":',
        },
      },
      {
        event: 'response.incomplete',
        data: {
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [],
            usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
          },
        },
      },
    ])

    await expect(collectEvents(createReadableStreamFromResponses(response))).rejects.toThrow(
      'OpenAI Responses stream incomplete: max_output_tokens'
    )
  })

  it('continues rejecting non-token-cap incomplete responses', async () => {
    const response = sseResponse([
      {
        event: 'response.incomplete',
        data: {
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'content_filter' },
            output: [],
          },
        },
      },
    ])

    await expect(collectEvents(createReadableStreamFromResponses(response))).rejects.toThrow(
      'OpenAI Responses stream incomplete: content_filter'
    )
  })
})
