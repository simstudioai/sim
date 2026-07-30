/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TableQueryValidationError } from '@/lib/table/errors'
import {
  validatePredicate,
  validatePredicateShape,
  validateSortSpec,
} from '@/lib/table/query-builder/validate'
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

/**
 * These shapes pass structural validation but compile to a clause the legacy
 * `$`-grammar discards — which turns a bulk delete/update into "match everything".
 */
describe('validatePredicate — leaves that would silently widen a bulk write', () => {
  it('rejects a scalar op given an array (the eq-instead-of-in mistake)', () => {
    expect(() =>
      validatePredicate({ all: [{ field: 'status', op: 'eq', value: ['a', 'b'] }] }, COLS)
    ).toThrow(/does not accept an array — use "in"/)
  })

  it('rejects a value-taking op with no value', () => {
    expect(() => validatePredicate({ all: [{ field: 'status', op: 'eq' }] }, COLS)).toThrow(
      /requires a value/
    )
    expect(() => validatePredicate({ all: [{ field: 'wins', op: 'gte' }] }, COLS)).toThrow(
      /requires a value/
    )
  })

  it('still allows the valueless ops', () => {
    for (const op of ['isNull', 'isNotNull', 'isEmpty', 'isNotEmpty'] as const) {
      expect(() => validatePredicate({ all: [{ field: 'status', op }] }, COLS)).not.toThrow()
    }
  })

  it('rejects a hybrid group+leaf node instead of silently picking one', () => {
    // Read group-first by the engine, leaf-first by predicateToFilter — so the gate
    // would validate one predicate and the bulk-write path execute another.
    expect(() =>
      validatePredicate(
        {
          all: [{ field: 'status', op: 'eq', value: 'benign' }],
          field: 'nope',
          op: 'isNotNull',
        } as never,
        COLS
      )
    ).toThrow(/not both/)
  })

  it('rejects a node carrying both group keys instead of dropping the "any" half', () => {
    // Every group-first traversal reads `all` and drops `any` — half the
    // caller's conditions would vanish, widening a bulk delete/update.
    expect(() =>
      validatePredicate(
        {
          all: [{ field: 'status', op: 'eq', value: 'archived' }],
          any: [{ field: 'status', op: 'eq', value: 'stale' }],
        } as never,
        COLS
      )
    ).toThrow(/either "all" or "any"/)
  })

  it('caps in/nin list length', () => {
    const huge = Array.from({ length: 1001 }, (_, i) => `v${i}`)
    expect(() =>
      validatePredicate({ all: [{ field: 'status', op: 'in', value: huge }] }, COLS)
    ).toThrow(/at most 1000 values/)
    expect(() =>
      validatePredicate({ all: [{ field: 'status', op: 'in', value: huge.slice(0, 1000) }] }, COLS)
    ).not.toThrow()
  })
})

/**
 * The copilot's `query_user_table` catalog entry still advertises the legacy
 * `$`-grammar, so the agent sends `{ status: { $eq: 'x' } }`. That shape hit
 * `validateLeaf` with `field: undefined` and came back as
 * `Unknown filter column "undefined"` — a message that sends an LLM retrying
 * column names instead of switching grammars.
 */
describe('validatePredicate — legacy $-grammar diagnostics', () => {
  it('names the grammar mistake instead of blaming a phantom column', () => {
    for (const legacy of [
      { status: { $eq: 'active' } },
      { $or: [{ status: 'a' }, { status: 'b' }] },
      { wins: { $gte: 10 } },
    ]) {
      expect(() => validatePredicate(legacy as never, COLS)).toThrow(/legacy operator-object/)
      expect(() => validatePredicate(legacy as never, COLS)).not.toThrow(/undefined/)
    }
  })

  it('still rejects a plain non-predicate object clearly', () => {
    expect(() => validatePredicate({ nonsense: 'x' } as never, COLS)).toThrow(
      /must be a group .* or a condition/
    )
  })
})

/**
 * Bugbot round 2: `{all: []}` passes the dual union via the non-empty-OBJECT
 * legacy branch, then compiled to no WHERE clause — silently widening a run /
 * cancel / delete scope to every row. The shape validator now mirrors the Zod
 * contract's .min(1).
 */
describe('empty groups are rejected at every layer', () => {
  it('validatePredicateShape rejects an empty group', () => {
    expect(() => validatePredicateShape({ all: [] })).toThrow(/at least one condition/)
    expect(() => validatePredicateShape({ any: [] })).toThrow(/at least one condition/)
    expect(() => validatePredicateShape({ all: [{ any: [] }] } as never)).toThrow(
      /at least one condition/
    )
  })

  it('validatePredicate rejects it too', () => {
    expect(() => validatePredicate({ all: [] }, COLS)).toThrow(/at least one condition/)
  })
})
