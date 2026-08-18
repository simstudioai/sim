/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_JOB_FIELDS,
  type LatestJobRow,
  latestJobsForTables,
  latestNonExportJobJson,
  mapJobRow,
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
  it('returns the empty fields when the table has no job row', () => {
    expect(mapJobRow(null)).toEqual(EMPTY_JOB_FIELDS)
    expect(mapJobRow(undefined)).toEqual(EMPTY_JOB_FIELDS)
  })

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

  it('carries a failed job error through', () => {
    expect(mapJobRow(job({ status: 'failed', error: 'boom' }))).toMatchObject({
      jobStatus: 'failed',
      jobError: 'boom',
    })
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

  it('takes the single newest job by started_at', () => {
    const { text, values } = renderLateral()
    expect(text).toContain('order by ? desc')
    expect(text).toContain('limit 1')
    expect(values).toContain(schemaMock.tableJobs.startedAt)
  })

  it('correlates the subquery to the outer table id', () => {
    const { text, values } = renderLateral()
    expect(text).toContain('where ? = ?')
    expect(values).toContain(schemaMock.tableJobs.tableId)
    expect(values).toContain(schemaMock.userTableDefinitions.id)
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
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('selects doomedCount rather than the whole payload column', async () => {
    await latestJobsForTables(['table-1'])

    const projection = dbChainMockFns.selectDistinctOn.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(projection)).toEqual([
      'tableId',
      'id',
      'type',
      'status',
      'rowsProcessed',
      'error',
      'doomedCount',
    ])
    expect(projection).not.toHaveProperty('payload')
    expect(projection.doomedCount).not.toBe(schemaMock.tableJobs.payload)
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
