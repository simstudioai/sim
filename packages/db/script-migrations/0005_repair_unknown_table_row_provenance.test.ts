/**
 * @vitest-environment node
 */
import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { repairUnknownTableRowProvenance } from './0005_repair_unknown_table_row_provenance'

interface PageResult {
  candidates: number
  repaired: number
  lastRowId: string | null
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Replays a scripted sequence of pages and records the `afterRowId` each pass asked for. */
function createSqlHarness(pages: PageResult[]): {
  sql: Sql
  cursors: unknown[]
  statements: string[]
} {
  const cursors: unknown[] = []
  const statements: string[] = []
  let call = 0
  const query = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(normalizeSql(strings.join('?')))
    /** `afterRowId` is interpolated before the page size, so it is the first bound value. */
    cursors.push(values[0])
    const page = pages[call] ?? { candidates: 0, repaired: 0, lastRowId: null }
    call += 1
    return Promise.resolve([page])
  })
  return { sql: query as unknown as Sql, cursors, statements }
}

describe('0005 repair unknown table row provenance', () => {
  /**
   * A provenance-aware write commits its exact sidecar between this statement's snapshot and its
   * delete. Matching on the captured id alone would drop that fresh sidecar and clear the marker
   * behind it, leaving a secret-bearing row reading as legacy — provenance destroyed by the repair
   * meant to make provenance safe. The re-check is what makes the writer's row stop matching.
   */
  it('only deletes sidecars still reading unknown', async () => {
    const { sql, statements } = createSqlHarness([
      { candidates: 1, repaired: 1, lastRowId: 'row-1' },
      { candidates: 0, repaired: 0, lastRowId: null },
    ])

    await repairUnknownTableRowProvenance.up(sql)

    expect(statements[0]).toContain('DELETE FROM user_table_row_secret_provenance')
    expect(statements[0]).toContain("AND status = 'unknown'")
  })

  /**
   * A page whose rows were all repaired by a concurrent writer clears nothing. Stopping there would
   * have ended the walk and left the rest of the backlog untouched.
   */
  it('keeps walking past a page a concurrent writer already repaired', async () => {
    const { sql, cursors } = createSqlHarness([
      { candidates: 2, repaired: 0, lastRowId: 'row-2' },
      { candidates: 1, repaired: 1, lastRowId: 'row-9' },
      { candidates: 0, repaired: 0, lastRowId: null },
    ])

    await repairUnknownTableRowProvenance.up(sql)

    expect(cursors).toEqual(['', 'row-2', 'row-9'])
  })

  it('stops on the first page with no candidates left', async () => {
    const { sql, cursors } = createSqlHarness([
      { candidates: 1, repaired: 1, lastRowId: 'row-1' },
      { candidates: 0, repaired: 0, lastRowId: null },
    ])

    await repairUnknownTableRowProvenance.up(sql)

    expect(cursors).toEqual(['', 'row-1'])
  })
})
