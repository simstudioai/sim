import { describe, expect, it } from 'vitest'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import type { TimeSegment } from '@/providers/types'

describe('Chat Completions model traces', () => {
  it('projects Mistral text blocks into answer text without exposing thinking blocks', () => {
    const segments: TimeSegment[] = [
      { type: 'model', name: 'mistral-large-4', startTime: 0, endTime: 1, duration: 1 },
    ]
    enrichLastModelSegmentFromChatCompletions(
      segments,
      {
        choices: [
          {
            message: {
              content: [
                { type: 'thinking', thinking: [{ type: 'text', text: 'Private thought.' }] },
                { type: 'text', text: '{"ok":' },
                { type: 'text', text: 'true}' },
              ],
            },
          },
        ],
      },
      undefined
    )
    expect(segments[0].assistantContent).toBe('{"ok":true}')
  })
})
