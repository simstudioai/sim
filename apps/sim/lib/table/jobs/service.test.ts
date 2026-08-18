/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_JOB_FIELDS,
  type LatestJobRow,
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
    payload: null,
    ...overrides,
  }
}

describe('mapJobRow', () => {
  it('returns the empty fields when the table has no job row', () => {
    expect(mapJobRow(null)).toEqual(EMPTY_JOB_FIELDS)
    expect(mapJobRow(undefined)).toEqual(EMPTY_JOB_FIELDS)
  })

  it('projects a running delete job and its remaining doomed rows', () => {
    expect(mapJobRow(job({ rowsProcessed: 4, payload: { doomedCount: 10 } }))).toEqual({
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
      mapJobRow(job({ status: 'ready', rowsProcessed: 4, payload: { doomedCount: 10 } }))
        .pendingDeleteRemaining
    ).toBe(0)
  })

  it('ignores doomedCount for a running job that is not a delete', () => {
    expect(
      mapJobRow(job({ type: 'import', rowsProcessed: 4, payload: { doomedCount: 10 } }))
        .pendingDeleteRemaining
    ).toBe(0)
  })

  it('treats a missing doomedCount as zero and never goes negative', () => {
    expect(mapJobRow(job({ rowsProcessed: 4 })).pendingDeleteRemaining).toBe(0)
    expect(
      mapJobRow(job({ rowsProcessed: 25, payload: { doomedCount: 10 } })).pendingDeleteRemaining
    ).toBe(0)
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
  // LatestJobRow, Column>`. A missing field is a compile error, which is
  // stronger than anything asserted here could be.
})
