import { describe, expect, it } from 'vitest'
import {
  readUsageEventCursor,
  writeUsageEventCursor,
} from '@/lib/billing/application/organization-usage/event-cursor'
import { usageWindowLedgerFilter } from '@/lib/billing/core/usage-analytics'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const start = new Date('2026-08-01T00:00:00.000Z')
const end = new Date('2026-09-01T00:00:00.000Z')
const keys = ['2026-08-15T00:00:00.000Z', 'event-1']

describe('usage event window cursors', () => {
  it.each(['stripe', 'reporting'] as const)(
    'retains the %s predicate when billing settings change',
    (source) => {
      const window = {
        kind: 'period' as const,
        period: { start, end, source, anchorDate: '2026-01-01', interval: 'month' as const },
      }
      const encoded = writeUsageEventCursor(window, keys)
      expect(encoded).not.toBeNull()
      const decoded = readUsageEventCursor(encoded!, 366)
      expect(usageWindowLedgerFilter(decoded.window)).toEqual(usageWindowLedgerFilter(window))
      expect(decoded.cursorKeys).toEqual(keys)
    }
  )

  it.each([
    [],
    ['range', start.toISOString(), end.toISOString()],
    ['other', start.toISOString(), end.toISOString(), ...keys],
    ['range', 'bad-date', end.toISOString(), ...keys],
    ['range', end.toISOString(), start.toISOString(), ...keys],
    ['range', '2000-01-01', end.toISOString(), ...keys],
  ])('rejects malformed or oversized window %j', (...cursor) => {
    expect(() => readUsageEventCursor(cursor, 366)).toThrow(OrchestrationError)
  })

  it.each([
    ['range', '2026-07-31T00:00:00.000Z', end.toISOString(), ...keys],
    ['range', start.toISOString(), '2026-09-02T00:00:00.000Z', ...keys],
    ['range', '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', ...keys],
    ['period', start.toISOString(), end.toISOString(), ...keys],
  ])('rejects a cursor overriding the custom range or its predicate: %j', (...cursor) => {
    expect(() => readUsageEventCursor(cursor, 366, { start, end })).toThrow(
      'Usage event cursor does not match the requested custom range'
    )
  })
})
