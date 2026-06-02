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
import { buildFilterClause, buildSortClause } from '@/lib/table/sql'
import type { ColumnDefinition, Filter, Sort } from '@/lib/table/types'

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

    it('sorts createdAt / updatedAt as direct column refs', () => {
      expect(render(buildSortClause({ createdAt: 'desc' }, TABLE, NO_COLUMNS))).toBe(
        `${TABLE}.createdAt DESC`
      )
      expect(render(buildSortClause({ updatedAt: 'asc' }, TABLE, NO_COLUMNS))).toBe(
        `${TABLE}.updatedAt ASC`
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
