/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { encodedWindowEnd } from '@/lib/sim-search/live/read-window'

const encoded = (text: string) => JSON.stringify(text).length - 2

describe('encodedWindowEnd', () => {
  it('returns the longest window it found to fit when escapes lead the text', () => {
    const content = `${'"'.repeat(1_000)}${'x'.repeat(20_000)}`
    const end = encodedWindowEnd(content, 0, 20_000, 8_000)
    expect(end).toBe(19_000)
    expect(encoded(content.slice(0, end))).toBeLessThanOrEqual(20_000)
  })
})
