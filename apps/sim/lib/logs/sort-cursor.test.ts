/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildLogSortCursorCondition,
  decodeLogSortCursor,
  encodeLogSortCursor,
  type LogSortCursor,
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

  /**
   * Behavior, not SQL text. The disjunct assertions above are satisfied by a
   * semantically dead rewrite — `OR (${sortExpr} IS NULL AND false)` still
   * contains both `IS NULL` and `IS NOT NULL` — so the guard that actually
   * matters is walking a fixture with a null block and finding every row
   * exactly once.
   *
   * The condition is evaluated by translating the rendered predicate into the
   * equivalent JS expression rather than by matching its shape, so any rewrite
   * that changes which rows it selects fails here.
   */
  describe('paging a fixture with a null block', () => {
    const SORT = '@sort'
    const ID = '@id'

    interface Fragment {
      strings?: readonly string[]
      values?: readonly unknown[]
      rawSql?: string
    }

    /** The predicate as a JS expression over `sort` and `id`, with every value inlined. */
    function toJsExpression(fragment: unknown): string {
      const node = fragment as Fragment
      if (typeof node?.rawSql === 'string') return node.rawSql
      if (!node?.strings) {
        if (node === (SORT as unknown)) return 'sort'
        if (node === (ID as unknown)) return 'id'
        return JSON.stringify(node)
      }
      return node.strings
        .map((text, index) =>
          index < (node.values?.length ?? 0) ? text + toJsExpression(node.values![index]) : text
        )
        .join('')
        .replace(/\bIS NOT NULL\b/g, '!== null')
        .replace(/\bIS NULL\b/g, '=== null')
        .replace(/\bAND\b/g, '&&')
        .replace(/\bOR\b/g, '||')
        .replace(/(?<![<>=!])=(?!=)/g, '===')
    }

    function selects(condition: unknown, row: Row): boolean {
      const expression = toJsExpression(condition)
      return Boolean(new Function('sort', 'id', `return (${expression})`)(row.v, row.id))
    }

    interface Row {
      v: number | null
      id: string
    }

    /** `<sort> DESC NULLS LAST, <id> DESC` — the ordering the condition resumes. */
    function ordered(rows: readonly Row[]): Row[] {
      return [...rows].sort((a, b) => {
        if (a.v === null && b.v !== null) return 1
        if (b.v === null && a.v !== null) return -1
        if (a.v !== null && b.v !== null && a.v !== b.v) return b.v - a.v
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
      })
    }

    const rows: Row[] = [
      { v: 300, id: 'a' },
      { v: 200, id: 'b' },
      { v: 200, id: 'c' },
      { v: null, id: 'd' },
      { v: null, id: 'e' },
      { v: null, id: 'f' },
    ]

    it('walks every row exactly once, in order, through the null block', () => {
      const expected = ordered(rows).map((r) => r.id)
      const visited: string[] = []
      let cursor: LogSortCursor | null = null

      for (let page = 0; page < rows.length; page++) {
        const condition = buildLogSortCursorCondition(cursor, SORT, ID, 'desc')
        const candidates = condition ? rows.filter((r) => selects(condition, r)) : [...rows]
        const [next] = ordered(candidates)
        if (!next) break
        visited.push(next.id)
        cursor = { v: next.v, id: next.id }
      }

      expect(visited).toEqual(expected)
    })
  })

  it('compares in the direction the page was ordered', () => {
    const ascending = buildLogSortCursorCondition({ v: 120, id: 'log-1' }, 'expr', 'id', 'asc')
    const descending = buildLogSortCursorCondition({ v: 120, id: 'log-1' }, 'expr', 'id', 'desc')

    expect(comparators(ascending)).toEqual(['>', '>'])
    expect(comparators(descending)).toEqual(['<', '<'])
  })
})
