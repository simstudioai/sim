/**
 * @vitest-environment node
 *
 * SQL Builder Unit Tests
 *
 * Tests the table SQL query builder. Assertions inspect the generated SQL
 * string so cast selection (numeric vs timestamptz) is verified end-to-end.
 *
 * Rendering: `drizzle-orm` is globally mocked in `vitest.setup.ts`. The mock
 * represents tagged-template fragments as `{ strings, values }`, raw fragments
 * as `{ rawSql }`, and joined fragments as `{ fragments, separator }`. The
 * local `renderSql` helper walks that shape recursively so we can assert real
 * substrings like `::timestamptz` against the generated SQL.
 */
import { describe, expect, it } from 'vitest'
import {
  MULTI_SELECT_FILTER_OPERATORS,
  SINGLE_SELECT_FILTER_OPERATORS,
  UI_TO_WIRE_OPERATOR,
} from '@/lib/table/query-builder/constants'
import {
  buildFilterClause,
  buildPredicateClause,
  buildSortClause,
  fieldPredicate,
  MULTI_SELECT_OPERATORS,
  SINGLE_SELECT_OPERATORS,
} from '@/lib/table/sql'
import type { ColumnDefinition, Filter, Sort, TablePredicate } from '@/lib/table/types'

type SqlNode =
  | { strings: ArrayLike<string>; values: unknown[] }
  | { rawSql: string }
  | { fragments: unknown[]; separator: unknown }
  | string
  | number
  | boolean
  | null
  | undefined

function isTemplateNode(n: unknown): n is { strings: ArrayLike<string>; values: unknown[] } {
  return (
    typeof n === 'object' &&
    n !== null &&
    'strings' in n &&
    'values' in n &&
    Array.isArray((n as { values: unknown[] }).values)
  )
}

function isRawNode(n: unknown): n is { rawSql: string } {
  return typeof n === 'object' && n !== null && 'rawSql' in n
}

function isJoinNode(n: unknown): n is { fragments: unknown[]; separator: unknown } {
  return (
    typeof n === 'object' &&
    n !== null &&
    'fragments' in n &&
    Array.isArray((n as { fragments: unknown[] }).fragments)
  )
}

/** Recursively render a mock SQL node into its generated SQL string. */
function renderSql(node: SqlNode | unknown): string {
  if (node == null) return String(node)
  if (isRawNode(node)) return node.rawSql
  if (isJoinNode(node)) {
    const sep = isRawNode(node.separator) ? node.separator.rawSql : ', '
    return node.fragments.map(renderSql).join(sep)
  }
  if (isTemplateNode(node)) {
    const parts: string[] = []
    for (let i = 0; i < node.strings.length; i++) {
      parts.push(node.strings[i])
      if (i < node.values.length) {
        parts.push(renderSql(node.values[i]))
      }
    }
    return parts.join('')
  }
  if (typeof node === 'string') return `'${node}'`
  return String(node)
}

function render(node: unknown): string {
  return renderSql(node)
}

/** fieldPredicate takes a ColumnDefinition; these tests only care about its type. */
function col(type: ColumnDefinition['type'], name = 'c'): ColumnDefinition {
  return { name, type }
}

const TABLE = 'user_table_rows'
const NO_COLUMNS: ColumnDefinition[] = []

