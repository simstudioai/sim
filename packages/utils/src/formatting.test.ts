import { describe, expect, it } from 'vitest'
import { formatDuration, getTimezoneAbbreviation } from './formatting.js'

describe('getTimezoneAbbreviation', () => {
  it('resolves a valid IANA timezone outside the hardcoded map via Intl instead of the raw string', () => {
    const result = getTimezoneAbbreviation('Europe/Berlin', new Date('2023-01-15'))
    expect(result).not.toBe('Europe/Berlin')
  })
})

describe('formatDuration', () => {
  it('formats sub-millisecond durations', () => {
    expect(formatDuration(0.5)).toBe('0.50ms')
    expect(formatDuration(0.001)).toBe('0ms')
  })
})
