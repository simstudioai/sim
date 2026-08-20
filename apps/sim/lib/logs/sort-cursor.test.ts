/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildLogSortCursorCondition,
  decodeLogSortCursor,
  encodeLogSortCursor,
} from '@/lib/logs/sort-cursor'

function sqlText(condition: unknown): string {
  return (condition as { toSQL: () => { sql: string } }).toSQL().sql
}

/** The comparison operators a condition binds, which the mocked `sql` tag renders as `?`. */
function comparators(condition: unknown): string[] {
  const { params } = (condition as { toSQL: () => { params: unknown[] } }).toSQL()
  return params
    .map((param) => (param as { toSQL?: () => { sql: string } })?.toSQL?.().sql)
    .filter((operator): operator is string => operator === '>' || operator === '<')
}

describe('log sort cursor codec', () => {
  it('round-trips a value anchor and a null anchor', () => {
    expect(decodeLogSortCursor(encodeLogSortCursor({ v: 120, id: 'log-1' }))).toEqual({
      v: 120,
      id: 'log-1',
    })
    expect(decodeLogSortCursor(encodeLogSortCursor({ v: null, id: 'log-1' }))).toEqual({
      v: null,
      id: 'log-1',
    })
  })

  it('rejects a token carrying no usable position', () => {
    expect(decodeLogSortCursor('not-base64-json')).toBeNull()
    expect(decodeLogSortCursor(Buffer.from('{"v":1}').toString('base64'))).toBeNull()
  })
})

describe('buildLogSortCursorCondition', () => {
  it('adds no predicate for the first page', () => {
    expect(buildLogSortCursorCondition(null, 'expr', 'id', 'desc')).toBeUndefined()
  })

  /**
   * The regression guard. Under `NULLS LAST` the null-valued rows form a block
   * strictly AFTER every non-null row, so while the anchor is still non-null
   * they are genuinely after the cursor and must stay in the candidate set —
   * `ORDER BY` plus `LIMIT` is what keeps them off the page until the non-null
   * rows run out.
   *
   * Dropping the disjunct as a "duplicate rows" fix does the opposite of fixing
   * anything: the only way to reach the null branch below is to be handed a
   * null-valued row to anchor on, which can only happen if the null block was
   * reachable in the first place. Remove it and every run with no recorded
   * duration or cost becomes permanently unreachable through pagination.
   */
  it('keeps null-valued rows reachable while the anchor is still non-null', () => {
    const condition = buildLogSortCursorCondition({ v: 120, id: 'log-1' }, 'expr', 'id', 'desc')

    expect(sqlText(condition)).toContain('IS NULL')
    expect(sqlText(condition)).toContain('IS NOT NULL')
  })

  /**
   * Once the anchor is itself null the walk is inside the null block, where the
   * only ordering left is the id tiebreak — so the value comparison must drop
   * out entirely. `expr = NULL` is never true, so leaving it in would stall the
   * walk on the first null row.
   */
  it('pages the null block by id alone once the anchor is null', () => {
    const condition = buildLogSortCursorCondition({ v: null, id: 'log-1' }, 'expr', 'id', 'desc')

    expect(sqlText(condition)).toContain('IS NULL')
    expect(sqlText(condition)).not.toContain('IS NOT NULL')
  })

  it('compares in the direction the page was ordered', () => {
    const ascending = buildLogSortCursorCondition({ v: 120, id: 'log-1' }, 'expr', 'id', 'asc')
    const descending = buildLogSortCursorCondition({ v: 120, id: 'log-1' }, 'expr', 'id', 'desc')

    expect(comparators(ascending)).toEqual(['>', '>'])
    expect(comparators(descending)).toEqual(['<', '<'])
  })
})
