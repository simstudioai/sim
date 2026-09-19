/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createReadableStreamFromBedrockStream,
  toBedrockConversationUsage,
} from '@/providers/bedrock/utils'
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

describe('createReadableStreamFromBedrockStream', () => {
  it('captures stream cache usage without subtracting it from uncached input', async () => {
    const onComplete = vi.fn()
    await collectEvents(
      createReadableStreamFromBedrockStream(
        (async function* () {
          yield {
            metadata: {
              usage: {
                inputTokens: 10,
                outputTokens: 20,
                totalTokens: 100,
                cacheReadInputTokens: 30,
                cacheWriteInputTokens: 40,
              },
              metrics: { latencyMs: 1 },
            },
          }
        })(),
        onComplete
      )
    )
    expect(toBedrockConversationUsage(onComplete.mock.calls[0][1])).toEqual({
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
    })
  })

  it('retains complete signed reasoning in the final callback while awaiting persistence', async () => {
    const onComplete = vi.fn(async () => {
      await Promise.resolve()
    })
    const stream = createReadableStreamFromBedrockStream(
      (async function* () {
        yield {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { text: 'Think' } },
          },
        }
        yield {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { signature: 'sig' } },
          },
        }
        yield {
          contentBlockDelta: {
            contentBlockIndex: 1,
            delta: { reasoningContent: { redactedContent: new Uint8Array([1, 2]) } },
          },
        }
        yield { contentBlockDelta: { contentBlockIndex: 2, delta: { text: 'Done' } } }
      })(),
      onComplete
    )

    await collectEvents(stream)
    expect(onComplete).toHaveBeenCalledWith(
      'Done',
      { inputTokens: 0, outputTokens: 0 },
      {
        role: 'assistant',
        content: [
          { reasoningContent: { reasoningText: { text: 'Think', signature: 'sig' } } },
          { reasoningContent: { redactedContent: new Uint8Array([1, 2]) } },
          { text: 'Done' },
        ],
      }
    )
  })

  it('emits text only — no tool events (never executed on this path) and no invented thinking', async () => {
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
    expect(events).toEqual([{ type: 'text_delta', text: 'Done', turn: 'final' }])
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
    expect(events.some((e) => e.type === 'tool_call_start')).toBe(false)
    expect(onComplete).toHaveBeenCalledWith(
      'Done',
      { inputTokens: 2, outputTokens: 3 },
      { role: 'assistant', content: [{ text: 'Done' }] }
    )
  })

  it('surfaces Bedrock event-stream exceptions', async () => {
    const stream = createReadableStreamFromBedrockStream(
      (async function* () {
        yield {
          modelStreamErrorException: { message: 'Model stream failed' },
        } as any
      })()
    )

    await expect(collectEvents(stream)).rejects.toThrow('Model stream failed')
  })
})
