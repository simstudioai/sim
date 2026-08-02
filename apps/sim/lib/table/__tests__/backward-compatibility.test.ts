/**
 * @vitest-environment node
 *
 * Backward-compatibility guards for columns and data that predate the
 * column-type registry work.
 *
 * The registry consolidation rewrote how every consumer answers per-type
 * questions — casts, coercion, filter operands, display, import. None of that
 * is allowed to change what an EXISTING table does, and most of it would fail
 * silently if it did: a wrong cast makes a filter error, a wrong operand makes
 * it return the wrong rows, a wrong coercion nulls a cell on the next write.
 *
 * So these pin the legacy behaviour directly rather than testing the new code.
 * A "legacy column" here means one carrying none of the metadata keys the work
 * added (`precision`, `includeTime`, option `color`) — which is every column
 * that existed before it, since no migration backfills them.
 */
import { describe, expect, it } from 'vitest'
import { COLUMN_TYPE_REGISTRY } from '@/lib/table/column-types'
import { coerceValue, inferColumnType } from '@/lib/table/import'
import { buildFilterClause, buildSortClause } from '@/lib/table/sql'
import type { ColumnDefinition, Filter, JsonValue, Sort } from '@/lib/table/types'
import { validateColumnDefinition } from '@/lib/table/validation'

/** Every type that existed before this work, in a legacy (bare) definition. */
const LEGACY_COLUMNS: ColumnDefinition[] = [
  { id: 'c', name: 'c', type: 'string' },
  { id: 'c', name: 'c', type: 'number' },
  { id: 'c', name: 'c', type: 'boolean' },
  { id: 'c', name: 'c', type: 'date' },
  { id: 'c', name: 'c', type: 'json' },
  { id: 'c', name: 'c', type: 'currency' },
  { id: 'c', name: 'c', type: 'select', options: [{ id: 'o1', name: 'One' }] },
]

const TABLE = 'user_table_rows'

/**
 * Flattens a drizzle SQL node into readable text with its operands inlined, so
 * a case can assert on the emitted cast and operand rather than on an opaque
 * object. Handles the two shapes the builders produce: a template chunk
 * (`strings`/`values`) and a joined list (`fragments`).
 */
function render(clause: unknown): string {
  if (clause === null || clause === undefined) return ''
  const node = clause as {
    strings?: string[]
    values?: unknown[]
    fragments?: unknown[]
    rawSql?: string
  }
  if (node.rawSql !== undefined) return node.rawSql
  if (node.fragments) return node.fragments.map(render).join(' ')
  if (node.strings) {
    const values = (node.values ?? []).map(render)
    return node.strings.map((part, i) => part + (values[i] ?? '')).join('')
  }
  return typeof clause === 'string' ? clause : JSON.stringify(clause)
}

describe('legacy column definitions stay valid', () => {
  it.each(LEGACY_COLUMNS)('accepts a bare $type column with no new metadata', (column) => {
    // No migration backfills the new keys, so every pre-existing column reaches
    // the validator without them. Requiring one would reject the entire schema
    // of every existing table on its next write.
    const result = validateColumnDefinition(column)
    expect(result.valid, result.errors.join('; ')).toBe(true)
  })

  it('does not require a select option to carry a colour', () => {
    // `color` is additive; options written before it have none.
    const column: ColumnDefinition = {
      name: 'c',
      type: 'select',
      options: [{ id: 'o1', name: 'One' }],
    }
    expect(validateColumnDefinition(column).valid).toBe(true)
  })
})

describe('legacy cell values survive the write path unchanged', () => {
  it.each([
    ['string', 'hello', 'hello'],
    ['string', '123', '123'],
    ['number', 42, 42],
    ['number', '42', 42],
    ['number', '1e3', 1000],
    ['number', '-2.5', -2.5],
    ['boolean', true, true],
    ['boolean', 'true', true],
    ['boolean', 'false', false],
    ['currency', 1234.56, 1234.56],
    ['currency', '$1,234.56', 1234.56],
    ['date', '2024-01-15', '2024-01-15'],
  ] as Array<[ColumnDefinition['type'], JsonValue, JsonValue]>)(
    '%s coerces %s to %s exactly as before',
    (type, input, expected) => {
      const column = LEGACY_COLUMNS.find((c) => c.type === type)
      if (!column) throw new Error(`no legacy column for ${type}`)
      const result = COLUMN_TYPE_REGISTRY[type].coerce(input, column)
      expect(result.ok && result.value).toEqual(expected)
    }
  )

  it('keeps a legacy date column storing full instants', () => {
    // `includeTime` absent means "predates the key", NOT date-only. Truncating
    // here would destroy the time of day on the next write to any cell of every
    // date column that already exists.
    const legacy = LEGACY_COLUMNS.find((c) => c.type === 'date')
    if (!legacy) throw new Error('no legacy date column')
    const result = COLUMN_TYPE_REGISTRY.date.coerce(1700000000000, legacy)
    expect(result.ok && result.value).toBe('2023-11-14T22:13:20.000Z')
  })

  it('renders a legacy number column with no precision exactly as stored', () => {
    // `precision` absent must not force decimals; a stored 1.5 stays "1.5".
    const legacy = LEGACY_COLUMNS.find((c) => c.type === 'number')
    if (!legacy) throw new Error('no legacy number column')
    expect(COLUMN_TYPE_REGISTRY.number.formatForDisplay(1.5, legacy)).toBe('1.5')
    expect(COLUMN_TYPE_REGISTRY.number.formatForDisplay(0.1 + 0.2, legacy)).toBe(
      '0.30000000000000004'
    )
  })
})

