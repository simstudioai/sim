import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type LatestJobRow,
  latestJobsForTables,
  latestNonExportJobJson,
  mapJobRow,
  recordImportRejections,
  type TableImportRejectionSummary,
} from '@/lib/table/jobs/service'

function job(overrides: Partial<LatestJobRow>): LatestJobRow {
  return {
    id: 'job-1',
    type: 'delete',
    status: 'running',
    rowsProcessed: 0,
    error: null,
    doomedCount: null,
    ...overrides,
  }
}

describe('mapJobRow', () => {
  it('projects a running delete job and its remaining doomed rows', () => {
    expect(mapJobRow(job({ rowsProcessed: 4, doomedCount: 10 }))).toEqual({
      jobStatus: 'running',
      jobId: 'job-1',
      jobType: 'delete',
      jobError: null,
      jobRowsProcessed: 4,
      pendingDeleteRemaining: 6,
    })
  })

  it('ignores doomedCount once the delete job is terminal', () => {
    expect(
      mapJobRow(job({ status: 'ready', rowsProcessed: 4, doomedCount: 10 })).pendingDeleteRemaining
    ).toBe(0)
  })

  it('ignores doomedCount for a running job that is not a delete', () => {
    expect(
      mapJobRow(job({ type: 'import', rowsProcessed: 4, doomedCount: 10 })).pendingDeleteRemaining
    ).toBe(0)
  })

  it('treats a missing doomedCount as zero and never goes negative', () => {
    expect(mapJobRow(job({ rowsProcessed: 4 })).pendingDeleteRemaining).toBe(0)
    expect(mapJobRow(job({ rowsProcessed: 25, doomedCount: 10 })).pendingDeleteRemaining).toBe(0)
  })
})

/**
 * The lateral is a raw `sql` fragment, so the mocked drizzle `sql` tag is the only
 * place its text is observable — and the text IS the contract (`getTableById` would
 * otherwise silently return a different job than `latestJobsForTables` does).
 */
function renderLateral(): { text: string; values: unknown[] } {
  // double-cast-allowed: the mocked drizzle `sql` tag exposes the raw template parts
  const fragment = latestNonExportJobJson(schemaMock.userTableDefinitions.id) as unknown as {
    strings: string[]
    values: unknown[]
  }
  return { text: fragment.strings.join(' ? ').replace(/\s+/g, ' '), values: fragment.values }
}

describe('latestNonExportJobJson', () => {
  it('excludes export jobs', () => {
    expect(renderLateral().text).toContain("<> 'export'")
  })

  // No drift test for the projected field list: the fragment derives its
  // jsonb pairs from JOB_PROJECTION, which `satisfies Record<keyof
  // LatestJobRow, Column | SQL>`. A missing field is a compile error, which is
  // stronger than anything asserted here could be.

  /**
   * `table_jobs.payload` also holds a delete job's unbounded `excludeRowIds`, and
   * this read runs on essentially every table request — so selecting the whole
   * column is a payload leak the type system cannot see (`doomedCount` would still
   * be present, just derived in JS). Only the rendered pair list shows it.
   */
  it('projects doomedCount out of the payload instead of the payload column', () => {
    const pairs = renderPairs()
    expect(pairs.sql).toContain("'doomedCount'")
    expect(pairs.sql).toContain("->'doomedCount'")
    expect(pairs.sql).not.toContain("'payload'")
    expect(pairs.sql).not.toContain(', payload')
  })
})

/** The `jsonb_build_object` key/value list the lateral builds from JOB_PROJECTION. */
function renderPairs(): { sql: string; params: unknown[] } {
  // double-cast-allowed: the mocked drizzle `sql` tag exposes the raw template parts
  const fragment = latestNonExportJobJson(schemaMock.userTableDefinitions.id) as unknown as {
    values: Array<{ fragments?: unknown[]; toSQL?: () => { sql: string; params: unknown[] } }>
  }
  const join = fragment.values.find((value) => Array.isArray(value?.fragments))
  if (!join?.toSQL) throw new Error('lateral no longer builds its pairs with sql.join')
  return join.toSQL()
}

/**
 * The list endpoint runs this once per page, so the batch read must narrow too. It
 * shares JOB_PROJECTION with the lateral, and this pins that sharing down.
 */
describe('latestJobsForTables', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('still derives a running delete job from the narrowed row', async () => {
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      {
        tableId: 'table-1',
        id: 'job-1',
        type: 'delete',
        status: 'running',
        rowsProcessed: 4,
        error: null,
        doomedCount: 10,
      },
    ])

    const jobs = await latestJobsForTables(['table-1'])

    expect(jobs.get('table-1')).toMatchObject({ jobId: 'job-1', pendingDeleteRemaining: 6 })
  })
})

/**
 * The merge is hand-written SQL (`coalesce(payload, '{}'::jsonb) || $1::jsonb`) over a
 * four-clause WHERE, and the row-queue mock returns whatever was queued regardless of the
 * statement — so a canned `.returning()` cannot tell a merge from a clobbering overwrite.
 * The generated statement and condition nodes are the only place either is observable.
 */
describe('recordImportRejections', () => {
  const summary: TableImportRejectionSummary = {
    rowsRejected: 2,
    cellsRejected: 5,
    rejectedSamples: [{ code: 'CSV_QUOTE_NOT_CLOSED', line: 7, message: 'Quote not closed' }],
  }

  beforeEach(() => {
    resetDbChainMock()
  })

  it('merges the summary into the existing payload rather than replacing it', async () => {
    await recordImportRejections('table-1', 'workspace-1', 'job-1', summary)

    const update = dbChainMockFns.set.mock.calls.at(-1)?.[0] as { payload?: unknown }
    const payload = update?.payload as { toSQL?: () => { sql: string; params: unknown[] } }
    // A plain `set({ payload: summary })` writes the object itself — no fragment, no merge —
    // which is what silently drops `kind`/`userId`/`source`/`target` from the job payload.
    expect(typeof payload?.toSQL).toBe('function')

    const rendered = payload.toSQL!()
    expect(rendered.sql.replace(/\s+/g, ' ')).toBe("coalesce(?, '{}'::jsonb) || ?::jsonb")
    expect(rendered.params).toEqual([schemaMock.tableJobs.payload, JSON.stringify(summary)])
  })
})
