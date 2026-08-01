/**
 * @vitest-environment node
 *
 * Round-trip guards for the types added alongside the registry refactor.
 *
 * The property that matters for each is the same one the registry exists to
 * protect: `coerce` is the single write path, so whatever it accepts must be
 * something `validateCell` then agrees is valid and `formatForInput` can hand
 * back to an editor unchanged. A type that coerces into a shape its own
 * validator rejects nulls the cell on the next write, silently.
 */
import { describe, expect, it } from 'vitest'
import { COLUMN_TYPE_REGISTRY, columnTypeById, isValueCompatible } from '@/lib/table/column-types'
import type { ColumnDefinition } from '@/lib/table/types'

const column = (type: ColumnDefinition['type'], extra: Partial<ColumnDefinition> = {}) =>
  ({ name: 'c', type, ...extra }) as ColumnDefinition

describe('email', () => {
  const col = column('email')

  it.each([
    ['  Ada@Example.COM  ', 'ada@example.com'],
    ['person@example.co.uk', 'person@example.co.uk'],
    ['a.b+tag@sub.example.com', 'a.b+tag@sub.example.com'],
  ])('normalizes %s to %s', (input, expected) => {
    const result = COLUMN_TYPE_REGISTRY.email.coerce(input, col)
    expect(result.ok && result.value).toBe(expected)
  })

  it.each(['no-at-sign', 'two @spaces.com', '@example.com', 'a@b', 'a@.com'])(
    'rejects %s',
    (input) => {
      expect(COLUMN_TYPE_REGISTRY.email.coerce(input, col).ok).toBe(false)
    }
  )

  it('case-folds so enrichment matching cannot miss on capitalization', () => {
    const upper = COLUMN_TYPE_REGISTRY.email.coerce('ADA@EXAMPLE.COM', col)
    const lower = COLUMN_TYPE_REGISTRY.email.coerce('ada@example.com', col)
    expect(upper.ok && upper.value).toBe(lower.ok && lower.value)
  })
})

describe('phone', () => {
  const col = column('phone')

  it.each([
    ['+1 (555) 123-4567', '+15551234567'],
    ['555-123-4567', '5551234567'],
    ['+44 20 7123 4567', '+442071234567'],
  ])('normalizes %s to %s', (input, expected) => {
    const result = COLUMN_TYPE_REGISTRY.phone.coerce(input, col)
    expect(result.ok && result.value).toBe(expected)
  })

  it('refuses an extension rather than silently truncating to the wrong number', () => {
    expect(COLUMN_TYPE_REGISTRY.phone.coerce('555-123-4567 x89', col).ok).toBe(false)
  })

  it.each([['12345'], ['1234567890123456'], ['not a phone']])('rejects %s', (input) => {
    expect(COLUMN_TYPE_REGISTRY.phone.coerce(input, col).ok).toBe(false)
  })

  it('keeps a leading + that a numeric cast would have dropped', () => {
    const result = COLUMN_TYPE_REGISTRY.phone.coerce('+15551234567', col)
    expect(result.ok && String(result.value).startsWith('+')).toBe(true)
    expect(columnTypeById('phone').jsonbCast).toBeNull()
  })
})

describe('url', () => {
  const col = column('url')

  it.each([
    ['sim.ai', 'https://sim.ai/'],
    ['https://sim.ai/docs', 'https://sim.ai/docs'],
    ['http://example.com', 'http://example.com/'],
  ])('normalizes %s to %s', (input, expected) => {
    const result = COLUMN_TYPE_REGISTRY.url.coerce(input, col)
    expect(result.ok && result.value).toBe(expected)
  })

  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd'])(
    'refuses the non-http scheme %s, which the grid would render as a live link',
    (input) => {
      expect(COLUMN_TYPE_REGISTRY.url.coerce(input, col).ok).toBe(false)
    }
  )

  it('renders as linkable so the grid promotes it to a chip', () => {
    expect(COLUMN_TYPE_REGISTRY.url.display?.('https://sim.ai', col)).toEqual({
      kind: 'linkable',
      text: 'https://sim.ai',
    })
  })
})

