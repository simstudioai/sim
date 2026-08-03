/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_TTS_TEXT_LENGTH } from '@/lib/api/contracts/media/tts-stream'
import { splitForSynthesis } from '@/app/(interfaces)/chat/hooks/use-audio-streaming'

describe('splitForSynthesis', () => {
  it('leaves text within the relay cap untouched', () => {
    expect(splitForSynthesis('Short answer.')).toEqual(['Short answer.'])
  })

  /**
   * The caller only sentence-splits on Western `.!?`, so CJK punctuation never
   * matches and the whole answer arrives as one block. Before splitting, the
   * relay rejected it and the message played no audio at all.
   */
  it('splits CJK text that never matches the Western sentence split', () => {
    const text = '这是一个很长的回答。'.repeat(400)
    expect(text.length).toBeGreaterThan(MAX_TTS_TEXT_LENGTH)

    const chunks = splitForSynthesis(text)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_TTS_TEXT_LENGTH)
    }
  })

  it('splits a long list that has no terminal punctuation', () => {
    const text = Array.from({ length: 300 }, (_, i) => `- item number ${i}`).join('\n')
    expect(text.length).toBeGreaterThan(MAX_TTS_TEXT_LENGTH)

    const chunks = splitForSynthesis(text)

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_TTS_TEXT_LENGTH)
    }
  })

  it('preserves the spoken content across chunks', () => {
    const text = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')

    const chunks = splitForSynthesis(text)

    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text)
  })

  it('still caps text with no break opportunity at all', () => {
    const chunks = splitForSynthesis('a'.repeat(MAX_TTS_TEXT_LENGTH * 2 + 5))

    expect(chunks.length).toBe(3)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_TTS_TEXT_LENGTH)
    }
  })
})
