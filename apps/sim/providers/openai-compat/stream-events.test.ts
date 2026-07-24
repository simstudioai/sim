/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  openaiCompatReasoningAndTextChunks,
  openaiCompatTextOnlyChunks,
  openaiCompatToolCallStartChunks,
} from '@/providers/__fixtures__/openai-compat'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent } from '@/providers/stream-events'

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

describe('createOpenAICompatibleAgentEventStream', () => {
  it('emits thinking_delta from reasoning_content then text_delta', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatReasoningAndTextChunks as any
      })(),
      { providerName: 'DeepSeek', onComplete }
    )

    const events = await collectEvents(stream)
    expect(events.filter((e) => e.type === 'thinking_delta').map((e) => e.text)).toEqual([
      'I should compute carefully. ',
      'Answer is 4.',
    ])
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', text: '2+2=', turn: 'final' },
      { type: 'text_delta', text: '4', turn: 'final' },
    ])
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      content: '2+2=4',
      thinking: 'I should compute carefully. Answer is 4.',
      usage: { prompt_tokens: 10, completion_tokens: 8 },
    })
  })

  it('stays text-only when no reasoning fields are present', async () => {
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatTextOnlyChunks as any
      })(),
      { providerName: 'Groq' }
    )
    const events = await collectEvents(stream)
    expect(events.every((e) => e.type === 'text_delta')).toBe(true)
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
  })

  it('emits tool_call_start when enabled and id+name are known', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatToolCallStartChunks as any
        yield {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '"https://x"}' } }],
              },
            },
          ],
        }
      })(),
      { providerName: 'Groq', emitToolCallStarts: true, onComplete }
    )
    const events = await collectEvents(stream)
    expect(events).toContainEqual({
      type: 'tool_call_start',
      id: 'call_abc',
      name: 'http_request',
    })
    // Only once even if later deltas omit id
    expect(events.filter((e) => e.type === 'tool_call_start')).toHaveLength(1)
    expect(onComplete.mock.calls[0][0].toolCalls).toEqual([
      {
        id: 'call_abc',
        type: 'function',
        function: { name: 'http_request', arguments: '{"url":"https://x"}' },
      },
    ])
  })

  it('keeps a synthesized tool id stable when the vendor id arrives after start', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        // Name first (no id) → start emits with a synthesized id.
        yield {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { name: 'lookup', arguments: '{"q"' } }],
              },
            },
          ],
        } as any
        // Vendor id arrives late — must not rename the started call.
        yield {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call_real', function: { arguments: ':1}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        } as any
      })(),
      { providerName: 'Loose', emitToolCallStarts: true, onComplete }
    )

    const events = await collectEvents(stream)
    const start = events.find((e) => e.type === 'tool_call_start')
    expect(start).toBeDefined()
    expect(start!.id).not.toBe('call_real')

    // The assembled call keeps the same id as the emitted start.
    const assembled = onComplete.mock.calls[0][0].toolCalls
    expect(assembled).toHaveLength(1)
    expect(assembled[0].id).toBe(start!.id)
    expect(assembled[0].function).toEqual({ name: 'lookup', arguments: '{"q":1}' })
  })

  it('always enqueues text deltas live and assembles content for onComplete', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatTextOnlyChunks as any
      })(),
      { providerName: 'DeepSeek', onComplete }
    )
    const events = await collectEvents(stream)
    expect(
      events
        .filter((e) => e.type === 'text_delta')
        .map((e) => e.text)
        .join('')
    ).toBe('Hello world')
    expect(onComplete.mock.calls[0][0].content).toBe('Hello world')
  })
})