describe('SQL Builder', () => {
  describe('buildFilterClause', () => {
    it('returns undefined for empty filter', () => {
      expect(buildFilterClause({}, TABLE, NO_COLUMNS)).toBeUndefined()
    })

    it('handles simple equality via JSONB containment', () => {
      const out = render(buildFilterClause({ name: 'John' }, TABLE, NO_COLUMNS))
      expect(out).toContain('user_table_rows.data @>')
      expect(out).toContain('"name":"John"')
    })

    it('emits ::numeric cast for $gt on a number column', () => {
      const cols: ColumnDefinition[] = [{ name: 'age', type: 'number' }]
      const out = render(buildFilterClause({ age: { $gt: 18 } }, TABLE, cols))
      expect(out).toContain(`(${TABLE}.data->>'age')::numeric > `)
      expect(out).not.toContain('::timestamp')
    })

    it('falls back to ::numeric when column type is unknown', () => {
      const out = render(buildFilterClause({ score: { $gte: 5 } }, TABLE, NO_COLUMNS))
      expect(out).toContain(`(${TABLE}.data->>'score')::numeric >= `)
      expect(out).not.toContain('::timestamp')
    })

    it('handles $eq operator', () => {
      const out = render(buildFilterClause({ status: { $eq: 'active' } }, TABLE, NO_COLUMNS))
      expect(out).toContain('"status":"active"')
    })

    it('handles $ne operator', () => {
      const out = render(buildFilterClause({ status: { $ne: 'deleted' } }, TABLE, NO_COLUMNS))
      expect(out).toContain('NOT (')
      expect(out).toContain('"status":"deleted"')
    })

    it('handles $in with multiple values via OR of containments', () => {
      const out = render(
        buildFilterClause({ status: { $in: ['active', 'pending'] } }, TABLE, NO_COLUMNS)
      )
      expect(out).toContain(' OR ')
      expect(out).toContain('"status":"active"')
      expect(out).toContain('"status":"pending"')
    })

    it('handles $nin', () => {
      const out = render(
        buildFilterClause({ status: { $nin: ['deleted', 'archived'] } }, TABLE, NO_COLUMNS)
      )
      expect(out).toContain('NOT (')
      expect(out).toContain(' AND ')
    })

    it('handles $contains as ILIKE', () => {
      const out = render(buildFilterClause({ name: { $contains: 'john' } }, TABLE, NO_COLUMNS))
      expect(out).toContain(`${TABLE}.data->>'name'`)
      expect(out).toContain('ILIKE')
      expect(out).toContain('%john%')
    })

    it('handles $ncontains as negated ILIKE that surfaces null cells', () => {
      const out = render(buildFilterClause({ name: { $ncontains: 'john' } }, TABLE, NO_COLUMNS))
      expect(out).toContain('IS NULL')
      expect(out).toContain('NOT ILIKE')
      expect(out).toContain('%john%')
    })

    it('handles $startsWith with a trailing wildcard only', () => {
      const out = render(buildFilterClause({ name: { $startsWith: 'jo' } }, TABLE, NO_COLUMNS))
      expect(out).toContain('ILIKE')
      expect(out).toContain('jo%')
      expect(out).not.toContain('%jo%')
    })

    it('handles $endsWith with a leading wildcard only', () => {
      const out = render(buildFilterClause({ file: { $endsWith: '.pdf' } }, TABLE, NO_COLUMNS))
      expect(out).toContain('ILIKE')
      expect(out).toContain('%.pdf')
    })

    it('escapes ILIKE wildcards in pattern values', () => {
      const out = render(buildFilterClause({ name: { $contains: '50%_off' } }, TABLE, NO_COLUMNS))
      expect(out).toContain('50\\%\\_off')
    })

    it('rejects an empty pattern value rather than matching every row', () => {
      for (const op of ['$contains', '$ncontains', '$startsWith', '$endsWith'] as const) {
        expect(() =>
          buildFilterClause({ name: { [op]: '' } } as Filter, TABLE, NO_COLUMNS)
        ).toThrow(/requires a non-empty value/)
      }
    })

    it('handles $empty: true as null-or-empty-string check', () => {
      const out = render(buildFilterClause({ phone: { $empty: true } }, TABLE, NO_COLUMNS))
      expect(out).toContain(`${TABLE}.data->>'phone'`)
      expect(out).toContain('IS NULL')
      expect(out).toContain("= ''")
      expect(out).toContain(' OR ')
    })

    it('handles $empty: false as present-and-non-empty check', () => {
      const out = render(buildFilterClause({ phone: { $empty: false } }, TABLE, NO_COLUMNS))
      expect(out).toContain('IS NOT NULL')
      expect(out).toContain("<> ''")
      expect(out).toContain(' AND ')
    })

    it('coerces string "true"/"false" $empty operands (lenient raw-API input)', () => {
      const truthy = render(
        buildFilterClause({ phone: { $empty: 'true' } } as Filter, TABLE, NO_COLUMNS)
      )
      expect(truthy).toContain('IS NULL')
      const falsy = render(
        buildFilterClause({ phone: { $empty: 'false' } } as Filter, TABLE, NO_COLUMNS)
      )
      expect(falsy).toContain('IS NOT NULL')
    })

    it('throws on a non-boolean $empty operand rather than silently inverting', () => {
      expect(() =>
        buildFilterClause({ phone: { $empty: 1 } } as unknown as Filter, TABLE, NO_COLUMNS)
      ).toThrow(/\$empty on column "phone" requires a boolean/)
    })

    it('joins multiple top-level conditions with AND', () => {
      const out = render(
        buildFilterClause({ status: 'active', age: { $gt: 18 } }, TABLE, NO_COLUMNS)
      )
      expect(out).toContain(' AND ')
    })

    it('handles $or logical operator', () => {
      const out = render(
        buildFilterClause({ $or: [{ status: 'active' }, { status: 'pending' }] }, TABLE, NO_COLUMNS)
      )
      expect(out).toContain(' OR ')
    })

    it('handles $and logical operator', () => {
      const out = render(
        buildFilterClause({ $and: [{ status: 'active' }, { age: { $gt: 18 } }] }, TABLE, NO_COLUMNS)
      )
      expect(out).toContain(' AND ')
    })

    it('handles nested $or and $and', () => {
      const out = render(
        buildFilterClause(
          { $or: [{ $and: [{ status: 'active' }, { verified: true }] }, { role: 'admin' }] },
          TABLE,
          NO_COLUMNS
        )
      )
      expect(out).toContain(' OR ')
      expect(out).toContain(' AND ')
    })

    it('skips undefined values', () => {
      const result = buildFilterClause({ name: undefined, status: 'active' }, TABLE, NO_COLUMNS)
      expect(result).toBeDefined()
    })

    it('handles boolean / null / numeric primitives', () => {
      expect(render(buildFilterClause({ active: true }, TABLE, NO_COLUMNS))).toContain(
        '"active":true'
      )
      expect(render(buildFilterClause({ deleted_at: null }, TABLE, NO_COLUMNS))).toContain(
        '"deleted_at":null'
      )
      expect(render(buildFilterClause({ count: 42 }, TABLE, NO_COLUMNS))).toContain('"count":42')
    })

    it('throws on invalid field name', () => {
      expect(() => buildFilterClause({ 'invalid-field': 'v' }, TABLE, NO_COLUMNS)).toThrow(
        'Invalid field name'
      )
    })

    it('throws on invalid operator', () => {
      const f = { name: { $invalid: 'value' } } as unknown as Filter
      expect(() => buildFilterClause(f, TABLE, NO_COLUMNS)).toThrow('Invalid operator')
    })
  })

  describe('buildFilterClause > date column type', () => {
    const dateCols: ColumnDefinition[] = [{ name: 'birthDate', type: 'date' }]

    it.each([
      ['$gt', '>'],
      ['$gte', '>='],
      ['$lt', '<'],
      ['$lte', '<='],
    ] as const)('emits ::timestamptz on both sides for %s on a date column', (operator, sqlOp) => {
      const filter = { birthDate: { [operator]: '2024-01-01' } } as Filter
      const out = render(buildFilterClause(filter, TABLE, dateCols))
      expect(out).toContain(`(${TABLE}.data->>'birthDate')::timestamptz ${sqlOp} `)
      expect(out).toContain('::timestamptz')
      expect(out).not.toContain('::numeric')
      // RHS cast — without it Postgres would compare as text (lexicographic).
      expect(out.match(/::timestamptz/g)?.length).toBe(2)
    })

    it('combined range ($gte + $lte) emits two ::timestamptz pairs', () => {
      const out = render(
        buildFilterClause(
          { birthDate: { $gte: '2024-01-01', $lte: '2024-12-31' } },
          TABLE,
          dateCols
        )
      )
      expect(out.match(/::timestamptz/g)?.length).toBe(4)
      expect(out).not.toContain('::numeric')
      expect(out).toContain(' AND ')
    })

    it('propagates date cast through nested $and', () => {
      const out = render(
        buildFilterClause(
          { $and: [{ birthDate: { $gte: '2024-01-01' } }, { birthDate: { $lt: '2025-01-01' } }] },
          TABLE,
          dateCols
        )
      )
      expect(out).toContain('::timestamptz')
      expect(out).not.toContain('::numeric')
    })

    it('propagates date cast through nested $or', () => {
      const out = render(
        buildFilterClause(
          { $or: [{ birthDate: { $lt: '2000-01-01' } }, { birthDate: { $gt: '2024-01-01' } }] },
          TABLE,
          dateCols
        )
      )
      expect(out).toContain('::timestamptz')
      expect(out).not.toContain('::numeric')
      expect(out).toContain(' OR ')
    })

    it('a number column in the same query keeps ::numeric (no cross-contamination)', () => {
      const cols: ColumnDefinition[] = [
        { name: 'birthDate', type: 'date' },
        { name: 'age', type: 'number' },
      ]
      const out = render(
        buildFilterClause({ birthDate: { $gte: '2024-01-01' }, age: { $gt: 18 } }, TABLE, cols)
      )
      expect(out).toContain('::timestamptz')
      expect(out).toContain('::numeric')
    })
  })

  describe('buildFilterClause > range operator value type validation', () => {
    it('throws when $gt on a number column receives a string', () => {
      const cols: ColumnDefinition[] = [{ name: 'age', type: 'number' }]
      expect(() => buildFilterClause({ age: { $gt: 'eighteen' } } as Filter, TABLE, cols)).toThrow(
        /column "age" \(number\) requires a number, got string/
      )
    })

    it('throws when $gte on a date column receives a number', () => {
      const cols: ColumnDefinition[] = [{ name: 'birthDate', type: 'date' }]
      expect(() =>
        buildFilterClause({ birthDate: { $gte: 1704067200000 } } as Filter, TABLE, cols)
      ).toThrow(/column "birthDate" \(date\) requires a date string, got number/)
    })

    it('throws when $lt on an unknown column (numeric fallback) receives a string', () => {
      expect(() =>
        buildFilterClause({ score: { $lt: 'high' } } as Filter, TABLE, NO_COLUMNS)
      ).toThrow(/column "score" \(number\) requires a number, got string/)
    })

    it('accepts valid number on number column', () => {
      const cols: ColumnDefinition[] = [{ name: 'age', type: 'number' }]
      expect(() => buildFilterClause({ age: { $gt: 18 } }, TABLE, cols)).not.toThrow()
    })

    it('accepts valid ISO string on date column', () => {
      const cols: ColumnDefinition[] = [{ name: 'birthDate', type: 'date' }]
      expect(() =>
        buildFilterClause({ birthDate: { $gte: '2024-01-01' } }, TABLE, cols)
      ).not.toThrow()
    })
  })

  describe('buildSortClause', () => {
    it('returns undefined for empty sort', () => {
      expect(buildSortClause({}, TABLE, NO_COLUMNS)).toBeUndefined()
    })

    it('sorts string columns as text (no cast)', () => {
      const cols: ColumnDefinition[] = [{ name: 'name', type: 'string' }]
      const out = render(buildSortClause({ name: 'asc' }, TABLE, cols))
      expect(out).toBe(`${TABLE}.data->>'name' ASC`)
      expect(out).not.toContain('::')
    })

    it('sorts number columns with ::numeric NULLS LAST', () => {
      const cols: ColumnDefinition[] = [{ name: 'salary', type: 'number' }]
      const out = render(buildSortClause({ salary: 'desc' }, TABLE, cols))
      expect(out).toBe(`(${TABLE}.data->>'salary')::numeric DESC NULLS LAST`)
    })

    it('sorts date columns with ::timestamptz NULLS LAST', () => {
      const cols: ColumnDefinition[] = [{ name: 'birthDate', type: 'date' }]
      const out = render(buildSortClause({ birthDate: 'asc' }, TABLE, cols))
      expect(out).toBe(`(${TABLE}.data->>'birthDate')::timestamptz ASC NULLS LAST`)
    })

    it('sorts createdAt / updatedAt as direct snake_case column refs', () => {
      expect(render(buildSortClause({ createdAt: 'desc' }, TABLE, NO_COLUMNS))).toBe(
        `${TABLE}.created_at DESC`
      )
      expect(render(buildSortClause({ updatedAt: 'asc' }, TABLE, NO_COLUMNS))).toBe(
        `${TABLE}.updated_at ASC`
      )
    })

    it('combines multiple sort fields with commas', () => {
      const cols: ColumnDefinition[] = [
        { name: 'name', type: 'string' },
        { name: 'salary', type: 'number' },
      ]
      const out = render(buildSortClause({ name: 'asc', salary: 'desc' }, TABLE, cols))
      expect(out).toBe(
        `${TABLE}.data->>'name' ASC, (${TABLE}.data->>'salary')::numeric DESC NULLS LAST`
      )
    })

    it('falls back to text sort for unknown column types', () => {
      const sort: Sort = { unknownField: 'asc' }
      const out = render(buildSortClause(sort, TABLE, NO_COLUMNS))
      expect(out).toBe(`${TABLE}.data->>'unknownField' ASC`)
    })

    it('throws on invalid field name', () => {
      const sort: Sort = { 'invalid-field': 'asc' }
      expect(() => buildSortClause(sort, TABLE, NO_COLUMNS)).toThrow('Invalid field name')
    })

    it('throws on invalid direction', () => {
      const sort = { name: 'invalid' as 'asc' | 'desc' }
      expect(() => buildSortClause(sort, TABLE, NO_COLUMNS)).toThrow('Invalid sort direction')
    })
  })

  describe('select columns', () => {
    const statusCol: ColumnDefinition = {
      id: 'status',
      name: 'status',
      type: 'select',
      options: [
        { id: 'opt_open', name: 'Open' },
        { id: 'opt_closed', name: 'Closed' },
      ],
    }
    const tagsCol: ColumnDefinition = {
      id: 'tags',
      name: 'tags',
      type: 'select',
      multiple: true,
      options: [{ id: 'opt_a', name: 'Alpha' }],
    }

    it('filters a select by option id via containment', () => {
      const out = render(buildFilterClause({ status: 'opt_open' }, TABLE, [statusCol]))
      expect(out).toContain('user_table_rows.data @>')
      expect(out).toContain('"status":"opt_open"')
    })

    it('rejects a range operator on a select column', () => {
      expect(() => buildFilterClause({ status: { $gt: 'opt_open' } }, TABLE, [statusCol])).toThrow(
        'not supported on select'
      )
    })

    it('rejects a pattern operator on a select column', () => {
      expect(() =>
        buildFilterClause({ status: { $contains: 'Open' } }, TABLE, [statusCol])
      ).toThrow('not supported on select')
    })

    it('treats a multiselect empty array as $empty', () => {
      const out = render(buildFilterClause({ tags: { $empty: true } }, TABLE, [tagsCol]))
      expect(out).toContain("= '[]'")
    })

    it('filters a multiselect by ARRAY membership, not scalar equality', () => {
      // `{"tags":["opt_a"]} @> {"tags":"opt_a"}` is FALSE in Postgres — the
      // operand has to be wrapped or the filter silently matches nothing.
      const out = render(buildFilterClause({ tags: { $contains: 'opt_a' } }, TABLE, [tagsCol]))
      expect(out).toContain('user_table_rows.data @>')
      expect(out).toContain('"tags":["opt_a"]')
      expect(out).not.toContain('"tags":"opt_a"')
      expect(out).not.toContain('ILIKE')
    })

    it('negates multiselect membership for $ncontains', () => {
      const out = render(buildFilterClause({ tags: { $ncontains: 'opt_a' } }, TABLE, [tagsCol]))
      expect(out).toContain('NOT (')
      expect(out).toContain('"tags":["opt_a"]')
    })

    it('rejects explicit equality on a multiselect — it could never match', () => {
      expect(() => buildFilterClause({ tags: { $eq: 'opt_a' } }, TABLE, [tagsCol])).toThrow(
        'not supported on multi-select'
      )
    })

    it('reads the equality shorthand on a multiselect as membership', () => {
      // The shorthand bypasses the operator whitelist, so it has to compile to
      // membership itself or it silently matches nothing.
      const out = render(buildFilterClause({ tags: 'opt_a' }, TABLE, [tagsCol]))
      expect(out).toContain('"tags":["opt_a"]')
    })

    it('rejects membership operators on a single select', () => {
      expect(() =>
        buildFilterClause({ status: { $contains: 'opt_open' } }, TABLE, [statusCol])
      ).toThrow('not supported on select')
    })

    it('still uses ILIKE for $contains on a plain string column', () => {
      const strCol: ColumnDefinition = { id: 'name', name: 'name', type: 'string' }
      const out = render(buildFilterClause({ name: { $contains: 'jo' } }, TABLE, [strCol]))
      expect(out).toContain('ILIKE')
    })

    it('sorts a select column alphabetically by option name via CASE', () => {
      const out = render(buildSortClause({ status: 'asc' }, TABLE, [statusCol]))
      expect(out).toContain('CASE')
      expect(out).toContain("WHEN 'opt_open' THEN 'Open'")
      expect(out).toContain("WHEN 'opt_closed' THEN 'Closed'")
      expect(out.trim().endsWith('ASC NULLS LAST')).toBe(true)
    })

    it('sorts a multiselect by its option names, not the raw id array', () => {
      // A multi cell extracts as `["opt_b","opt_a"]`, which matches no single-id
      // CASE branch — without the array arm it would order on that opaque text.
      const out = render(buildSortClause({ tags: 'asc' }, TABLE, [tagsCol]))
      expect(out).toContain('jsonb_array_elements_text')
      expect(out).toContain('string_agg')
      expect(out).toContain('ORDER BY e.ord')
      // The scalar arm survives for values left over from a single→multi toggle.
      expect(out).toContain('CASE')
      expect(out.trim().endsWith('ASC NULLS LAST')).toBe(true)
    })
  })

  describe('select operator whitelists stay in step with the filter UI', () => {
    // The picker offers exactly the UI set and `pruneFilterForColumns` DROPS
    // anything outside it, so a UI set narrower than the server's silently
    // discards a filter the server would have accepted (this shipped: `in`/`nin`
    // were missing from the single-select set). Assert the mapping instead of
    // trusting the two lists to be kept in sync by hand.
    const toWire = (op: string) => UI_TO_WIRE_OPERATOR[op] ?? `$${op}`

    it('single-select UI operators map onto the server whitelist exactly', () => {
      const mapped = new Set([...SINGLE_SELECT_FILTER_OPERATORS].map(toWire))
      expect(mapped).toEqual(SINGLE_SELECT_OPERATORS)
    })

    it('multi-select UI operators map onto the server whitelist exactly', () => {
      const mapped = new Set([...MULTI_SELECT_FILTER_OPERATORS].map(toWire))
      expect(mapped).toEqual(MULTI_SELECT_OPERATORS)
    })
  })

  describe('Field name validation', () => {
    it('accepts valid identifiers', () => {
      const valid = ['name', 'user_id', '_private', 'Count123', 'a']
      for (const name of valid) {
        expect(() => buildFilterClause({ [name]: 'v' }, TABLE, NO_COLUMNS)).not.toThrow()
      }
    })

    it('rejects identifiers starting with a digit', () => {
      expect(() => buildFilterClause({ '123name': 'v' }, TABLE, NO_COLUMNS)).toThrow(
        'Invalid field name'
      )
    })

    it('rejects identifiers with special characters', () => {
      const invalid = ['field-name', 'field.name', 'field name', 'field@name']
      for (const name of invalid) {
        expect(() => buildFilterClause({ [name]: 'v' }, TABLE, NO_COLUMNS)).toThrow(
          'Invalid field name'
        )
      }
    })

    it('rejects SQL injection attempts in field names', () => {
      const attempts = ["'; DROP TABLE users; --", 'name OR 1=1', 'name; DELETE FROM']
      for (const a of attempts) {
        expect(() => buildFilterClause({ [a]: 'v' }, TABLE, NO_COLUMNS)).toThrow(
          'Invalid field name'
        )
      }
    })
  })
})

