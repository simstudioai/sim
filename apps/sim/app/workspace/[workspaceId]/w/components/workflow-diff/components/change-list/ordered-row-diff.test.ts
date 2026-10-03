import { describe, expect, it } from 'vitest'
import { diffOrderedRows } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/ordered-row-diff'

/** Duplicate keys, reordered rows, hidden values, and bounded work must preserve both inputs. */
describe('ordered structured-value differences', () => {
  it('preserves duplicate header names and their execution order', () => {
    const first = { key: 'X-Mode:first' }
    const last = { key: 'X-Mode:last' }
    const rows = diffOrderedRows([first, last], [last, first])
    expect(rows.filter((row) => row.kind !== 'added').map((row) => row.value)).toEqual([
      first,
      last,
    ])
    expect(rows.filter((row) => row.kind !== 'removed').map((row) => row.value)).toEqual([
      last,
      first,
    ])
    expect(rows.some((row) => row.kind === 'removed')).toBe(true)
    expect(rows.some((row) => row.kind === 'added')).toBe(true)
  })

  it('detects a secret-only edit before identical masked cells are rendered', () => {
    const before = { key: 'Authorization:before', display: '•••' }
    const after = { key: 'Authorization:after', display: '•••' }
    expect(diffOrderedRows([before], [after])).toEqual([
      { kind: 'removed', value: before },
      { kind: 'added', value: after },
    ])
  })

  it('keeps every row when a large rewrite exceeds the edit budget', () => {
    const before = Array.from({ length: 300 }, (_, index) => ({ key: `old-${index}` }))
    const after = Array.from({ length: 300 }, (_, index) => ({ key: `new-${index}` }))
    const rows = diffOrderedRows(before, after)
    expect(rows.filter((row) => row.kind !== 'added').map((row) => row.value)).toEqual(before)
    expect(rows.filter((row) => row.kind !== 'removed').map((row) => row.value)).toEqual(after)
  })

  it('retains repeated identical rows and one-sided values', () => {
    const repeated = { key: 'Accept:json' }
    expect(diffOrderedRows([repeated, repeated], [repeated])).toEqual([
      { kind: 'context', value: repeated },
      { kind: 'removed', value: repeated },
    ])
    expect(diffOrderedRows([], [repeated])).toEqual([{ kind: 'added', value: repeated }])
    expect(diffOrderedRows([repeated], [])).toEqual([{ kind: 'removed', value: repeated }])
  })
})
