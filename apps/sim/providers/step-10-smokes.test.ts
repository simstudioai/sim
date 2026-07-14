/**
 * @vitest-environment node
 *
 * Step 10 smoke: Anthropic thinking+tool fixture, openai-compat thinking,
 * and a non-thinking text-only stream — capability-honest expectations.
 */
import { describe, expect, it } from 'vitest'
import { anthropicThinkingTextToolStreamEvents } from '@/providers/__fixtures__/anthropic'
import {
  openaiCompatReasoningAndTextChunks,
  openaiCompatTextOnlyChunks,
} from '@/providers/__fixtures__/openai-compat'
import { createReadableStreamFromAnthropicStream } from '@/providers/anthropic/utils'
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

describe('Step 10 provider smokes', () => {
  it('Anthropic fixture emits thinking then text (tools ignored on simple util)', async () => {
    const stream = createReadableStreamFromAnthropicStream(
      (async function* () {
        yield* anthropicThinkingTextToolStreamEvents as any
      })()
    )
    const events = await collectEvents(stream)
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(true)
    expect(events.some((e) => e.type === 'text_delta')).toBe(true)
    // Simple Anthropic util does not emit tool_call_* (loop does).
    expect(events.some((e) => e.type === 'tool_call_start')).toBe(false)
  })

  it('openai-compat reasoning model emits thinking_delta', async () => {
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatReasoningAndTextChunks as any
      })(),
      { providerName: 'DeepSeek' }
    )
    const events = await collectEvents(stream)
    expect(events.filter((e) => e.type === 'thinking_delta').length).toBeGreaterThan(0)
    expect(events.some((e) => e.type === 'text_delta')).toBe(true)
  })

  it('openai-compat non-thinking model stays text-only', async () => {
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatTextOnlyChunks as any
      })(),
      { providerName: 'OpenAI' }
    )
    const events = await collectEvents(stream)
    expect(events.every((e) => e.type === 'text_delta')).toBe(true)
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
  })
})