describe('fieldPredicate (shared leaf)', () => {
  const r = (
    op: Parameters<typeof fieldPredicate>[2],
    value: unknown,
    colType?: ColumnDefinition['type']
  ) => render(fieldPredicate(TABLE, 'wins', op, value as never, colType && col(colType, 'wins')))

  it('eq emits case-sensitive JSONB containment (no lower())', () => {
    const out = render(fieldPredicate(TABLE, 'slack_user_id', 'eq', 'U333', undefined))
    expect(out).toContain('user_table_rows.data @>')
    expect(out).toContain('"slack_user_id":"U333"')
    expect(out).not.toContain('lower(')
    // Case is preserved verbatim — U333 and u333 are distinct values.
    expect(out).not.toContain('u333')
  })

  it('ne negates the containment clause', () => {
    expect(r('ne', 'x')).toContain('NOT (')
    expect(r('ne', 'x')).toContain('data @>')
  })

  it('in with one value is a single containment; many values OR together', () => {
    expect(render(fieldPredicate(TABLE, 'slack_user_id', 'in', ['U1'], undefined))).toContain(
      '"slack_user_id":"U1"'
    )
    const many = render(fieldPredicate(TABLE, 'slack_user_id', 'in', ['U1', 'U2'], undefined))
    expect(many).toContain('"slack_user_id":"U1"')
    expect(many).toContain('"slack_user_id":"U2"')
    expect(many).toContain(' OR ')
  })

  it('nin ANDs negated containments', () => {
    const out = render(fieldPredicate(TABLE, 'slack_user_id', 'nin', ['U1', 'U2'], undefined))
    expect(out).toContain('NOT (')
    expect(out).toContain(' AND ')
  })

  it('empty in/nin arrays are a no-op (undefined)', () => {
    expect(fieldPredicate(TABLE, 'wins', 'in', [], undefined)).toBeUndefined()
    expect(fieldPredicate(TABLE, 'wins', 'nin', [], undefined)).toBeUndefined()
  })

  it('range ops cast by column type', () => {
    expect(r('gte', 10, 'number')).toContain('::numeric')
    expect(r('gt', '2024-01-01', 'date')).toContain('::timestamptz')
  })

  it('text ops use case-insensitive ILIKE', () => {
    expect(render(fieldPredicate(TABLE, 'name', 'contains', 'jo', undefined))).toContain('ILIKE')
    expect(render(fieldPredicate(TABLE, 'name', 'startsWith', 'jo', undefined))).toContain('ILIKE')
  })

  it('isEmpty / isNotEmpty emit emptiness checks (null OR empty string)', () => {
    const empty = render(fieldPredicate(TABLE, 'name', 'isEmpty', undefined, undefined))
    expect(empty).toContain('IS NULL')
    expect(empty).toContain("= ''")
    const notEmpty = render(fieldPredicate(TABLE, 'name', 'isNotEmpty', undefined, undefined))
    expect(notEmpty).toContain('IS NOT NULL')
  })

  it('isNull / isNotNull are strict null checks (no empty-string clause)', () => {
    const isNull = render(fieldPredicate(TABLE, 'name', 'isNull', undefined, undefined))
    expect(isNull).toContain('IS NULL')
    expect(isNull).not.toContain("= ''")
    expect(render(fieldPredicate(TABLE, 'name', 'isNotNull', undefined, undefined))).toContain(
      'IS NOT NULL'
    )
  })

  it('like / ilike map * to % and escape literal % / _', () => {
    const like = render(fieldPredicate(TABLE, 'name', 'like', 'jo*n', undefined))
    expect(like).toContain("data->>'name'")
    expect(like).toContain('LIKE')
    expect(like).not.toContain('ILIKE')
    expect(like).toContain('jo%n')
    expect(render(fieldPredicate(TABLE, 'name', 'ilike', '*foo*', undefined))).toContain('ILIKE')
    // literal % is escaped to match itself, not act as a wildcard
    expect(render(fieldPredicate(TABLE, 'name', 'like', '50%*', undefined))).toContain('50\\%%')
  })

  it('nlike / nilike negate the match and keep null cells', () => {
    // "does not match X" must retain rows where the cell is absent — otherwise a
    // negated filter silently drops every row with an empty value for that column.
    const nlike = render(fieldPredicate(TABLE, 'name', 'nlike', 'jo*n', undefined))
    expect(nlike).toContain('NOT LIKE')
    expect(nlike).not.toContain('NOT ILIKE')
    expect(nlike).toContain('jo%n')
    expect(nlike).toContain('IS NULL')

    const nilike = render(fieldPredicate(TABLE, 'name', 'nilike', '*foo*', undefined))
    expect(nilike).toContain('NOT ILIKE')
    expect(nilike).toContain('IS NULL')
  })

  it('reaches nlike / nilike through the legacy $-grammar too', () => {
    expect(render(buildFilterClause({ name: { $nlike: 'jo*' } }, TABLE, NO_COLUMNS))).toContain(
      'NOT LIKE'
    )
    expect(render(buildFilterClause({ name: { $nilike: 'jo*' } }, TABLE, NO_COLUMNS))).toContain(
      'NOT ILIKE'
    )
  })

  it('no longer accepts the regex ops (removed from FILTER_OPS)', () => {
    for (const op of ['match', 'imatch'] as const) {
      expect(() => fieldPredicate(TABLE, 'name', op as never, '^jo', undefined)).toThrow(
        'Invalid operator'
      )
    }
    expect(() => buildFilterClause({ name: { $match: '^jo' } }, TABLE, NO_COLUMNS)).toThrow(
      'Invalid operator'
    )
  })

  it('validates the field name', () => {
    expect(() => fieldPredicate(TABLE, "x'; DROP", 'eq', 1, undefined)).toThrow(
      'Invalid field name'
    )
  })

  it('rejects an unknown operator', () => {
    expect(() => fieldPredicate(TABLE, 'wins', 'bogus' as never, 1, undefined)).toThrow(
      'Invalid operator'
    )
  })

  it('filters createdAt / updatedAt as real timestamptz columns, not JSONB keys', () => {
    const gte = render(fieldPredicate(TABLE, 'createdAt', 'gte', '2026-01-01', col('date')))
    expect(gte).toContain(`${TABLE}.created_at`)
    expect(gte).toContain('::timestamptz')
    expect(gte).not.toContain("data->>'createdAt'")

    const lt = render(fieldPredicate(TABLE, 'updatedAt', 'lt', '2026-06-01', col('date')))
    expect(lt).toContain(`${TABLE}.updated_at`)
    expect(lt).toContain('::timestamptz')
  })

  it('supports in / isNull on system columns', () => {
    expect(render(fieldPredicate(TABLE, 'createdAt', 'isNull', undefined, col('date')))).toContain(
      `${TABLE}.created_at IS NULL`
    )
    const inClause = render(
      fieldPredicate(TABLE, 'createdAt', 'in', ['2026-01-01', '2026-02-01'], col('date'))
    )
    expect(inClause).toContain(`${TABLE}.created_at`)
    expect(inClause).toContain('::timestamptz')
  })
})

