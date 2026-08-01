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
import {
  COLUMN_TYPE_REGISTRY,
  columnTypeById,
  isValueCompatible,
  metadataRewritesCells,
  metadataWithoutClears,
  ownedKeysOf,
  ownersOfMetadataKey,
  pickMetadata,
} from '@/lib/table/column-types'
import { coerceValue } from '@/lib/table/import'
import { filterRulesToFilter, prunePredicateForColumns } from '@/lib/table/query-builder/converters'
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

describe('audit regressions', () => {
  it('truncates a date-only column on the calendar-day PREFIX, not a fixed slice', () => {
    // `0001-01-01T00:00:00Z` is .NET's DateTime.MinValue and common in exported
    // CSVs. `normalizeDateCellValue` does not pad the year, so slicing 10 chars
    // produced `1-01-01T00` — which coerce accepted and validateCell then
    // rejected, failing the row write.
    const dateOnly = column('date', { includeTime: false })
    const result = COLUMN_TYPE_REGISTRY.date.coerce('0001-01-01T00:00:00Z', dateOnly)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(COLUMN_TYPE_REGISTRY.date.validateCell(result.value, dateOnly)).toBeNull()
  })

  it('accepts a bare host:port URL instead of reading the host as a scheme', () => {
    const col = column('url')
    const result = COLUMN_TYPE_REGISTRY.url.coerce('example.com:8080/path', col)
    expect(result.ok && result.value).toBe('https://example.com:8080/path')
  })

  it('does not mutate a duration cell when the editor opens and closes untouched', () => {
    const col = column('duration')
    const stored = COLUMN_TYPE_REGISTRY.duration.coerce('90.7', col)
    expect(stored.ok).toBe(true)
    if (!stored.ok) return
    const shown = COLUMN_TYPE_REGISTRY.duration.formatForInput(stored.value, col)
    const reopened = COLUMN_TYPE_REGISTRY.duration.coerce(shown, col)
    expect(reopened.ok && reopened.value).toBe(stored.value)
  })

  it('refuses a negative number for a phone rather than storing it positive', () => {
    expect(COLUMN_TYPE_REGISTRY.phone.coerce(-15551234567, column('phone')).ok).toBe(false)
  })

  it('leaves a new percent column rendering values as stored', () => {
    // Stamping a default precision rounded a 12.5 cell to `13%` in the grid AND
    // in the CSV export, and rode back onto `number` through a
    // number -> percent -> number conversion.
    expect(COLUMN_TYPE_REGISTRY.percent.defaultMetadata).toBeUndefined()
    expect(COLUMN_TYPE_REGISTRY.percent.formatForDisplay(12.5, column('percent'))).toBe('12.5%')
  })

  it('names every owner of a shared metadata key', () => {
    expect(
      ownersOfMetadataKey('precision')
        .map((o) => o.id)
        .sort()
    ).toEqual(['number', 'percent'])
  })
})

describe('review-round regressions', () => {
  it('reads a formatted filter value through the column that owns it', () => {
    // `parseScalar` returns NaN for `50%` / `1h` / `$1,234.56`, so the value
    // stayed a string, hit the numeric cast, and the range filter was rejected.
    const cases: Array<[ColumnDefinition['type'], string, number]> = [
      ['percent', '50%', 50],
      ['duration', '1h', 3600],
      ['duration', '1:30', 90],
      ['currency', '$1,234.56', 1234.56],
    ]
    for (const [type, typed, expected] of cases) {
      const col = column(type)
      const rules = [
        { id: 'r1', logicalOperator: 'and' as const, column: 'c', operator: 'gte', value: typed },
      ]
      const filter = filterRulesToFilter(rules, [{ ...col, id: 'c' }])
      expect(filter, `${type} ${typed}`).toEqual({ c: { $gte: expected } })
    }
  })

  it('leaves text- and opaque-id columns on their existing coercion', () => {
    // The type-aware parse must apply ONLY to cast columns. A text column keeps
    // `parseScalar`'s long-standing number coercion, and a select keeps its
    // option id verbatim — an id of "1" coerced to a number would compare
    // against the stored JSON string by containment and match nothing.
    const eq = (value: string, col: ColumnDefinition) =>
      filterRulesToFilter(
        [{ id: 'r1', logicalOperator: 'and' as const, column: 'c', operator: 'eq', value }],
        [{ ...col, id: 'c' }]
      )
    expect(eq('123', column('string'))).toEqual({ c: 123 })
    expect(eq('1', column('select', { options: [{ id: '1', name: 'One' }] }))).toEqual({ c: '1' })
  })

  it('truncates an imported date for a date-only column', () => {
    // CSV import was the one write path that bypassed `applyIncludeTime`.
    const dateOnly = column('date', { includeTime: false })
    expect(coerceValue('2024-01-15T13:45:00Z', 'date', { column: dateOnly })).toBe('2024-01-15')
  })

  it('leaves an imported date alone for a column that carries time', () => {
    const withTime = column('date', { includeTime: true })
    expect(coerceValue('2024-01-15T13:45:00Z', 'date', { column: withTime })).toContain('13:45')
  })
})

describe('review-round-2 regressions', () => {
  it("carries a create payload's precision onto the saved column", () => {
    // `addTableColumn` named options/multiple explicitly and otherwise relied on
    // `defaultMetadata`, which `number`/`percent` deliberately do not declare —
    // so a precision accepted by the sidebar and the contract was dropped before
    // it ever reached the schema.
    const owned = ownedKeysOf('percent')
    expect(owned).toContain('precision')
    expect(metadataWithoutClears(pickMetadata({ precision: 2 }, owned))).toEqual({ precision: 2 })
  })

  it('marks a date-only toggle as rewriting cells so clients refetch rows', () => {
    // The migration truncates every stored time server-side; a client that
    // treated it as schema-only kept rendering pre-migration values.
    expect(metadataRewritesCells(column('date'), ['includeTime'])).toBe(true)
    // A purely presentational key must NOT force a row refetch.
    expect(metadataRewritesCells(column('currency'), ['currencyCode'])).toBe(false)
    expect(metadataRewritesCells(column('number'), ['precision'])).toBe(false)
  })
})

describe('review-round-4 regressions', () => {
  const selectColumn: ColumnDefinition = {
    id: 'c',
    name: 'c',
    type: 'select',
    options: [{ id: 'opt_1', name: 'One' }],
  }

  it('keeps isNull/isNotNull on a select column through the v2 pruner', () => {
    // The v2 SQL leaf accepts them (they are meaningful on any column and have
    // no `$` equivalent); gating the pruner on the legacy set stripped them
    // client-side before the query ran, silently widening the filter.
    for (const op of ['isNull', 'isNotNull'] as const) {
      const predicate = { all: [{ field: 'c', op }] } as const
      expect(prunePredicateForColumns(predicate, [selectColumn]), op).toEqual(predicate)
    }
  })

  it('still prunes an operator the select grammar genuinely strands', () => {
    // A `contains` left behind by a multi -> single toggle must still go.
    const predicate = { all: [{ field: 'c', op: 'contains' as const, value: 'opt_1' }] }
    expect(prunePredicateForColumns(predicate, [selectColumn])).toBeNull()
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
