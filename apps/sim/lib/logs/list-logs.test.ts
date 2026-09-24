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

import { listLogsQuerySchema } from '@/lib/api/contracts/logs'
import { type ReadLogsParams, readLogs } from '@/lib/logs/list-logs'
import { decodeLogSortCursor } from '@/lib/logs/sort-cursor'

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

function baseParams(overrides: Partial<ReadLogsParams> = {}): ReadLogsParams {
  return {
    workspaceId: 'ws-1',
    limit: 100,
    sortBy: 'date',
    sortOrder: 'desc',
    hideCostInfo: false,
    ...overrides,
  }
}

describe('readLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('merges workflow and job rows into summaries', async () => {
    queueTableRows(workflowExecutionLogs, [workflowRow()])
    queueTableRows(jobExecutionLogs, [jobRow()])

    const result = await readLogs(baseParams())

    expect(result.data).toHaveLength(2)
    const wf = result.data.find((r) => r.id === 'log-1')!
    expect(wf).toMatchObject({
      executionId: 'exec-1',
      workflowId: 'wf-1',
      executionOrigin: null,
      cost: { total: 0.1 },
      duration: '1000ms',
      jobTitle: null,
    })
    const job = result.data.find((r) => r.id === 'job-log-1')!
    expect(job).toMatchObject({
      executionId: 'job-exec-1',
      workflowId: null,
      executionOrigin: null,
      jobTitle: 'Nightly report',
    })
    expect(result.nextCursor).toBeNull()
  })

  it('exposes the durable workflow-group origin discriminator', async () => {
    queueTableRows(workflowExecutionLogs, [
      workflowRow({ executionOrigin: 'workflow_group', trigger: 'table' }),
    ])
    queueTableRows(jobExecutionLogs, [])

    const result = await readLogs(baseParams())

    expect(result.data[0]).toMatchObject({
      executionId: 'exec-1',
      trigger: 'table',
      executionOrigin: 'workflow_group',
    })
  })

  it('returns a decodable nextCursor when results exceed the limit', async () => {
    // limit 1, two workflow rows → page of 1, hasMore true
    queueTableRows(workflowExecutionLogs, [
      workflowRow({ id: 'log-a', sortValue: new Date('2026-01-02T00:00:00.000Z') }),
      workflowRow({ id: 'log-b', sortValue: new Date('2026-01-01T00:00:00.000Z') }),
    ])
    queueTableRows(jobExecutionLogs, [])

    const result = await readLogs(baseParams({ limit: 1 }))

    expect(result.data).toHaveLength(1)
    expect(result.nextCursor).not.toBeNull()
    const decoded = decodeLogSortCursor(result.nextCursor!)
    expect(decoded?.id).toBe('log-a')
  })

  it('excludes job logs when a workflow-specific filter is present', async () => {
    queueTableRows(workflowExecutionLogs, [workflowRow()])

    const result = await readLogs(baseParams({ workflowIds: 'wf-1' }))

    // Only the workflow query runs; the job query is Promise.resolve([]).
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].workflowId).toBe('wf-1')
  })

  it('resolves the snapshot on the server and applies its upper bound to both run sources', async () => {
    const now = '2026-09-24T15:45:00.000Z'
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
    try {
      const result = await readLogs(baseParams({ snapshotAt: 'now' }))
      expect(result.snapshotAt).toBe(now)
      for (const table of [workflowExecutionLogs, jobExecutionLogs]) {
        expect(dbChainMockFns.where).toHaveBeenCalledWith(
          expect.objectContaining({
            args: expect.arrayContaining([{ type: 'lte', args: [table.startedAt, new Date(now)] }]),
          })
        )
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts new workflow and job runs with the same exclusive lower bound as the row query', async () => {
    const startedAfter = '2026-09-24T15:45:00.000Z'
    queueTableRows(workflowExecutionLogs, [])
    queueTableRows(jobExecutionLogs, [])
    queueTableRows(workflowExecutionLogs, [{ count: 3 }])
    queueTableRows(jobExecutionLogs, [{ count: 2 }])

    const result = await readLogs(baseParams({ startedAfter, includeTotal: true, limit: 1 }))
    expect(result.total).toBe(5)
    for (const table of [workflowExecutionLogs, jobExecutionLogs]) {
      const matchingCalls = dbChainMockFns.where.mock.calls.filter(([condition]) =>
        condition.args.some(
          (item: { type: string; args: unknown[] }) =>
            item.type === 'gt' &&
            item.args[0] === table.startedAt &&
            item.args[1] instanceof Date &&
            item.args[1].toISOString() === startedAfter
        )
      )
      expect(matchingCalls).toHaveLength(2)
    }
  })

  it('validates snapshot boundaries without changing ordinary list requests', () => {
    expect(listLogsQuerySchema.parse({ workspaceId: 'ws-1' }).snapshotAt).toBeUndefined()
    for (const field of ['snapshotAt', 'startedAfter']) {
      expect(
        listLogsQuerySchema.safeParse({ workspaceId: 'ws-1', [field]: 'invalid' }).success
      ).toBe(false)
    }
  })

  it('counts matching new runs without fetching or sorting log rows', async () => {
    const startedAfter = '2026-09-24T15:45:00.000Z'
    queueTableRows(workflowExecutionLogs, [{ count: 3 }])
    queueTableRows(jobExecutionLogs, [{ count: 2 }])

    const result = await readLogs(baseParams({ countOnly: true, startedAfter, sortBy: 'cost' }))

    expect(result).toEqual({ data: [], nextCursor: null, total: 5 })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
    for (const table of [workflowExecutionLogs, jobExecutionLogs]) {
      expect(dbChainMockFns.where).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining([
            { type: 'gt', args: [table.startedAt, new Date(startedAfter)] },
          ]),
        })
      )
    }
  })

  it('preserves workflow-specific filters for count-only requests', async () => {
    queueTableRows(workflowExecutionLogs, [{ count: 3 }])

    const result = await readLogs(baseParams({ countOnly: true, workflowIds: 'wf-1' }))

    expect(result.total).toBe(3)
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('captures rows and the membership revision in one repeatable-read snapshot', async () => {
    queueTableRows(workflowExecutionLogs, [workflowRow()])
    queueTableRows(jobExecutionLogs, [])
    queueTableRows(workflowExecutionLogs, [{ count: 1, revision: '1234567890123456789' }])
    queueTableRows(jobExecutionLogs, [{ count: 0, revision: '0' }])

    const result = await readLogs(baseParams({ includeRevision: true, snapshotAt: 'now' }))

    expect(dbChainMockFns.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
    expect(result.data).toHaveLength(1)
    expect(result.revision).toBe('1:1234567890123456789:0:0')
    expect(result.total).toBeUndefined()
  })

  it('reads a membership revision without loading rows or joining unrelated tables', async () => {
    queueTableRows(workflowExecutionLogs, [{ count: 2, revision: '9' }])
    queueTableRows(jobExecutionLogs, [{ count: 1, revision: '4' }])

    const result = await readLogs(
      baseParams({ countOnly: true, includeRevision: true, snapshotAt: '2026-01-01T00:00:00.000Z' })
    )

    expect(result.revision).toBe('2:9:1:4')
    expect(result.total).toBe(3)
    expect(result.data).toEqual([])
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
    expect(dbChainMockFns.leftJoin).not.toHaveBeenCalled()
  })

  it('parses the count-only query flag without treating false as true', () => {
    expect(listLogsQuerySchema.parse({ workspaceId: 'ws-1', countOnly: true }).countOnly).toBe(true)
    expect(listLogsQuerySchema.parse({ workspaceId: 'ws-1', countOnly: 'false' }).countOnly).toBe(
      false
    )
  })
})

describe('readLogs cost projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * The list carries the same run total the detail does, so a group that
   * withholds spend on one and not the other has withheld nothing.
   */
  it('blanks the run total on workflow and job summaries alike', async () => {
    queueTableRows(workflowExecutionLogs, [workflowRow()])
    queueTableRows(jobExecutionLogs, [jobRow()])

    const result = await readLogs(baseParams({ hideCostInfo: true }))

    expect(result.data).toHaveLength(2)
    for (const summary of result.data) {
      expect(summary.cost).toBeNull()
    }
    // Nothing else about the row is withheld.
    expect(result.data.find((row) => row.id === 'log-1')).toMatchObject({
      executionId: 'exec-1',
      duration: '1000ms',
    })
  })
})