/**
 * Regression coverage for #5920 — "filtering on built-in columns silently
 * returns zero rows". Three distinct defects fed that report: the missing
 * system-column dispatch (fixed above), `id` never being a system column at
 * all, and the session-dependent `timestamptz` promotion that shifts every
 * bound by the server's `TimeZone` GUC.
 */
describe('system columns (#5920)', () => {
  it('normalizes timestamp bounds to UTC wall clock, not the session TimeZone', () => {
    // `created_at`/`updated_at` are `timestamp WITHOUT time zone` holding UTC.
    // Without `AT TIME ZONE 'UTC'` the comparison result depends on the server's
    // TimeZone setting, so a UTC-3 day range (the reporter's exact query) lands
    // off by the offset at both boundaries.
    for (const field of ['createdAt', 'updatedAt'] as const) {
      const out = render(
        fieldPredicate(TABLE, field, 'gte', '2026-07-24T03:00:00.000Z', col('date'))
      )
      expect(out).toContain("::timestamptz AT TIME ZONE 'UTC'")
    }
  })

  it('filters id as the real text column, with no timestamptz cast', () => {
    const out = render(fieldPredicate(TABLE, 'id', 'eq', 'row-123', col('string')))
    expect(out).toContain(`${TABLE}.id =`)
    expect(out).not.toContain("data->>'id'")
    expect(out).not.toContain('timestamptz')
  })

  it('supports the pattern ops on id (text), which are meaningless on timestamps', () => {
    expect(render(fieldPredicate(TABLE, 'id', 'contains', 'abc', col('string')))).toContain(
      `${TABLE}.id ILIKE`
    )
    expect(render(fieldPredicate(TABLE, 'id', 'startsWith', 'abc', col('string')))).toContain(
      `${TABLE}.id ILIKE`
    )
    expect(render(fieldPredicate(TABLE, 'id', 'like', 'ab*', col('string')))).toContain(
      `${TABLE}.id LIKE`
    )
    expect(render(fieldPredicate(TABLE, 'id', 'ncontains', 'abc', col('string')))).toContain(
      'NOT ('
    )

    expect(() => fieldPredicate(TABLE, 'createdAt', 'contains', 'abc', col('date'))).toThrow(
      /not supported on the built-in column "createdAt"/
    )
  })

  it('rejects an empty pattern on id rather than matching every row', () => {
    expect(() => fieldPredicate(TABLE, 'id', 'contains', '', col('string'))).toThrow(
      /requires a non-empty value/
    )
  })

  it('supports id in ranges and membership', () => {
    expect(render(fieldPredicate(TABLE, 'id', 'gt', 'row-100', col('string')))).toContain(
      `${TABLE}.id >`
    )
    const inClause = render(fieldPredicate(TABLE, 'id', 'in', ['a', 'b'], col('string')))
    expect(inClause).toContain(`${TABLE}.id IN (`)
  })

  it('sorts id as a direct column ref', () => {
    expect(render(buildSortClause({ id: 'asc' }, TABLE, NO_COLUMNS))).toBe(`${TABLE}.id ASC`)
  })

  it('maps isEmpty/isNotEmpty to IS NULL / IS NOT NULL (not inverted)', () => {
    expect(render(fieldPredicate(TABLE, 'createdAt', 'isEmpty', undefined, col('date')))).toContain(
      'IS NULL'
    )
    expect(
      render(fieldPredicate(TABLE, 'createdAt', 'isNotEmpty', undefined, col('date')))
    ).toContain('IS NOT NULL')
  })

  it('reaches the same clause through the legacy $-grammar', () => {
    // The v1 API path in the bug report goes through buildFilterClause, so the
    // shared `fieldPredicate` leaf must cover it identically.
    const out = render(
      buildFilterClause(
        { createdAt: { $gte: '2026-07-24T03:00:00.000Z', $lte: '2026-07-25T02:59:59.999Z' } },
        TABLE,
        NO_COLUMNS
      )
    )
    expect(out).toContain(`${TABLE}.created_at >=`)
    expect(out).toContain(`${TABLE}.created_at <=`)
    expect(out).toContain("AT TIME ZONE 'UTC'")
    expect(out).not.toContain('requires a number')
  })
})

