/**
 * @vitest-environment node
 *
 * The v2 list convention's SQL half. These run against REAL drizzle (the global
 * `drizzle-orm` mock is lifted for this file) and render the generated SQL, so
 * the assertions are about the query that would actually be sent — the point
 * being that a caller's `search` term only ever arrives as a bound parameter.
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')

import { integer, PgDialect, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import {
  encodeKeyset,
  escapeLikePattern,
  keysetAfter,
  keysetColumns,
  listOrderBy,
  numberKey,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'

const thing = pgTable('thing', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at').notNull(),
})

const dialect = new PgDialect()

function render(fragment: Parameters<PgDialect['sqlToQuery']>[0]) {
  return dialect.sqlToQuery(fragment)
}

describe('escapeLikePattern', () => {
  it('neutralizes the LIKE wildcards so a caller cannot widen its own match', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash')
  })

  it('leaves an ordinary term untouched', () => {
    expect(escapeLikePattern('quarterly report')).toBe('quarterly report')
  })
})

describe('searchFilter', () => {
  it('binds the caller term as a parameter instead of inlining it into the SQL', () => {
    const { sql, params } = render(searchFilter(thing.name, "o'brien; drop table thing --")!)

    expect(sql).toBe('"thing"."name" ilike $1')
    expect(params).toEqual(["%o'brien; drop table thing --%"])
    expect(sql).not.toContain('drop table')
  })

  it('escapes wildcards inside the bound pattern', () => {
    const { params } = render(searchFilter(thing.name, '50%_off')!)

    expect(params).toEqual(['%50\\%\\_off%'])
  })

  it('is case-insensitive (ILIKE, not LIKE)', () => {
    const { sql } = render(searchFilter(thing.name, 'Report')!)

    expect(sql).toContain('ilike')
  })

  it('drops out of the WHERE clause entirely when no term was given', () => {
    expect(searchFilter(thing.name, undefined)).toBeUndefined()
  })
})

describe('listOrderBy', () => {
  it('applies the direction to every key so the ordering is total', () => {
    const [first, second] = listOrderBy([thing.name, thing.id], 'desc')

    expect(render(first).sql).toBe('"thing"."name" desc')
    expect(render(second).sql).toBe('"thing"."id" desc')
  })
})

interface Row {
  id: string
  name: string
  createdAt: Date
}

const nameKey = textKey<Row>(thing.name, (r) => r.name)
const idKey = textKey<Row>(thing.id, (r) => r.id)
const createdKey = timestampKey<Row>(thing.createdAt, (r) => r.createdAt)

describe('timestampKey', () => {
  /**
   * The regression this exists for: Postgres keeps microseconds, a cursor value
   * round-trips through a millisecond-only JS Date, and comparing the raw column
   * against the truncated value re-admits the page's own last row.
   */
  it('orders on the millisecond-truncated column so the cursor can express the ordering', () => {
    expect(render(createdKey.expr as never).sql).toBe(
      `date_trunc('milliseconds', "thing"."created_at")`
    )
  })

  it('casts the bound cursor value so date_trunc has a resolvable overload', () => {
    const { sql: text, params } = render(createdKey.bind('2024-01-01T00:00:00.123Z')!)

    expect(text).toBe(`date_trunc('milliseconds', cast($1 as timestamp))`)
    expect(params).toEqual(['2024-01-01T00:00:00.123Z'])
  })

  it('takes the cast from the column, so a timestamptz column keeps its offset', () => {
    const zoned = pgTable('zoned', {
      at: timestamp('at', { withTimezone: true }).notNull(),
    })
    const zonedKey = timestampKey<{ at: Date }>(zoned.at, (r) => r.at)

    expect(render(zonedKey.bind('2024-01-01T00:00:00.123Z')!).sql).toBe(
      `date_trunc('milliseconds', cast($1 as timestamp with time zone))`
    )
  })

  it('rejects a cursor value that is not a parseable timestamp', () => {
    expect(createdKey.bind('not-a-date')).toBeNull()
    expect(createdKey.bind(1700000000000)).toBeNull()
  })
})

