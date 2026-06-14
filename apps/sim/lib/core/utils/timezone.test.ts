import { describe, expect, it } from 'vitest'
import { getSupportedTimezones, wallClockNow, zonedWallClockToUtc } from './timezone'

describe('zonedWallClockToUtc', () => {
  it('treats a UTC wall-clock as the same instant', () => {
    expect(zonedWallClockToUtc('2026-06-15T09:00', 'UTC').toISOString()).toBe(
      '2026-06-15T09:00:00.000Z'
    )
  })

  it('applies a positive (east-of-UTC) offset (Asia/Kolkata, UTC+5:30)', () => {
    expect(zonedWallClockToUtc('2026-06-15T09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-06-15T03:30:00.000Z'
    )
  })

  it('honors DST: America/New_York is UTC-4 in summer, UTC-5 in winter', () => {
    expect(zonedWallClockToUtc('2026-06-15T09:00', 'America/New_York').toISOString()).toBe(
      '2026-06-15T13:00:00.000Z'
    )
    expect(zonedWallClockToUtc('2026-01-15T09:00', 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:00:00.000Z'
    )
  })

  it('preserves seconds when present', () => {
    expect(zonedWallClockToUtc('2026-07-01T23:59:59', 'UTC').toISOString()).toBe(
      '2026-07-01T23:59:59.000Z'
    )
  })
})

describe('wallClockNow', () => {
  it('returns a naive yyyy-MM-ddTHH:mm string', () => {
    expect(wallClockNow('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})

describe('getSupportedTimezones', () => {
  it('always returns a non-empty list including UTC', () => {
    const zones = getSupportedTimezones()
    expect(zones.length).toBeGreaterThan(0)
    expect(zones).toContain('UTC')
  })
})
