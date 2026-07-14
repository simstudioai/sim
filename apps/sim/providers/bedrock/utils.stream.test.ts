/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { createReadableStreamFromBedrockStream } from '@/providers/bedrock/utils'
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

describe('createReadableStreamFromBedrockStream (Step 9)', () => {
  it('emits tool_call_start then text; no invented thinking', async () => {
    const onComplete = vi.fn()
    const stream = createReadableStreamFromBedrockStream(
      (async function* () {
        yield {
          contentBlockStart: {
            start: {
              toolUse: { toolUseId: 'tooluse_1', name: 'http_request' },
            },
          },
        } as any
        yield {
          contentBlockDelta: { delta: { text: 'Done' } },
        } as any
        yield {
          metadata: { usage: { inputTokens: 2, outputTokens: 3 } },
        } as any
      })(),
      onComplete
    )

    const events = await collectEvents(stream)
    expect(events).toEqual([
      { type: 'tool_call_start', id: 'tooluse_1', name: 'http_request' },
      { type: 'text_delta', text: 'Done', turn: 'final' },
    ])
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
    expect(onComplete).toHaveBeenCalledWith('Done', { inputTokens: 2, outputTokens: 3 })
  })
})