describe('duration', () => {
  const col = column('duration')

  it.each([
    ['1:30', 90],
    ['1:30:00', 5400],
    ['90:00', 5400],
    ['1h 30m', 5400],
    ['45s', 45],
    ['5400', 5400],
    [5400, 5400],
  ])('parses %s to %s seconds', (input, expected) => {
    const result = COLUMN_TYPE_REGISTRY.duration.coerce(input as never, col)
    expect(result.ok && result.value).toBe(expected)
  })

  it.each(['1:75', 'abc', '-5', '1:2:3:4'])('rejects %s', (input) => {
    expect(COLUMN_TYPE_REGISTRY.duration.coerce(input, col).ok).toBe(false)
  })

  it('round-trips display through the editor unchanged', () => {
    const shown = COLUMN_TYPE_REGISTRY.duration.formatForInput(5400, col)
    const reparsed = COLUMN_TYPE_REGISTRY.duration.coerce(shown, col)
    expect(reparsed.ok && reparsed.value).toBe(5400)
  })

  it('refuses to bulk-convert a number column, whose values are not known to be seconds', () => {
    expect(isValueCompatible(90, col)).toBe(false)
    // A single deliberate write still means seconds.
    expect(COLUMN_TYPE_REGISTRY.duration.coerce(90, col).ok).toBe(true)
  })
})

describe('percent', () => {
  const col = column('percent', { precision: 1 })

  it('stores the number as shown, so number <-> percent rewrites no cells', () => {
    const asPercent = COLUMN_TYPE_REGISTRY.percent.coerce('25%', col)
    const asNumber = COLUMN_TYPE_REGISTRY.number.coerce('25', column('number'))
    expect(asPercent.ok && asPercent.value).toBe(25)
    expect(asNumber.ok && asNumber.value).toBe(25)
  })

  it('formats to the column precision and suffixes the sign', () => {
    expect(COLUMN_TYPE_REGISTRY.percent.formatForDisplay(25.55, col)).toBe('25.6%')
  })

  it('leaves the % out of the editor value so it need not be deleted first', () => {
    expect(COLUMN_TYPE_REGISTRY.percent.formatForInput(25, col)).toBe('25')
  })

  it('rejects an out-of-range precision on the column definition', () => {
    expect(
      COLUMN_TYPE_REGISTRY.percent.validateDefinition?.(column('percent', { precision: 99 }))
    ).toHaveLength(1)
    expect(
      COLUMN_TYPE_REGISTRY.percent.validateDefinition?.(column('percent', { precision: 2 }))
    ).toHaveLength(0)
  })
})

describe('number precision', () => {
  it('renders a stored float at the declared precision', () => {
    const col = column('number', { precision: 2 })
    expect(COLUMN_TYPE_REGISTRY.number.formatForDisplay(0.30000000000000004, col)).toBe('0.30')
  })

  it('renders as stored when no precision is declared, so existing columns are untouched', () => {
    expect(COLUMN_TYPE_REGISTRY.number.formatForDisplay(1.5, column('number'))).toBe('1.5')
  })
})

describe('date includeTime', () => {
  it('truncates to a calendar day only when includeTime is explicitly false', () => {
    const dateOnly = column('date', { includeTime: false })
    const result = COLUMN_TYPE_REGISTRY.date.coerce('2024-01-15T13:45:00Z', dateOnly)
    expect(result.ok && result.value).toBe('2024-01-15')
  })

  it('leaves a legacy column (flag absent) storing full instants', () => {
    // Columns predating the key hold instants; defaulting them to date-only
    // would truncate a stored time on the next write to any cell.
    const legacy = column('date')
    const result = COLUMN_TYPE_REGISTRY.date.coerce(1700000000000, legacy)
    expect(result.ok && result.value).toBe('2023-11-14T22:13:20.000Z')
  })

  it('keeps the time when includeTime is on', () => {
    const withTime = column('date', { includeTime: true })
    const result = COLUMN_TYPE_REGISTRY.date.coerce(1700000000000, withTime)
    expect(result.ok && result.value).toBe('2023-11-14T22:13:20.000Z')
  })
})