describe('range operators on non-numeric column types', () => {
  it('compares string columns lexicographically as text (no numeric cast)', () => {
    const cols: ColumnDefinition[] = [{ name: 'name', type: 'string' }]
    const out = render(buildFilterClause({ name: { $gte: 'M' } }, TABLE, cols))
    expect(out).toContain(`${TABLE}.data->>'name' >=`)
    expect(out).not.toContain('::numeric')
  })

  it('rejects ranges on boolean / json columns with a type-naming message', () => {
    for (const type of ['boolean', 'json'] as const) {
      const cols: ColumnDefinition[] = [{ name: 'flag', type }]
      expect(() => buildFilterClause({ flag: { $gt: 1 } }, TABLE, cols)).toThrow(
        new RegExp(`\\(${type}\\) is not supported`)
      )
    }
  })
})

describe('buildPredicateClause (v2 grammar)', () => {
  it('all joins members with AND', () => {
    const p: TablePredicate = {
      all: [
        { field: 'slack_user_id', op: 'in', value: ['U1', 'U2'] },
        { field: 'wins', op: 'gte', value: 10 },
      ],
    }
    const out = render(buildPredicateClause(p, TABLE, [{ name: 'wins', type: 'number' }]))
    expect(out).toContain(' AND ')
    expect(out).toContain('"slack_user_id":"U1"')
    expect(out).toContain('::numeric')
  })

  it('any joins members with OR', () => {
    const p: TablePredicate = {
      any: [
        { field: 'status', op: 'eq', value: 'active' },
        { field: 'status', op: 'eq', value: 'pending' },
      ],
    }
    const out = render(buildPredicateClause(p, TABLE, []))
    expect(out).toContain(' OR ')
    expect(out).toContain('"status":"active"')
    expect(out).toContain('"status":"pending"')
  })

  it('nests groups', () => {
    const p: TablePredicate = {
      all: [
        { field: 'wins', op: 'gte', value: 1 },
        {
          any: [
            { field: 's', op: 'eq', value: 'a' },
            { field: 's', op: 'eq', value: 'b' },
          ],
        },
      ],
    }
    const out = render(buildPredicateClause(p, TABLE, []))
    expect(out).toContain(' AND ')
    expect(out).toContain(' OR ')
  })

  it('an empty group is a no-op (undefined)', () => {
    expect(buildPredicateClause({ all: [] }, TABLE, [])).toBeUndefined()
    expect(buildPredicateClause({ any: [] }, TABLE, [])).toBeUndefined()
  })

  it('validates leaf field names', () => {
    const p: TablePredicate = { all: [{ field: 'bad name', op: 'eq', value: 1 }] }
    expect(() => buildPredicateClause(p, TABLE, [])).toThrow('Invalid field name')
  })
})

