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
  metadataRewritesCells,
  metadataWithoutClears,
  ownedKeysOf,
  ownersOfMetadataKey,
  pickMetadata,
} from '@/lib/table/column-types'
import { metadataMigrationFor } from '@/lib/table/column-types/registry.server'
import { buildConvertedColumn } from '@/lib/table/columns/service'
import { coerceValue } from '@/lib/table/import'
import { filterRulesToFilter, prunePredicateForColumns } from '@/lib/table/query-builder/converters'
import type { ColumnDefinition } from '@/lib/table/types'

const column = (type: ColumnDefinition['type'], extra: Partial<ColumnDefinition> = {}) =>
  ({ name: 'c', type, ...extra }) as ColumnDefinition

describe('email validation', () => {
  const col = column('email')
  const coerce = (v: unknown) => COLUMN_TYPE_REGISTRY.email.coerce(v as never, col)

  it.each([
    ['  Ada@Example.COM  ', 'ada@example.com'],
    ['person@example.co.uk', 'person@example.co.uk'],
    ['a.b+tag@sub.example.com', 'a.b+tag@sub.example.com'],
    ["o'brien@example.com", "o'brien@example.com"],
    ['user_name-1@ex-ample.com', 'user_name-1@ex-ample.com'],
  ])('accepts and normalizes %s', (input, expected) => {
    const result = coerce(input)
    expect(result.ok && result.value).toBe(expected)
  })

  it.each([
    ['no-at-sign', 'no @'],
    ['@example.com', 'no local part'],
    ['a@', 'no domain'],
    ['a@b', 'dotless domain'],
    ['a b@example.com', 'whitespace in the local part'],
    ['a..b@example.com', 'consecutive dots in the local part'],
    ['.a@example.com', 'leading dot in the local part'],
    ['a.@example.com', 'trailing dot in the local part'],
    ['a,b@example.com', 'comma — the cell holds a LIST, not one address'],
    ['a;b@example.com', 'semicolon — likewise'],
    ['"quoted name"@example.com', 'quoted local part, deliberately unsupported'],
    ['a@-example.com', 'domain label starting with a hyphen'],
    ['a@example-.com', 'domain label ending with a hyphen'],
    ['a@example..com', 'empty domain label'],
    ['a@example.123', 'numeric TLD'],
    ['a@example.c', 'single-character TLD'],
    ['a@b@c.com', 'two @ signs'],
  ])('rejects %s (%s)', (input) => {
    expect(coerce(input).ok).toBe(false)
  })

  it('enforces the RFC 5321 local-part cap of 64', () => {
    expect(coerce(`${'a'.repeat(64)}@example.com`).ok).toBe(true)
    expect(coerce(`${'a'.repeat(65)}@example.com`).ok).toBe(false)
  })

  it('enforces the RFC 5321 total cap of 254', () => {
    // Built at the boundary with every OTHER limit satisfied — local part 64,
    // each label under 63 — so the total is the only thing under test.
    const local = 'a'.repeat(64)
    const at254 = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`
    expect(`${local}@${at254}`).toHaveLength(254)
    expect(coerce(`${local}@${at254}`).ok).toBe(true)

    const at255 = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`
    expect(`${local}@${at255}`).toHaveLength(255)
    expect(coerce(`${local}@${at255}`).ok).toBe(false)
  })

  it('enforces the 63-character DNS label cap', () => {
    expect(coerce(`a@${'b'.repeat(63)}.com`).ok).toBe(true)
    expect(coerce(`a@${'b'.repeat(64)}.com`).ok).toBe(false)
  })

  it('accepts nothing its own validateCell then rejects', () => {
    for (const input of ['Ada@Example.com', 'a.b+t@x.co.uk', '']) {
      const result = coerce(input)
      expect(result.ok, input).toBe(true)
      if (result.ok) expect(COLUMN_TYPE_REGISTRY.email.validateCell(result.value, col)).toBeNull()
    }
  })

  it('case-folds so enrichment matching cannot miss on capitalization', () => {
    const upper = coerce('ADA@EXAMPLE.COM')
    const lower = coerce('ada@example.com')
    expect(upper.ok && upper.value).toBe(lower.ok && lower.value)
  })
})

