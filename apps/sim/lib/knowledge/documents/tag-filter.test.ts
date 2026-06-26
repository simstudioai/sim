/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildTagFilterCondition } from '@/lib/knowledge/documents/tag-filter'

/**
 * The global `drizzle-orm` mock renders `sql` fragments to a `?`-placeholder
 * string via `toSQL()` and returns plain `{ type, left, right }` objects for the
 * comparison operators, so we can assert the exact predicate each filter builds.
 */
function rendered(condition: ReturnType<typeof buildTagFilterCondition>) {
  return (condition as unknown as { toSQL: () => { sql: string; params: unknown[] } }).toSQL()
}

describe('buildTagFilterCondition', () => {
  it('ignores unknown tag slots', () => {
    expect(
      buildTagFilterCondition({
        tagSlot: 'not_a_real_slot',
        fieldType: 'text',
        operator: 'eq',
        value: 'x',
      })
    ).toBeUndefined()
  })

  describe('text', () => {
    it('matches eq case-insensitively', () => {
      const { sql, params } = rendered(
        buildTagFilterCondition({
          tagSlot: 'tag1',
          fieldType: 'text',
          operator: 'eq',
          value: 'Ada Lovelace',
        })
      )
      expect(sql).toBe('LOWER(?) = LOWER(?)')
      expect(params).toEqual(['tag1', 'Ada Lovelace'])
    })

    it('matches neq case-insensitively', () => {
      const { sql, params } = rendered(
        buildTagFilterCondition({
          tagSlot: 'tag2',
          fieldType: 'text',
          operator: 'neq',
          value: 'Spreadsheet',
        })
      )
      expect(sql).toBe('LOWER(?) != LOWER(?)')
      expect(params).toEqual(['tag2', 'Spreadsheet'])
    })

    it('escapes LIKE wildcards in contains', () => {
      const { params } = rendered(
        buildTagFilterCondition({
          tagSlot: 'tag1',
          fieldType: 'text',
          operator: 'contains',
          value: '50%_off',
        })
      )
      expect(params).toContain('%50\\%\\_off%')
    })

    it('returns undefined for an unsupported operator', () => {
      expect(
        buildTagFilterCondition({
          tagSlot: 'tag1',
          fieldType: 'text',
          operator: 'gt',
          value: 'x',
        })
      ).toBeUndefined()
    })
  })

  describe('date', () => {
    it('compares eq on the calendar day', () => {
      const { sql, params } = rendered(
        buildTagFilterCondition({
          tagSlot: 'date1',
          fieldType: 'date',
          operator: 'eq',
          value: '2026-04-21',
        })
      )
      expect(sql).toBe('?::date = ?::date')
      expect(params).toEqual(['date1', '2026-04-21'])
    })

    it('compares range bounds on the calendar day', () => {
      const condition = buildTagFilterCondition({
        tagSlot: 'date1',
        fieldType: 'date',
        operator: 'between',
        value: '2026-04-01',
        valueTo: '2026-04-30',
      }) as unknown as { type: string; conditions: unknown[] }
      expect(condition.type).toBe('and')
      expect(condition.conditions).toHaveLength(2)
      expect(rendered(condition.conditions[0] as never).sql).toBe('?::date >= ?::date')
      expect(rendered(condition.conditions[1] as never).sql).toBe('?::date <= ?::date')
    })

    it('ignores values that are not YYYY-MM-DD', () => {
      expect(
        buildTagFilterCondition({
          tagSlot: 'date1',
          fieldType: 'date',
          operator: 'eq',
          value: 'not-a-date',
        })
      ).toBeUndefined()
    })

    it('ignores a between filter missing its upper bound', () => {
      expect(
        buildTagFilterCondition({
          tagSlot: 'date1',
          fieldType: 'date',
          operator: 'between',
          value: '2026-04-01',
        })
      ).toBeUndefined()
    })
  })

  describe('number', () => {
    it('builds an equality comparison', () => {
      expect(
        buildTagFilterCondition({
          tagSlot: 'number1',
          fieldType: 'number',
          operator: 'eq',
          value: '42',
        })
      ).toEqual({ type: 'eq', left: 'number1', right: 42 })
    })

    it('ignores non-numeric values', () => {
      expect(
        buildTagFilterCondition({
          tagSlot: 'number1',
          fieldType: 'number',
          operator: 'eq',
          value: 'abc',
        })
      ).toBeUndefined()
    })
  })

  describe('boolean', () => {
    it('parses string values', () => {
      expect(
        buildTagFilterCondition({
          tagSlot: 'boolean1',
          fieldType: 'boolean',
          operator: 'eq',
          value: 'true',
        })
      ).toEqual({ type: 'eq', left: 'boolean1', right: true })
    })

    it('ignores values that are not boolean-like', () => {
      expect(
        buildTagFilterCondition({
          tagSlot: 'boolean1',
          fieldType: 'boolean',
          operator: 'eq',
          value: 'maybe',
        })
      ).toBeUndefined()
    })
  })
})
