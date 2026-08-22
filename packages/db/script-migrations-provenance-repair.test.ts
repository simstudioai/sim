/**
 * @vitest-environment node
 */
import type { Sql } from 'postgres'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { repairUnknownTableRowProvenance } from './script-migrations/0005_repair_unknown_table_row_provenance'
import { repairUnknownWorkspaceFileProvenance } from './script-migrations/0007_repair_unknown_workspace_file_provenance'

/** Flattens a tagged-template call back to comparable statement text. */
function toStatement(strings: TemplateStringsArray): string {
  return strings.join(' ').replace(/\s+/g, ' ').trim()
}

interface RecordingSql {
  sql: Sql
  statements: string[]
}

/**
 * A `postgres` stand-in that records statement order and answers each query by shape.
 *
 * The candidate select yields one id on the first page and nothing on the second, so the keyset
 * walk terminates; the delete reports that id as cleared. Enough for the repair to complete one
 * full page, which is all the ordering assertions need.
 */
function createRecordingSql(sidecarTable: string): RecordingSql {
  const statements: string[] = []
  let candidatePages = 0

  const respond = (statement: string): unknown[] => {
    if (statement.includes(`FROM ${sidecarTable}`) && statement.includes('LIMIT')) {
      candidatePages += 1
      return candidatePages === 1 ? [{ rowId: 'id-1', fileId: 'id-1' }] : []
    }
    if (statement.startsWith('DELETE')) return [{ rowId: 'id-1', fileId: 'id-1' }]
    if (statement.startsWith('UPDATE')) return [{ id: 'id-1' }]
    return []
  }

  const query = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const statement = toStatement(strings)
    statements.push(statement)
    return Promise.resolve(respond(statement))
  }

  const sql = Object.assign(query, {
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
    unsafe: (statement: string) => {
      statements.push(statement)
      return Promise.resolve([])
    },
  }) as unknown as Sql

  return { sql, statements }
}

/**
 * Both repairs clear a sidecar row and then clear its parent's version marker, which the live
 * writers do in the opposite order — parent first, sidecar second, one transaction. Taking two
 * locks in two orders is a deadlock, and Postgres resolves it by aborting somebody: either the
 * deployment running the repair or a tenant's write. This has now been introduced twice, once per
 * migration, so it is pinned rather than reasoned about.
 */
describe('unknown provenance repair lock order', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('locks user_table_rows before deleting the row sidecar', async () => {
    const { sql, statements } = createRecordingSql('user_table_row_secret_provenance')
    await repairUnknownTableRowProvenance.up(sql)

    const lockIndex = statements.findIndex(
      (statement) => statement.includes('FROM user_table_rows') && statement.includes('FOR UPDATE')
    )
    const deleteIndex = statements.findIndex((statement) => statement.startsWith('DELETE'))

    expect(lockIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeGreaterThanOrEqual(0)
    expect(lockIndex).toBeLessThan(deleteIndex)
  })

  it('locks workspace_files before deleting the file sidecar', async () => {
    const { sql, statements } = createRecordingSql('workspace_file_secret_provenance')
    await repairUnknownWorkspaceFileProvenance.up(sql)

    const lockIndex = statements.findIndex(
      (statement) => statement.includes('FROM workspace_files') && statement.includes('FOR UPDATE')
    )
    const deleteIndex = statements.findIndex((statement) => statement.startsWith('DELETE'))

    expect(lockIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeLessThan(statements.length)
    expect(lockIndex).toBeLessThan(deleteIndex)
  })

  /**
   * The lock has to cover every id the delete will touch, not just the first. A per-id lock taken
   * inside the delete's own scan would order the two operations correctly for one row and still
   * deadlock across a page.
   */
  it('locks the same page the delete clears, in id order', async () => {
    const { sql, statements } = createRecordingSql('workspace_file_secret_provenance')
    await repairUnknownWorkspaceFileProvenance.up(sql)

    const lock = statements.find(
      (statement) => statement.includes('FROM workspace_files') && statement.includes('FOR UPDATE')
    )
    expect(lock).toContain('id = ANY(')
    expect(lock).toContain('ORDER BY id')
  })

  /**
   * The reader answers `unrecorded` only for a sidecar that is version 1, bound to the file's
   * current bytes, and holding a well-formed entries array. A status-only predicate is wider than
   * that, and the extra rows are faults rather than absences — clearing one sets the version to
   * NULL, which reads back as exact-empty, promoting a refused file to positively vouched for with
   * no audit entry. Both the candidate query and the delete carry every condition.
   */
  it('targets only what the reader calls unrecorded, in the select and the delete', async () => {
    const { sql, statements } = createRecordingSql('workspace_file_secret_provenance')
    await repairUnknownWorkspaceFileProvenance.up(sql)

    const candidateSelect = statements.find(
      (statement) =>
        statement.includes('FROM workspace_file_secret_provenance') && statement.includes('LIMIT')
    )
    const deleteStatement = statements.find((statement) => statement.startsWith('DELETE'))

    for (const statement of [candidateSelect, deleteStatement]) {
      expect(statement).toContain("status = 'unknown'")
      expect(statement).toContain('secret_provenance_version = 1')
      expect(statement).toContain('content_updated_at = f.content_updated_at')
      expect(statement).toContain("jsonb_typeof(p.entries) = 'array'")
    }
  })

  /**
   * Re-checking `status = 'unknown'` under the parent lock is what stops the repair clearing a
   * sidecar a writer just made exact — which would strand a genuinely secret-bearing file reading
   * as legacy, provenance destroyed by the repair meant to make provenance safe.
   */
  it('re-checks the unknown status inside the delete', async () => {
    const { sql, statements } = createRecordingSql('workspace_file_secret_provenance')
    await repairUnknownWorkspaceFileProvenance.up(sql)

    const deleteStatement = statements.find((statement) => statement.startsWith('DELETE'))
    expect(deleteStatement).toContain("status = 'unknown'")
  })
})