describe('phone validation', () => {
  const col = column('phone')
  const coerce = (v: unknown) => COLUMN_TYPE_REGISTRY.phone.coerce(v as never, col)

  it.each([
    ['+1 (555) 123-4567', '+15551234567'],
    ['555-123-4567', '5551234567'],
    ['+44 20 7123 4567', '+442071234567'],
    ['+81-3-1234-5678', '+81312345678'],
    ['  +1.555.123.4567  ', '+15551234567'],
  ])('accepts and normalizes %s', (input, expected) => {
    const result = coerce(input)
    expect(result.ok && result.value).toBe(expected)
  })

  it('keeps a national leading zero, which is a real trunk prefix', () => {
    const result = coerce('020 7123 4567')
    expect(result.ok && result.value).toBe('02071234567')
  })

  it('refuses an E.164 number whose country code starts with 0', () => {
    // No network can route it, so storing it as international would be a lie.
    expect(coerce('+0123456789').ok).toBe(false)
  })

  it.each([
    ['555-123-4567 x89', 'an extension has no E.164 form'],
    ['12345', 'too few digits'],
    ['1234567890123456', 'too many digits'],
    ['not a phone', 'letters'],
    ['+', 'a lone plus'],
    ['555-1234, 555-5678', 'two numbers in one cell'],
    ['555/1234567', 'a slash'],
  ])('rejects %s (%s)', (input) => {
    expect(coerce(input).ok).toBe(false)
  })

  it('accepts a numeric CSV cell but refuses one that cannot be a number', () => {
    expect(coerce(15551234567).ok).toBe(true)
    // Negative would have its sign eaten as a separator and stored positive.
    expect(coerce(-15551234567).ok).toBe(false)
    expect(coerce(1.5).ok).toBe(false)
    // Past MAX_SAFE_INTEGER the value has already lost digits to float64
    // before it reaches us, so it is no longer what the file contained.
    expect(coerce(Number.MAX_SAFE_INTEGER + 2).ok).toBe(false)
  })

  it('never casts to numeric, so the + and leading zeros survive', () => {
    expect(columnTypeById('phone').jsonbCast).toBeNull()
  })

  it('accepts nothing its own validateCell then rejects', () => {
    for (const input of ['+1 (555) 123-4567', '020 7123 4567', '']) {
      const result = coerce(input)
      expect(result.ok, input).toBe(true)
      if (result.ok) expect(COLUMN_TYPE_REGISTRY.phone.validateCell(result.value, col)).toBeNull()
    }
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

describe('review-round-7 regressions', () => {
  it('normalizes a contact filter value so it can match the stored form', () => {
    // Email/Phone canonicalize on write but compare as TEXT, so the earlier
    // `jsonbCast !== null` gate skipped them: the filter was accepted and then
    // matched nothing, because JSONB containment saw `Ada@Example.com` against
    // a stored `ada@example.com`.
    const eq = (value: string, col: ColumnDefinition) =>
      filterRulesToFilter(
        [{ id: 'r1', logicalOperator: 'and' as const, column: 'c', operator: 'eq', value }],
        [{ ...col, id: 'c' }]
      )
    expect(eq('Ada@Example.COM', column('email'))).toEqual({ c: 'ada@example.com' })
    expect(eq('+44 20 7123 4567', column('phone'))).toEqual({ c: '+442071234567' })
    expect(eq('(555) 123-4567', column('phone'))).toEqual({ c: '5551234567' })
  })

  it('leaves a pass-through type on its existing filter coercion', () => {
    const eq = (value: string, col: ColumnDefinition) =>
      filterRulesToFilter(
        [{ id: 'r1', logicalOperator: 'and' as const, column: 'c', operator: 'eq', value }],
        [{ ...col, id: 'c' }]
      )
    expect(eq('123', column('string'))).toEqual({ c: 123 })
    expect(eq('1', column('select', { options: [{ id: '1', name: 'One' }] }))).toEqual({ c: '1' })
  })

  it('declares canonicalization only where coerce actually transforms', () => {
    // The property stated directly: a canonicalizing type turns a valid
    // non-canonical input into something DIFFERENT, and a pass-through type
    // returns it unchanged. Asserting the behaviour rather than the flag is
    // what stops the two drifting.
    const transforms: Array<[ColumnDefinition['type'], string, JsonValue]> = [
      ['email', 'Ada@Example.COM', 'ada@example.com'],
      ['phone', '(555) 123-4567', '5551234567'],
      ['currency', '$1,234.56', 1234.56],
      ['number', '42', 42],
      ['percent', '50%', 50],
      ['date', '01/15/2024', '2024-01-15'],
    ]
    for (const [type, input, expected] of transforms) {
      expect(COLUMN_TYPE_REGISTRY[type].canonicalizesValues, type).toBe(true)
      const result = COLUMN_TYPE_REGISTRY[type].coerce(input, column(type))
      expect(result.ok && result.value, `${type} <- ${input}`).toEqual(expected)
    }

    for (const type of ['string', 'json'] as const) {
      expect(COLUMN_TYPE_REGISTRY[type].canonicalizesValues, type).toBe(false)
    }
    // A pass-through type hands the value straight back.
    const passed = COLUMN_TYPE_REGISTRY.string.coerce('Ada@Example.COM', column('string'))
    expect(passed.ok && passed.value).toBe('Ada@Example.COM')
  })

  it('keeps an explicit metadata clear through a type conversion', () => {
    // `buildConvertedColumn` carries UN-SUPPLIED keys forward from the old
    // column, so an explicit clear must be distinguishable from silence. When
    // the route stripped the null first, this read as "not mentioned" and
    // restored the precision the user had just cleared.
    const from: ColumnDefinition = { name: 'c', type: 'percent', precision: 2 }
    const cleared = buildConvertedColumn(
      from,
      { tableId: 't', columnName: 'c', newType: 'number', precision: null },
      { isSelectType: false, targetMultiple: false }
    )
    expect(cleared.precision).toBeUndefined()

    // Silence still carries the old value across the conversion.
    const carried = buildConvertedColumn(
      from,
      { tableId: 't', columnName: 'c', newType: 'number' },
      { isSelectType: false, targetMultiple: false }
    )
    expect(carried.precision).toBe(2)

    // And an explicit new value still wins.
    const replaced = buildConvertedColumn(
      from,
      { tableId: 't', columnName: 'c', newType: 'number', precision: 4 },
      { isSelectType: false, targetMultiple: false }
    )
    expect(replaced.precision).toBe(4)
  })
})

describe('follow-up fixes', () => {
  it('reads a numeric cell as decimal, not as an alternate base', () => {
    // `Number()` reads `0x10` as 16 and `0b11` as 3. A user typing `0x10`
    // means the text, so parsing it that way stored a value never entered.
    for (const type of ['number', 'percent'] as const) {
      for (const input of ['0x10', '0b11', '0o17', 'Infinity', '1e400']) {
        expect(COLUMN_TYPE_REGISTRY[type].coerce(input, column(type)).ok, `${type} ${input}`).toBe(
          false
        )
      }
      // Exponent notation stays accepted — spreadsheets export it.
      const exp = COLUMN_TYPE_REGISTRY[type].coerce('1e3', column(type))
      expect(exp.ok && exp.value).toBe(1000)
      const neg = COLUMN_TYPE_REGISTRY[type].coerce('-2.5', column(type))
      expect(neg.ok && neg.value).toBe(-2.5)
    }
  })
})

describe('final-audit regressions', () => {
  it('never truncates a legacy date column when includeTime is CLEARED', async () => {
    // Absent is the tri-state's "legacy column, holds instants". Gating the
    // migration on `target.includeTime` being falsy also fired for a cleared
    // key, destroying every stored time of day.
    const migrate = metadataMigrationFor('date')
    expect(migrate).toBeDefined()
    if (!migrate) return
    const ran: string[] = []
    const trx = {
      execute: async () => {
        ran.push('rewrote')
      },
    } as never

    const call = (previous: ColumnDefinition, target: ColumnDefinition) =>
      migrate({ trx, tableId: 't', columnKey: 'c', previous, target, resolved: new Map() })

    // Cleared (absent) on a legacy column: must NOT rewrite.
    await call({ name: 'c', type: 'date' }, { name: 'c', type: 'date' })
    expect(ran).toHaveLength(0)
    // Cleared from an explicit true: must NOT rewrite either.
    await call({ name: 'c', type: 'date', includeTime: true }, { name: 'c', type: 'date' })
    expect(ran).toHaveLength(0)
    // The real transition to date-only DOES rewrite.
    await call(
      { name: 'c', type: 'date', includeTime: true },
      { name: 'c', type: 'date', includeTime: false }
    )
    expect(ran.length).toBeGreaterThan(0)
  })

  it('keeps a select option clear through a retype, like every other key', () => {
    const from: ColumnDefinition = {
      name: 'c',
      type: 'select',
      options: [{ id: 'o1', name: 'One' }],
    }
    // Silence carries the old options across.
    const carried = buildConvertedColumn(
      from,
      { tableId: 't', columnName: 'c', newType: 'select' },
      { isSelectType: true, targetMultiple: false }
    )
    expect(carried.options).toEqual([{ id: 'o1', name: 'One' }])
    // An explicit clear does not silently restore them.
    const cleared = buildConvertedColumn(
      from,
      { tableId: 't', columnName: 'c', newType: 'select', options: null },
      { isSelectType: true, targetMultiple: false }
    )
    expect(cleared.options).toBeUndefined()
  })

  it('shows a non-numeric percent cell rather than hiding it', () => {
    // Returning '' made a drifted cell look empty, which reads as data loss.
    expect(COLUMN_TYPE_REGISTRY.percent.formatForDisplay('n/a', column('percent'))).toBe('n/a')
  })

  it('declares canonicalization for boolean and select, which both transform', () => {
    expect(COLUMN_TYPE_REGISTRY.boolean.canonicalizesValues).toBe(true)
    expect(COLUMN_TYPE_REGISTRY.select.canonicalizesValues).toBe(true)
    // Range comparison on opaque option ids is meaningless.
    expect(COLUMN_TYPE_REGISTRY.select.orderable).toBe(false)
  })

  it('normalizes a phone SEARCH FRAGMENT so a substring filter can meet the stored value', () => {
    const contains = (value: string) =>
      filterRulesToFilter(
        [{ id: 'r1', logicalOperator: 'and' as const, column: 'c', operator: 'contains', value }],
        [{ id: 'c', name: 'c', type: 'phone' }]
      )
    // Stored as +442071234567; a formatted fragment must be stripped to meet it.
    expect(contains('+44 20 7123')).toEqual({ c: { $contains: '+44207123' } })
    expect(contains('(555) 123')).toEqual({ c: { $contains: '555123' } })
    // A fragment with NO digits is left alone — reducing it to '' would make
    // ILIKE '%%' match every row.
    expect(contains('abc')).toEqual({ c: { $contains: 'abc' } })
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