describe('cursor key value validation', () => {
  it('rejects a non-string for a text key', () => {
    expect(nameKey.bind(42)).toBeNull()
    expect(nameKey.bind('ok')).not.toBeNull()
  })

  it('rejects a non-finite or non-numeric value for a numeric key', () => {
    const sizeKey = numberKey<Row>(thing.size, () => 0)

    expect(sizeKey.bind('12')).toBeNull()
    expect(sizeKey.bind(Number.NaN)).toBeNull()
    expect(sizeKey.bind(Number.POSITIVE_INFINITY)).toBeNull()
    expect(sizeKey.bind(12)).not.toBeNull()
  })
})

describe('encodeKeyset / keysetColumns', () => {
  it('reads the cursor values and the ordering expressions in key order', () => {
    const row: Row = { id: 'file-7', name: 'data.csv', createdAt: new Date('2024-03-04T05:06:07Z') }

    expect(encodeKeyset([nameKey, idKey], row)).toEqual(['data.csv', 'file-7'])
    expect(keysetColumns([nameKey, idKey])).toEqual([thing.name, thing.id])
  })
})

describe('keysetAfter', () => {
  it('expands lexicographically so a tie on a leading key falls through', () => {
    const { sql: text, params } = render(
      keysetAfter([nameKey, idKey], ['data.csv', 'file-7'], 'asc')!
    )

    expect(text).toBe('("thing"."name" > $1 or ("thing"."name" = $2 and "thing"."id" > $3))')
    expect(params).toEqual(['data.csv', 'data.csv', 'file-7'])
  })

  it('flips the comparison for a descending sort', () => {
    const { sql: text } = render(keysetAfter([nameKey, idKey], ['b', 'x'], 'desc')!)

    expect(text).toContain('"thing"."name" < $1')
    expect(text).not.toContain('>')
  })

  it('binds every keyset value as a parameter', () => {
    const { sql: text, params } = render(keysetAfter([idKey], ["'; delete from thing --"], 'asc')!)

    expect(text).toBe('"thing"."id" > $1')
    expect(params).toEqual(["'; delete from thing --"])
  })

  it('compares the truncated timestamp on both sides', () => {
    const { sql: text, params } = render(
      keysetAfter([createdKey, idKey], ['2024-01-01T00:00:00.123Z', 'file-7'], 'asc')!
    )

    expect(text).toBe(
      `(date_trunc('milliseconds', "thing"."created_at") > date_trunc('milliseconds', cast($1 as timestamp)) or ` +
        `(date_trunc('milliseconds', "thing"."created_at") = date_trunc('milliseconds', cast($2 as timestamp)) and ` +
        `"thing"."id" > $3))`
    )
    expect(params).toEqual(['2024-01-01T00:00:00.123Z', '2024-01-01T00:00:00.123Z', 'file-7'])
  })

  /**
   * Pins the class, not the instance: `date_trunc` is today's only wrapping, so
   * what this catches is a future key that wraps its bound value untyped.
   */
  it('leaves no bound value bare inside a function call', () => {
    const { sql: text } = render(
      keysetAfter(
        [numberKey<Row>(thing.size, () => 0), createdKey, idKey],
        [7, '2024-01-01T00:00:00.123Z', 'file-7'],
        'asc'
      )!
    )

    expect(text).not.toMatch(/[a-z_]+\((?:[^()]*,)?\s*\$\d+\s*\)/i)
  })

  /** A caller controls the cursor's contents, so a bad value is a 400, not a 500 from SQL. */
  it('refuses a cursor carrying a value its key cannot hold', () => {
    expect(keysetAfter([createdKey, idKey], ['not-a-date', 'file-7'], 'asc')).toBeNull()
    expect(keysetAfter([nameKey, idKey], [7, 'file-7'], 'asc')).toBeNull()
  })

  it('refuses a cursor with the wrong number of keys for the sort', () => {
    expect(keysetAfter([nameKey, idKey], ['only-one'], 'asc')).toBeNull()
    expect(keysetAfter([nameKey, idKey], ['a', 'b', 'c'], 'asc')).toBeNull()
  })
})
