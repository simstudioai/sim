/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  formatInstantInTimeZone,
  getSupportedTimezones,
  zonedWallClockToUtc,
} from '@/lib/core/utils/timezone'
import { parseTtlEpochSeconds, ttlColumnType } from '@/lib/table/column-types/ttl'
import { retypeCellRewrite } from '@/lib/table/columns/service'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'

const column = (over: Partial<ColumnDefinition>): ColumnDefinition =>
  ({ name: 'col', type: 'string', ...over }) as ColumnDefinition

describe('TTL column type', () => {
  it('converts epoch seconds to an ISO date before retyping', () => {
    expect(
      retypeCellRewrite(1_700_000_000, column({ type: 'date' }), column({ type: 'ttl' }))
    ).toEqual({ value: '2023-11-14T22:13:20Z' })
  })

  it('keeps blank and malformed TTL values out of the epoch-zero formatter', () => {
    const cases: Array<[unknown, string]> = [
      [null, ''],
      [undefined, ''],
      ['', ''],
      ['   ', '   '],
      [false, 'false'],
      [[], ''],
    ]
    for (const [value, fallback] of cases) {
      expect(ttlColumnType.formatForDisplay(value, column({ type: 'ttl' }))).toBe(fallback)
      expect(ttlColumnType.formatForInput(value, column({ type: 'ttl' }))).toBe(fallback)
    }
  })

  it('preserves blank and malformed TTL values when converting to a date', () => {
    const target = column({ type: 'date' })
    const values: JsonValue[] = [null, '', '   ', false, []]

    for (const value of values) {
      expect(ttlColumnType.valueForConversion?.(value, target)).toEqual(value)
    }
  })

  it.each([
    ['UTC', '2026-06-15T09:00:30', '2026-06-15T09:00:30.000Z'],
    ['America/New_York', '2026-06-15T09:00:30', '2026-06-15T13:00:30.000Z'],
    ['America/New_York', '2026-01-15T09:00:30', '2026-01-15T14:00:30.000Z'],
    ['Asia/Kathmandu', '2026-06-15T09:00:30', '2026-06-15T03:15:30.000Z'],
    ['Australia/Lord_Howe', '2026-06-15T09:00:30', '2026-06-14T22:30:30.000Z'],
  ])('stores %s wall-clock input as the expected epoch second', (timezone, input, iso) => {
    expect(parseTtlEpochSeconds(input, { timezone })).toBe(Date.parse(iso) / 1000)
  })

  it.each([
    ['America/New_York', '2026-11-01T01:30', '2026-11-01T06:30:00.000Z'],
    ['Europe/Berlin', '2026-10-25T02:30', '2026-10-25T01:30:00.000Z'],
    ['Australia/Lord_Howe', '2026-04-05T01:45', '2026-04-04T15:15:00.000Z'],
  ])(
    'chooses the later expiration when %s repeats a wall-clock time',
    (timezone, input, laterInstant) => {
      expect(parseTtlEpochSeconds(input, { timezone })).toBe(Date.parse(laterInstant) / 1000)
    }
  )

  it.each([
    ['America/New_York', '2026-03-08T02:30', '2026-03-08T07:30:00.000Z'],
    ['Europe/Berlin', '2026-03-29T02:30', '2026-03-29T01:30:00.000Z'],
    ['Australia/Lord_Howe', '2026-10-04T02:15', '2026-10-03T15:45:00.000Z'],
  ])(
    'moves a nonexistent %s wall-clock expiration forward across the gap',
    (timezone, input, compatibleInstant) => {
      expect(parseTtlEpochSeconds(input, { timezone })).toBe(Date.parse(compatibleInstant) / 1000)
    }
  )

  it('rounds fractional instants up so expiration is never stored early', () => {
    expect(parseTtlEpochSeconds('2023-11-14T22:13:20.001Z')).toBe(1_700_000_001)
    expect(parseTtlEpochSeconds('2023-11-14T22:13:20.999Z')).toBe(1_700_000_001)
    expect(parseTtlEpochSeconds('2023-11-14T22:13:20.0001Z')).toBe(1_700_000_001)
    expect(parseTtlEpochSeconds('2023-11-14t22:13:20.001Z')).toBe(1_700_000_001)
    expect(parseTtlEpochSeconds('2023-11-14t17:13:20.001', { timezone: 'America/New_York' })).toBe(
      1_700_000_001
    )
    expect(parseTtlEpochSeconds(new Date('2023-11-14T22:13:20.001Z'))).toBe(1_700_000_001)
    expect(parseTtlEpochSeconds('2023-11-14T22:13:20.000Z')).toBe(1_700_000_000)
  })

  it('rounds historical sub-minute timezone offsets toward a later expiration', () => {
    const timezone = 'Africa/Monrovia'
    const exactInstant = Date.parse('1970-01-01T00:44:30Z') / 1000

    expect(parseTtlEpochSeconds('1970-01-01T00:00:00', { timezone })).toBeGreaterThanOrEqual(
      exactInstant
    )

    const editable = ttlColumnType.formatForInput(exactInstant, column({ type: 'ttl' }), {
      timezone,
    })
    expect(editable).toBe('1970-01-01T00:00:00-00:45')
    expect(parseTtlEpochSeconds(editable, { timezone })).toBeGreaterThanOrEqual(exactInstant)
  })

  it('never resolves representative wall clocks early in any supported timezone', () => {
    for (const timezone of getSupportedTimezones()) {
      for (const wallClock of ['1970-01-01T00:00:00', '2026-06-15T09:00:30']) {
        const exactSecond = Math.ceil(
          zonedWallClockToUtc(wallClock, timezone, { ambiguousTime: 'later' }).getTime() / 1000
        )
        expect(
          parseTtlEpochSeconds(wallClock, { timezone }),
          `${timezone} ${wallClock}`
        ).toBeGreaterThanOrEqual(exactSecond)
      }
    }
  })

  it('never moves stored epoch seconds earlier when formatted in any supported timezone', () => {
    for (const timezone of getSupportedTimezones()) {
      for (const seconds of [0, Date.parse('2026-11-01T06:30:00Z') / 1000]) {
        const editable = ttlColumnType.formatForInput(seconds, column({ type: 'ttl' }), {
          timezone,
        })
        expect(
          parseTtlEpochSeconds(editable, { timezone }),
          `${timezone} ${editable}`
        ).toBeGreaterThanOrEqual(seconds)
      }
    }
  })

  it('uses the timezone supplied for each call rather than a previous setting', () => {
    const input = '2026-06-15T09:00:30'

    expect(parseTtlEpochSeconds(input, { timezone: 'America/New_York' })).toBe(
      Date.parse('2026-06-15T13:00:30Z') / 1000
    )
    expect(parseTtlEpochSeconds(input, { timezone: 'Asia/Kathmandu' })).toBe(
      Date.parse('2026-06-15T03:15:30Z') / 1000
    )
    expect(parseTtlEpochSeconds(input, { timezone: 'America/New_York' })).toBe(
      Date.parse('2026-06-15T13:00:30Z') / 1000
    )
  })

  it('round-trips the same epoch after the editor timezone changes', () => {
    const seconds = Date.parse('2026-11-01T06:30:00Z') / 1000

    for (const timezone of [
      'UTC',
      'America/Los_Angeles',
      'America/New_York',
      'Asia/Kathmandu',
      'Australia/Lord_Howe',
    ]) {
      const editable = ttlColumnType.formatForInput(seconds, column({ type: 'ttl' }), { timezone })
      expect(editable).toBe(formatInstantInTimeZone(new Date(seconds * 1000), timezone))
      expect(parseTtlEpochSeconds(editable, { timezone })).toBe(seconds)
    }
  })

  it('round-trips a low-year expiration through the editor', () => {
    const input = '0050-01-15T12:00:00'
    const seconds = parseTtlEpochSeconds(input, { timezone: 'UTC' })

    expect(seconds).toBe(Date.parse(`${input}Z`) / 1000)
    const editable = ttlColumnType.formatForInput(seconds, column({ type: 'ttl' }), {
      timezone: 'UTC',
    })
    expect(editable).toBe(`${input}Z`)
    expect(parseTtlEpochSeconds(editable, { timezone: 'UTC' })).toBe(seconds)
  })

  it('keeps the TTL repeated-hour policy separate from ordinary date behavior', () => {
    const input = '2026-11-01T01:30'
    const timezone = 'America/New_York'

    expect(zonedWallClockToUtc(input, timezone, { ambiguousTime: 'earlier' }).toISOString()).toBe(
      '2026-11-01T05:30:00.000Z'
    )
    expect(parseTtlEpochSeconds(input, { timezone })).toBe(
      Date.parse('2026-11-01T06:30:00Z') / 1000
    )
  })
})
