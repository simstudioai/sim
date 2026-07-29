/**
 * @vitest-environment node
 *
 * Anthropic adapter emits AgentStreamEvent objects (thinking + text)
 * from Messages stream fixtures; tool_use deltas are handled by the tool loop.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  anthropicRedactedThinkingExpectedText,
  anthropicRedactedThinkingExpectedTraceThinking,
  anthropicRedactedThinkingStreamEvents,
  anthropicThinkingTextToolExpectedText,
  anthropicThinkingTextToolExpectedThinking,
  anthropicThinkingTextToolStreamEvents,
} from '@/providers/__fixtures__/anthropic'
import { createReadableStreamFromAnthropicStream } from '@/providers/anthropic/utils'
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

describe('createReadableStreamFromAnthropicStream', () => {
  it('emits thinking_delta then text_delta and ignores tool_use (thinking+text+tool fixture)', async () => {
    const onComplete = vi.fn()
    const stream = createReadableStreamFromAnthropicStream(
      (async function* () {
        yield* anthropicThinkingTextToolStreamEvents
      })() as AsyncIterable<any>,
      onComplete
    )

    const events = await collectEvents(stream)

    expect(events.filter((e) => e.type === 'thinking_delta').map((e) => e.text)).toEqual([
      'I should check the weather before answering. ',
      'Calling get_weather for SF.',
    ])
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([
      {
        type: 'text_delta',
        text: anthropicThinkingTextToolExpectedText,
        turn: 'final',
      },
    ])
    expect(events.some((e) => e.type === 'tool_call_start' || e.type === 'tool_call_end')).toBe(
      false
    )

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      content: anthropicThinkingTextToolExpectedText,
      thinking: anthropicThinkingTextToolExpectedThinking,
      usage: { input: 42, output: expect.any(Number) },
    })
  })

  it('captures stream cache usage once from cumulative message events', async () => {
    const onComplete = vi.fn()
    const stream = createReadableStreamFromAnthropicStream(
      (async function* () {
        yield {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 10,
              output_tokens: 0,
              cache_read_input_tokens: 20,
              cache_creation_input_tokens: 30,
              cache_creation: {
                ephemeral_5m_input_tokens: 10,
                ephemeral_1h_input_tokens: 20,
              },
            },
          },
        }
        yield {
          type: 'message_delta',
          usage: {
            input_tokens: 10,
            output_tokens: 40,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 30,
          },
        }
      })() as AsyncIterable<any>,
      onComplete
    )

    await collectEvents(stream)

    expect(onComplete.mock.calls[0][0].usage).toEqual({
      input: 10,
      output: 40,
      cacheRead: 20,
      cacheWriteFiveMinute: 10,
      cacheWriteOneHour: 20,
    })
  })

  it('records [redacted] for redacted_thinking blocks and streams text', async () => {
    const onComplete = vi.fn()
    const stream = createReadableStreamFromAnthropicStream(
      (async function* () {
        yield* anthropicRedactedThinkingStreamEvents
      })() as AsyncIterable<any>,
      onComplete
    )

    const events = await collectEvents(stream)
    expect(events.filter((e) => e.type === 'thinking_delta').map((e) => e.text)).toEqual([
      'Visible follow-up reasoning after redaction.',
    ])
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([
      {
        type: 'text_delta',
        text: anthropicRedactedThinkingExpectedText,
        turn: 'final',
      },
    ])
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      content: anthropicRedactedThinkingExpectedText,
      thinking: anthropicRedactedThinkingExpectedTraceThinking,
    })
  })

  it('errors the readable stream when the source throws', async () => {
    const stream = createReadableStreamFromAnthropicStream(
      (async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'partial' },
        }
        throw new Error('provider reset')
      })() as AsyncIterable<any>
    )

    await expect(collectEvents(stream)).rejects.toThrow('provider reset')
  })
})
