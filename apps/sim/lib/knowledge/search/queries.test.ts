/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getStructuredTagFilters } from '@/lib/knowledge/search/queries'
import type { StructuredFilter } from '@/lib/knowledge/types'

/**
 * The builder only reads `embeddingTable[tagSlot]`, so a slot-to-name map stands
 * in for the real table and makes each rendered parameter readable.
 */
const embeddingTable = {
  tag1: 'tag1',
  number1: 'number1',
  date1: 'date1',
  boolean1: 'boolean1',
}

/**
 * The global `drizzle-orm` mock renders `sql` fragments to a `?`-placeholder
 * string via `toSQL()`, so we can assert the exact predicate each filter builds.
 */
function renderOne(filters: StructuredFilter[]) {
  const conditions = getStructuredTagFilters(filters, embeddingTable)
  expect(conditions).toHaveLength(1)
  return (conditions[0] as unknown as { toSQL: () => { sql: string; params: unknown[] } }).toSQL()
}

describe('getStructuredTagFilters', () => {
  describe('agreement with the value the gate validated', () => {
    it('compiles a number the gate read as 0 rather than dropping the filter', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'number1', fieldType: 'number', operator: 'eq', value: '' },
      ])
      expect(sql).toBe('? = ?')
      expect(params).toEqual(['number1', 0])
    })

    it('reads a number in the same base the gate validated', () => {
      const { params } = renderOne([
        { tagSlot: 'number1', fieldType: 'number', operator: 'eq', value: '0x10' },
      ])
      expect(params).toEqual(['number1', 16])
    })

    it('reads a boolean case-insensitively instead of inverting it', () => {
      const { params } = renderOne([
        { tagSlot: 'boolean1', fieldType: 'boolean', operator: 'eq', value: 'TRUE' },
      ])
      expect(params).toEqual(['boolean1', true])
    })

    it('trims a date the gate trimmed rather than dropping the filter', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'date1', fieldType: 'date', operator: 'eq', value: ' 2026-08-13' },
      ])
      expect(sql).toBe('?::date = ?::date')
      expect(params).toEqual(['date1', '2026-08-13'])
    })

    it('escapes LIKE metacharacters so a typed % is not a wildcard', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'tag1', fieldType: 'text', operator: 'contains', value: '50%off' },
      ])
      expect(sql).toBe("LOWER(?) LIKE LOWER(?) ESCAPE '\\'")
      expect(params).toEqual(['tag1', '%50\\%off%'])
    })

    it('escapes LIKE metacharacters for every text operator that uses LIKE', () => {
      for (const operator of ['not_contains', 'starts_with', 'ends_with']) {
        const { sql, params } = renderOne([
          { tagSlot: 'tag1', fieldType: 'text', operator, value: 'a_b' },
        ])
        expect(sql).toContain("ESCAPE '\\'")
        expect(params[1]).toContain('a\\_b')
      }
    })
  })

  describe('a filter that cannot compile is reported, never skipped', () => {
    it('raises instead of returning no predicate at all', () => {
      expect(() =>
        getStructuredTagFilters(
          [{ tagSlot: 'not_a_slot', fieldType: 'text', operator: 'eq', value: 'x' }],
          embeddingTable
        )
      ).toThrow(/Tag filter on slot "not_a_slot" could not be applied/)
    })

    it('raises rather than silently widening a multi-filter search', () => {
      expect(() =>
        getStructuredTagFilters(
          [
            { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'ok' },
            { tagSlot: 'not_a_slot', fieldType: 'text', operator: 'eq', value: 'x' },
          ],
          embeddingTable
        )
      ).toThrow(/could not be applied/)
    })
  })

  describe('a correct filter still compiles to the predicate it always did', () => {
    it('text eq', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'Billing' },
      ])
      expect(sql).toBe('LOWER(?) = LOWER(?)')
      expect(params).toEqual(['tag1', 'Billing'])
    })

    it('number gte', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'number1', fieldType: 'number', operator: 'gte', value: '42' },
      ])
      expect(sql).toBe('? >= ?')
      expect(params).toEqual(['number1', 42])
    })

    it('number between', () => {
      const { sql, params } = renderOne([
        {
          tagSlot: 'number1',
          fieldType: 'number',
          operator: 'between',
          value: '1',
          valueTo: '9',
        },
      ])
      expect(sql).toBe('? >= ? AND ? <= ?')
      expect(params).toEqual(['number1', 1, 'number1', 9])
    })

    it('date between', () => {
      const { sql, params } = renderOne([
        {
          tagSlot: 'date1',
          fieldType: 'date',
          operator: 'between',
          value: '2026-01-01',
          valueTo: '2026-12-31',
        },
      ])
      expect(sql).toBe('?::date >= ?::date AND ?::date <= ?::date')
      expect(params).toEqual(['date1', '2026-01-01', 'date1', '2026-12-31'])
    })

    it('boolean neq', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'boolean1', fieldType: 'boolean', operator: 'neq', value: 'false' },
      ])
      expect(sql).toBe('? != ?')
      expect(params).toEqual(['boolean1', false])
    })

    it('ORs two filters on the same slot and keeps them one condition', () => {
      const conditions = getStructuredTagFilters(
        [
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'a' },
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'b' },
        ],
        embeddingTable
      )
      expect(conditions).toHaveLength(1)
      const joined = (conditions[0] as unknown as { values: unknown[] }).values[0] as {
        toSQL: () => { sql: string; params: unknown[] }
      }
      expect(joined.toSQL().params).toEqual(['tag1', 'a', 'tag1', 'b'])
    })
  })
})
