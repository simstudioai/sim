/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeTablePredicate } from '@/lib/table/query-builder/predicate'
import type { TablePredicate } from '@/lib/table/types'

describe('normalizeTablePredicate', () => {
  it('wraps a root condition in the canonical all group', () => {
    expect(normalizeTablePredicate({ field: 'status', op: 'eq', value: 'active' })).toEqual({
      all: [{ field: 'status', op: 'eq', value: 'active' }],
    })
  })

  it('keeps explicit groups unchanged', () => {
    const predicate: TablePredicate = {
      any: [
        { field: 'status', op: 'eq', value: 'active' },
        { field: 'status', op: 'eq', value: 'pending' },
      ],
    }
    expect(normalizeTablePredicate(predicate)).toBe(predicate)
  })
})
