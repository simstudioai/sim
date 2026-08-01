/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { createReadableStreamFromGeminiStream } from '@/providers/google/utils'
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

describe('createReadableStreamFromGeminiStream', () => {
  it('splits thought parts into thinking_delta and answer into text_delta', async () => {
    const onComplete = vi.fn()
    const stream = createReadableStreamFromGeminiStream(
      (async function* () {
        yield {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Reasoning step. ', thought: true },
                  { text: 'Final answer.', thought: false },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 7,
            totalTokenCount: 12,
          },
        } as any
      })(),
      onComplete
    )

    const events = await collectEvents(stream)
    expect(events).toEqual([
      { type: 'thinking_delta', text: 'Reasoning step. ' },
      { type: 'text_delta', text: 'Final answer.', turn: 'final' },
    ])
    expect(onComplete).toHaveBeenCalledWith(
      'Final answer.',
      expect.objectContaining({ promptTokenCount: 5 }),
      'Reasoning step. '
    )
  })

  it('does not invent thinking when only answer text is present', async () => {
    const stream = createReadableStreamFromGeminiStream(
      (async function* () {
        yield {
          text: 'Just text',
          candidates: [{ content: { parts: [{ text: 'Just text' }] } }],
        } as any
      })()
    )
    const events = await collectEvents(stream)
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
    expect(
      events
        .filter((e) => e.type === 'text_delta')
        .map((e) => e.text)
        .join('')
    ).toContain('Just text')
  })

  it('surfaces blocked prompts instead of completing an empty stream', async () => {
    const stream = createReadableStreamFromGeminiStream(
      (async function* () {
        yield {
          promptFeedback: {
            blockReason: 'SAFETY',
            blockReasonMessage: 'Prompt violated safety policy',
          },
        } as any
      })()
    )

    await expect(collectEvents(stream)).rejects.toThrow(
      'Gemini prompt blocked: SAFETY (Prompt violated safety policy)'
    )
  })
})
