/**
 * @vitest-environment node
 */
import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { repairUnknownTableRowProvenance } from './0005_repair_unknown_table_row_provenance'

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Replays a scripted sequence of candidate pages and records every statement in the order it was
 * issued, so a test can assert on lock ordering rather than only on the final counts.
 */
function createSqlHarness(pages: string[][]): {
  sql: Sql
  statements: string[]
  cursors: unknown[]
} {
  const statements: string[] = []
  const cursors: unknown[] = []
  let page = 0

  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = normalizeSql(strings.join('?'))
    statements.push(text)

    if (text.startsWith('SELECT row_id AS "rowId"')) {
      cursors.push(values[0])
      const rows = (pages[page] ?? []).map((rowId) => ({ rowId }))
      page += 1
      return Promise.resolve(rows)
    }
    if (text.startsWith('DELETE FROM user_table_row_secret_provenance')) {
      const ids = (values[0] as string[]) ?? []
      return Promise.resolve(ids.map((rowId) => ({ rowId })))
    }
    if (text.startsWith('UPDATE user_table_rows')) {
      const ids = (values[0] as string[]) ?? []
      return Promise.resolve(ids.map((id) => ({ id })))
    }
    return Promise.resolve([])
  }

  const sql = run as unknown as Sql
  sql.begin = vi.fn(async (callback) => (callback as (tx: Sql) => unknown)(sql)) as Sql['begin']
  return { sql, statements, cursors }
}

describe('0005 repair unknown table row provenance', () => {
  /**
   * `mutateTableRowsWithSecretProvenance` locks `user_table_rows` up front and upserts the sidecar
   * inside the same transaction. Touching the sidecar first is the opposite order, and an
   * overlapping write would deadlock — Postgres resolving it by aborting either the deployment or
   * somebody's table write.
   */
  it('locks the parent row before touching the sidecar, in the order writers take them', async () => {
    const { sql, statements } = createSqlHarness([['row-1', 'row-2'], []])

    await repairUnknownTableRowProvenance.up(sql)

    const lockIndex = statements.findIndex((s) => s.includes('FOR UPDATE'))
    const deleteIndex = statements.findIndex((s) =>
      s.startsWith('DELETE FROM user_table_row_secret_provenance')
    )
    expect(lockIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeGreaterThan(lockIndex)
    expect(statements[lockIndex]).toContain('ORDER BY id')
  })

  /**
   * A provenance-aware write commits its exact sidecar and its marker together. Matching on the
   * captured id alone would drop that fresh sidecar and clear the marker behind it, leaving a
   * secret-bearing row reading as legacy.
   */
  it('only deletes sidecars still reading unknown', async () => {
    const { sql, statements } = createSqlHarness([['row-1'], []])

    await repairUnknownTableRowProvenance.up(sql)

    const deleteStatement = statements.find((s) =>
      s.startsWith('DELETE FROM user_table_row_secret_provenance')
    )
    expect(deleteStatement).toContain("AND status = 'unknown'")
  })

  /**
   * A page whose rows were all repaired by a concurrent writer clears nothing. Stopping there would
   * have ended the walk and left the rest of the backlog untouched.
   */
  it('keeps walking past a page a concurrent writer already repaired', async () => {
    const { sql, cursors } = createSqlHarness([['row-1', 'row-2'], ['row-9'], []])

    await repairUnknownTableRowProvenance.up(sql)

    expect(cursors).toEqual(['', 'row-2', 'row-9'])
  })

  it('stops on the first page with no candidates left', async () => {
    const { sql, cursors } = createSqlHarness([['row-1'], []])

    await repairUnknownTableRowProvenance.up(sql)

    expect(cursors).toEqual(['', 'row-1'])
  })
})
