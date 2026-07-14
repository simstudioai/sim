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

describe('createReadableStreamFromResponses (Step 9)', () => {
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
    ])
    const events = await collectEvents(createReadableStreamFromResponses(response))
    expect(events).toEqual([{ type: 'text_delta', text: 'Hi', turn: 'final' }])
  })
})