describe('filter compilation is unchanged for pre-existing types', () => {
  it('casts a number column to numeric', () => {
    const out = render(buildFilterClause({ c: { $gt: 5 } } as Filter, TABLE, [LEGACY_COLUMNS[1]]))
    expect(out).toContain(`(${TABLE}.data->>'c')::numeric`)
  })

  it('casts a date column to timestamptz', () => {
    const out = render(
      buildFilterClause({ c: { $gte: '2024-01-01' } } as Filter, TABLE, [LEGACY_COLUMNS[3]])
    )
    expect(out).toContain(`(${TABLE}.data->>'c')::timestamptz`)
    // A bare calendar date passes through untouched.
    expect(out).toContain('2024-01-01')
  })

  it('compares a string column as text and keeps a numeric-looking operand a string', () => {
    const out = render(
      buildFilterClause({ c: { $eq: '123' } } as Filter, TABLE, [LEGACY_COLUMNS[0]])
    )
    // JSONB containment distinguishes "123" from 123.
    expect(out).toContain('"c":"123"')
  })

  it('keeps ::numeric for a field with NO schema entry', () => {
    // Ad-hoc fields have always compared numerically. Switching them to
    // lexicographic would change a saved filter's row set with no error —
    // `'10' > '5'` is false as text.
    const out = render(buildFilterClause({ ghost: { $gt: 5 } } as Filter, TABLE, []))
    expect(out).toContain(`(${TABLE}.data->>'ghost')::numeric`)
  })

  it.each(['boolean', 'json'] as const)('still refuses a range operator on %s', (type) => {
    const column = LEGACY_COLUMNS.find((c) => c.type === type)
    if (!column) throw new Error(`no legacy column for ${type}`)
    expect(() => buildFilterClause({ c: { $gt: 1 } } as Filter, TABLE, [column])).toThrow(
      /no ordering/
    )
  })

  it('still refuses a range operator on select and rejects a bad operand type', () => {
    expect(() =>
      buildFilterClause({ c: { $gt: 1 } } as Filter, TABLE, [LEGACY_COLUMNS[6]])
    ).toThrow()
    expect(() =>
      buildFilterClause({ c: { $gte: 1704067200000 } } as Filter, TABLE, [LEGACY_COLUMNS[3]])
    ).toThrow(/requires a date string, got number/)
  })

  it('keeps a select option id verbatim rather than coercing it', () => {
    // An id of "1" coerced to the number 1 would compare against the stored
    // JSON string by containment and match nothing.
    const column: ColumnDefinition = {
      id: 'c',
      name: 'c',
      type: 'select',
      options: [{ id: '1', name: 'One' }],
    }
    const out = render(buildFilterClause({ c: { $eq: '1' } } as Filter, TABLE, [column]))
    expect(out).toContain('"c":"1"')
  })
})

describe('sort ordering is unchanged for pre-existing types', () => {
  it.each([
    ['number', '::numeric'],
    ['date', '::timestamptz'],
  ] as const)('sorts a %s column with %s', (type, cast) => {
    const column = LEGACY_COLUMNS.find((c) => c.type === type)
    if (!column) throw new Error(`no legacy column for ${type}`)
    const out = render(buildSortClause({ c: 'asc' } as Sort, TABLE, [column]))
    expect(out).toContain(cast)
  })

  it('sorts a select column by option NAME, not by the stored id', () => {
    const out = render(buildSortClause({ c: 'asc' } as Sort, TABLE, [LEGACY_COLUMNS[6]]))
    expect(out).toContain('One')
  })
})

describe('CSV import is unchanged for pre-existing shapes', () => {
  it.each([
    [['1', '2', '3'], 'number'],
    [['000123', '000456'], 'number'],
    [['true', 'false'], 'boolean'],
    [['2024-01-15', '2024-02-20'], 'date'],
    [['hello', 'world'], 'string'],
    [['$1,234.56', '$2.00'], 'string'],
    [['ada@example.com', 'bob@example.com'], 'string'],
    [['+1 555 123 4567', '+44 20 7123 4567'], 'string'],
  ] as Array<[string[], string]>)('infers %s as %s', (values, expected) => {
    // Email and phone are deliberately NOT inferred: inference reads a 100-row
    // sample while the write path coerces every row and nulls what the type
    // rejects, so a later dirty value would be silently destroyed.
    expect(inferColumnType(values)).toBe(expected)
  })

  it.each([
    ['string', 'hello', 'hello'],
    ['number', '42', 42],
    ['boolean', 'true', true],
    ['currency', '$1,234.56', 1234.56],
  ] as Array<[ColumnDefinition['type'], string, JsonValue]>)(
    'coerces an imported %s cell to %s',
    (type, input, expected) => {
      expect(coerceValue(input, type)).toEqual(expected)
    }
  )

  it('keeps an unparseable text cell verbatim rather than nulling it', () => {
    // A text-cast column preserves the raw string so the row error can name the
    // offending input. Only cast columns null.
    expect(coerceValue('not a number', 'string')).toBe('not a number')
  })
})

describe('export is unchanged for pre-existing types', () => {
  it.each([
    ['string', 'hello', 'hello'],
    ['number', 1.5, '1.5'],
    ['boolean', true, 'true'],
    ['currency', 1234.56, '$1,234.56'],
  ] as Array<[ColumnDefinition['type'], JsonValue, string]>)(
    'formats a %s cell as %s',
    (type, value, expected) => {
      const column = LEGACY_COLUMNS.find((c) => c.type === type)
      if (!column) throw new Error(`no legacy column for ${type}`)
      expect(COLUMN_TYPE_REGISTRY[type].formatForDisplay(value, column)).toBe(expected)
    }
  )

  it('resolves a select cell to its option NAME', () => {
    expect(COLUMN_TYPE_REGISTRY.select.formatForDisplay('o1', LEGACY_COLUMNS[6])).toBe('One')
  })
})
