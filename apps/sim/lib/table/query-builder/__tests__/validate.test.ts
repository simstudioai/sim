/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TableQueryValidationError } from '@/lib/table/errors'
import { validatePredicate, validateSortSpec } from '@/lib/table/query-builder/validate'
import type { ColumnDefinition } from '@/lib/table/types'

const COLS: ColumnDefinition[] = [
  { name: 'wins', type: 'number' },
  { name: 'status', type: 'string' },
  { name: 'metadata', type: 'json' },
]

describe('validatePredicate', () => {
  it('accepts a valid predicate over real + system columns', () => {
    expect(() =>
      validatePredicate(
        {
          all: [
            { field: 'wins', op: 'gte', value: 10 },
            { field: 'createdAt', op: 'lt', value: '2026-01-01' },
            { any: [{ field: 'status', op: 'eq', value: 'active' }] },
          ],
        },
        COLS
      )
    ).not.toThrow()
  })

  it('rejects an unknown column', () => {
    expect(() => validatePredicate({ all: [{ field: 'nope', op: 'eq', value: 1 }] }, COLS)).toThrow(
      /Unknown filter column/
    )
  })

  it('rejects equality/containment ops on a json column', () => {
    for (const op of ['eq', 'ne', 'in', 'nin'] as const) {
      const value = op === 'in' || op === 'nin' ? ['x'] : 'x'
      expect(() => validatePredicate({ all: [{ field: 'metadata', op, value }] }, COLS)).toThrow(
        /json column/
      )
    }
  })

  it('allows text-match / null ops on a json column', () => {
    expect(() =>
      validatePredicate({ all: [{ field: 'metadata', op: 'ilike', value: '*x*' }] }, COLS)
    ).not.toThrow()
    expect(() =>
      validatePredicate({ all: [{ field: 'metadata', op: 'isNull' }] }, COLS)
    ).not.toThrow()
  })

  it('rejects an empty in/nin array', () => {
    expect(() =>
      validatePredicate({ all: [{ field: 'wins', op: 'in', value: [] }] }, COLS)
    ).toThrow(/non-empty array/)
  })

  it('rejects an invalid field name', () => {
    expect(() =>
      validatePredicate({ all: [{ field: "x'; DROP", op: 'eq', value: 1 }] }, COLS)
    ).toThrow(/Invalid filter column/)
  })

  it('carries the INVALID_FILTER code', () => {
    try {
      validatePredicate({ all: [{ field: 'nope', op: 'eq', value: 1 }] }, COLS)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(TableQueryValidationError)
      expect((e as TableQueryValidationError).code).toBe('INVALID_FILTER')
    }
  })
})

describe('validateSortSpec', () => {
  it('accepts real and system columns', () => {
    expect(() =>
      validateSortSpec(
        [
          { field: 'wins', direction: 'desc' },
          { field: 'updatedAt', direction: 'asc' },
        ],
        COLS
      )
    ).not.toThrow()
  })

  it('rejects an unknown sort column with INVALID_ORDER', () => {
    try {
      validateSortSpec([{ field: 'nope', direction: 'asc' }], COLS)
      expect.unreachable()
    } catch (e) {
      expect((e as TableQueryValidationError).code).toBe('INVALID_ORDER')
    }
  })
})
