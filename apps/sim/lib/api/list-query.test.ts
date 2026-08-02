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

import { PgDialect, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { escapeLikePattern, keysetAfter, listOrderBy, searchFilter } from '@/lib/api/list-query'

const thing = pgTable('thing', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
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

describe('keysetAfter', () => {
  it('expands lexicographically so a tie on a leading key falls through', () => {
    const { sql, params } = render(
      keysetAfter([thing.name, thing.id], ['data.csv', 'file-7'], 'asc')!
    )

    expect(sql).toBe(
      '("thing"."name" > $1 or ("thing"."name" = $2 and "thing"."id" > $3))'.replace(/\s+/g, ' ')
    )
    expect(params).toEqual(['data.csv', 'data.csv', 'file-7'])
  })

  it('flips the comparison for a descending sort', () => {
    const { sql } = render(keysetAfter([thing.name, thing.id], ['b', 'x'], 'desc')!)

    expect(sql).toContain('"thing"."name" < $1')
    expect(sql).not.toContain('>')
  })

  it('binds every keyset value as a parameter', () => {
    const { sql, params } = render(keysetAfter([thing.id], ["'; delete from thing --"], 'asc')!)

    expect(sql).toBe('"thing"."id" > $1')
    expect(params).toEqual(["'; delete from thing --"])
  })

  it('throws when a cursor carries the wrong number of keys for the sort', () => {
    expect(() => keysetAfter([thing.name, thing.id], ['only-one'], 'asc')).toThrow(
      /1 values for a 2-key sort/
    )
  })
})
