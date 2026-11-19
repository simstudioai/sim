import { describe, expect, it } from 'vitest'
import { formatDuration, formatLowerBound, getTimezoneAbbreviation } from './formatting.js'

describe('getTimezoneAbbreviation', () => {
  it('resolves a valid IANA timezone outside the hardcoded map via Intl instead of the raw string', () => {
    const result = getTimezoneAbbreviation('Europe/Berlin', new Date('2023-01-15'))
    expect(result).not.toBe('Europe/Berlin')
  })
})

describe('getTimezoneAbbreviation daylight handling', () => {
  it('uses the standard abbreviation for a winter date in a northern zone', () => {
    const winter = new Date('2026-01-15T12:00:00Z')
    expect(getTimezoneAbbreviation('America/Los_Angeles', winter)).toBe('PST')
    expect(getTimezoneAbbreviation('Europe/London', winter)).toBe('GMT')
    expect(getTimezoneAbbreviation('America/New_York', winter)).toBe('EST')
  })

  it('uses the daylight abbreviation for a summer date in a northern zone', () => {
    const summer = new Date('2026-07-15T12:00:00Z')
    expect(getTimezoneAbbreviation('America/Los_Angeles', summer)).toBe('PDT')
    expect(getTimezoneAbbreviation('Europe/London', summer)).toBe('BST')
    expect(getTimezoneAbbreviation('Europe/Paris', summer)).toBe('CEST')
  })

  it('reads the southern-hemisphere seasons the other way round', () => {
    const january = new Date('2026-01-15T12:00:00Z')
    const july = new Date('2026-07-15T12:00:00Z')
    expect(getTimezoneAbbreviation('Australia/Sydney', january)).toBe('AEDT')
    expect(getTimezoneAbbreviation('Australia/Sydney', july)).toBe('AEST')
  })

  it('keeps the standard abbreviation for zones without daylight time', () => {
    expect(getTimezoneAbbreviation('Asia/Tokyo', new Date('2026-01-15T12:00:00Z'))).toBe('JST')
    expect(getTimezoneAbbreviation('Asia/Singapore', new Date('2026-07-15T12:00:00Z'))).toBe('SGT')
  })
})

describe('formatDuration', () => {
  it('formats sub-millisecond durations', () => {
    expect(formatDuration(0.5)).toBe('0.50ms')
    expect(formatDuration(0.001)).toBe('0ms')
  })
})

describe('formatLowerBound', () => {
  it('keeps counts under 100 exact', () => {
    expect(formatLowerBound(0)).toBe('0+')
    expect(formatLowerBound(66)).toBe('66+')
  })

  it('rounds down to two significant figures, never up', () => {
    expect(formatLowerBound(999)).toBe('990+')
    expect(formatLowerBound(5499)).toBe('5,400+')
  })
})