/**
 * Cross-version safety. If a client speaking the v2 predicate grammar reaches a
 * server that predates it, the predicate arrives at the LEGACY `$`-compiler as
 * `{ all: [...] }`. That used to be skipped as "an array on a regular field",
 * compiling to no WHERE clause — which on a bulk delete means every row rather
 * than none. The guard turns that into a loud, self-describing failure, and it
 * sits at the one choke point every filter path shares (`queryRows`,
 * `update-runner`, `delete-runner`, inline and background).
 */
describe('legacy compiler rejects a v2 predicate (version-mismatch fail-fast)', () => {
  it('throws on a top-level all/any group instead of emitting no clause', () => {
    for (const group of ['all', 'any'] as const) {
      expect(() =>
        buildFilterClause(
          { [group]: [{ field: 'tenant_id', op: 'eq', value: 'acme' }] } as unknown as Filter,
          TABLE,
          NO_COLUMNS
        )
      ).toThrow(/v2 predicate tree/)
    }
  })

  it('catches one nested inside a legacy $or', () => {
    expect(() =>
      buildFilterClause(
        {
          $or: [{ status: 'a' }, { all: [{ field: 'tenant_id', op: 'eq', value: 'acme' }] }],
        } as unknown as Filter,
        TABLE,
        NO_COLUMNS
      )
    ).toThrow(/v2 predicate tree/)
  })

  it('leaves legitimate legacy filters alone', () => {
    expect(buildFilterClause({ status: 'archived' }, TABLE, NO_COLUMNS)).toBeDefined()
    expect(
      buildFilterClause({ $or: [{ status: 'a' }, { status: 'b' }] }, TABLE, NO_COLUMNS)
    ).toBeDefined()
    // An ordinary column holding an array stays a silent skip — only the
    // predicate discriminators `all`/`any` are treated as a version mismatch.
    expect(() =>
      buildFilterClause({ status: ['a', 'b'] } as unknown as Filter, TABLE, NO_COLUMNS)
    ).not.toThrow()
  })
})
