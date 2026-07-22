/**
 * @vitest-environment node
 */

import { jobExecutionLogs, workflowExecutionLogs } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Local drizzle-orm mock: the global mock's `sql` lacks `.as()`. We only need
// condition/sql builders to produce truthy stubs (the mocked db ignores them).
vi.mock('drizzle-orm', () => {
  const make = (): Record<string, unknown> => {
    const o: Record<string, unknown> = {}
    o.as = () => o
    o.mapWith = () => o
    return o
  }
  const sql = Object.assign((..._args: unknown[]) => make(), {
    raw: (..._args: unknown[]) => make(),
    join: (..._args: unknown[]) => make(),
  })
  const op =
    (type: string) =>
    (...args: unknown[]) => ({ type, args })
  return {
    sql,
    and: op('and'),
    or: op('or'),
    eq: op('eq'),
    ne: op('ne'),
    gt: op('gt'),
    gte: op('gte'),
    lt: op('lt'),
    lte: op('lte'),
    inArray: op('inArray'),
    isNull: op('isNull'),
    isNotNull: op('isNotNull'),
    asc: op('asc'),
    desc: op('desc'),
  }
})

vi.mock('@/lib/logs/folder-expansion', () => ({
  expandFolderIdsWithDescendants: vi.fn(async (_ws: string, ids: string | undefined) => ids),
}))

// listLogs gates workspace access at entry; the resolver is tested separately.
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: vi.fn(async () => ({
    exists: true,
    hasAccess: true,
    canWrite: true,
    canAdmin: true,
    workspace: { id: 'ws-1', name: 'Test', ownerId: 'user-1', organizationId: null },
  })),
}))

import type { ListLogsParams } from './list-logs'
import { decodeCursor, listLogs } from './list-logs'

afterAll(resetDbChainMock)

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    workflowId: 'wf-1',
    executionId: 'exec-1',
    deploymentVersionId: null,
    level: 'info',
    status: 'success',
    trigger: 'manual',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: new Date('2026-01-01T00:00:01.000Z'),
    totalDurationMs: 1000,
    costTotal: '0.1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    workflowName: 'My Workflow',
    workflowDescription: null,
    workflowFolderId: null,
    workflowUserId: 'user-1',
    workflowWorkspaceId: 'ws-1',
    workflowCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
    workflowUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    pausedStatus: null,
    pausedTotalPauseCount: 0,
    pausedResumedCount: 0,
    deploymentVersion: null,
    deploymentVersionName: null,
    sortValue: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-log-1',
    executionId: 'job-exec-1',
    level: 'info',
    status: 'success',
    trigger: 'schedule',
    startedAt: new Date('2026-01-01T00:00:05.000Z'),
    endedAt: new Date('2026-01-01T00:00:06.000Z'),
    totalDurationMs: 1000,
    cost: { total: 0.2 },
    createdAt: new Date('2026-01-01T00:00:05.000Z'),
    jobTitle: 'Nightly report',
    sortValue: new Date('2026-01-01T00:00:05.000Z'),
    ...overrides,
  }
}

function baseParams(overrides: Partial<ListLogsParams> = {}): ListLogsParams {
  return {
    workspaceId: 'ws-1',
    limit: 100,
    sortBy: 'date',
    sortOrder: 'desc',
    ...overrides,
  } as ListLogsParams
}

describe('listLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('merges workflow and job rows into summaries', async () => {
    queueTableRows(workflowExecutionLogs, [workflowRow()])
    queueTableRows(jobExecutionLogs, [jobRow()])

    const result = await listLogs(baseParams(), 'user-1')

    expect(result.data).toHaveLength(2)
    const wf = result.data.find((r) => r.id === 'log-1')!
    expect(wf).toMatchObject({
      executionId: 'exec-1',
      workflowId: 'wf-1',
      cost: { total: 0.1 },
      duration: '1000ms',
      jobTitle: null,
    })
    const job = result.data.find((r) => r.id === 'job-log-1')!
    expect(job).toMatchObject({
      executionId: 'job-exec-1',
      workflowId: null,
      jobTitle: 'Nightly report',
    })
    expect(result.nextCursor).toBeNull()
  })

  it('returns a decodable nextCursor when results exceed the limit', async () => {
    // limit 1, two workflow rows → page of 1, hasMore true
    queueTableRows(workflowExecutionLogs, [
      workflowRow({ id: 'log-a', sortValue: new Date('2026-01-02T00:00:00.000Z') }),
      workflowRow({ id: 'log-b', sortValue: new Date('2026-01-01T00:00:00.000Z') }),
    ])
    queueTableRows(jobExecutionLogs, [])

    const result = await listLogs(baseParams({ limit: 1 }), 'user-1')

    expect(result.data).toHaveLength(1)
    expect(result.nextCursor).not.toBeNull()
    const decoded = decodeCursor(result.nextCursor!)
    expect(decoded?.id).toBe('log-a')
  })

  it('excludes job logs when a workflow-specific filter is present', async () => {
    queueTableRows(workflowExecutionLogs, [workflowRow()])

    const result = await listLogs(baseParams({ workflowIds: 'wf-1' }), 'user-1')

    // Only the workflow query runs; the job query is Promise.resolve([]).
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].workflowId).toBe('wf-1')
  })
})
