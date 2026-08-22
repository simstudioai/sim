/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { jobLogsSelectable } from '@/lib/logs/public-filters'
import {
  decodePublicLogCursor,
  encodePublicLogCursor,
  listPublicWorkflowLogs,
  readPublicLogPage,
} from '@/lib/logs/public-queries'

describe('public log cursor', () => {
  const cursor = {
    startedAt: '2026-08-05T00:01:00.000Z',
    id: 'log-1',
    order: 'desc' as const,
  }

  it('round-trips under the order that minted it', () => {
    expect(decodePublicLogCursor(encodePublicLogCursor(cursor), 'desc')).toEqual(cursor)
  })

  it('rejects reuse under a different order', () => {
    expect(decodePublicLogCursor(encodePublicLogCursor(cursor), 'asc')).toBeNull()
  })

  it('accepts legacy cursors under the order requested by the caller', () => {
    const legacyCursor = Buffer.from(
      JSON.stringify({ startedAt: cursor.startedAt, id: cursor.id })
    ).toString('base64')

    expect(decodePublicLogCursor(legacyCursor, 'desc')).toEqual(cursor)
    expect(decodePublicLogCursor(legacyCursor, 'asc')).toEqual({ ...cursor, order: 'asc' })
  })
})

/**
 * The folder scope is resolved by the adapter, so this query sees only ids. A
 * scope that resolved to nothing has to be expressed as a predicate that matches
 * nothing: `or(undefined, undefined)` is `undefined`, which silently drops the
 * filter and returns the workspace's whole log set.
 */
describe('public workflow log folder scope', () => {
  const lastWhere = () => flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
  const isUnsatisfiable = (node: Record<string, unknown>) =>
    (node.strings as readonly string[] | undefined)?.[0] === 'false'

  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(schemaMock.workflowExecutionLogs, [])
  })

  async function list(folderScope?: { includesRoot: boolean; folderIds: string[] }) {
    await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1' },
      limit: 50,
      includeExecutionData: false,
      folderScope,
    })
  }

  it('matches no rows when the scope names neither the root nor a folder', async () => {
    await list({ includesRoot: false, folderIds: [] })

    expect(lastWhere().some(isUnsatisfiable)).toBe(true)
  })

  it('constrains to the resolved folders when the scope names some', async () => {
    await list({ includesRoot: false, folderIds: ['folder-1'] })

    expect(lastWhere().some(isUnsatisfiable)).toBe(false)
    expect(lastWhere().some((node) => node.type === 'inArray')).toBe(true)
  })

  it('adds no folder predicate when the caller sent no folder filter', async () => {
    await list()

    expect(lastWhere().some(isUnsatisfiable)).toBe(false)
  })
})

/**
 * A job run has no workflow, no folder, no model projection, and no comparable
 * persisted status, so a filter naming any of those cannot be satisfied by a job
 * row. Dropping the branch is the honest answer; applying the filter to half the
 * sequence and ignoring it for the other half would make one param mean two
 * different things.
 */
describe('job-run union', () => {
  const base = { workspaceId: 'workspace-1' }

  it('selects job runs when every active filter can apply to them', () => {
    expect(jobLogsSelectable({ ...base, level: 'error', triggers: ['mothership'] })).toBe(true)
  })

  it.each([
    ['workflowIds', { workflowIds: ['workflow-1'] }],
    ['folderIds', { folderIds: ['folder-1'] }],
    ['workflowName', { workflowName: 'support' }],
    ['model', { model: 'gpt-5' }],
    ['statuses', { statuses: ['completed' as const] }],
  ])('drops the job branch when %s is set', (_field, filter) => {
    expect(jobLogsSelectable({ ...base, ...filter })).toBe(false)
  })
})

describe('unioned public log page', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('reads only workflow logs when job runs are not requested', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [])

    const { data } = await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1' },
      limit: 50,
      includeExecutionData: false,
    })

    expect(data).toEqual([])
    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
  })

  it('reads both tables when job runs are requested', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [])
    queueTableRows(schemaMock.jobExecutionLogs, [])

    await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1' },
      limit: 50,
      includeExecutionData: false,
      includeJobRuns: true,
    })

    expect(dbChainMockFns.from).toHaveBeenCalledTimes(2)
  })

  it('skips the job read when a filter no job row could satisfy is set', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [])

    await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1', model: 'gpt-5' },
      limit: 50,
      includeExecutionData: false,
      includeJobRuns: true,
    })

    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
  })

  // The public surface carries its folder filter in `folderScope`, never in
  // `filters.folderIds`, so asserting on `jobLogsSelectable` alone cannot see
  // this case: a folder-scoped page would union in every job run in the
  // workspace while reporting itself as scoped.
  it('skips the job read when the page is scoped to a folder', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [])

    await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1' },
      folderScope: { folderIds: ['folder-1'], includesRoot: false },
      limit: 50,
      includeExecutionData: false,
      includeJobRuns: true,
    })

    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
  })

  it('tags every row with the table it came from', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { id: 'w-1', startedAt: new Date('2026-08-06T00:00:02Z') },
    ])
    queueTableRows(schemaMock.jobExecutionLogs, [
      { id: 'j-1', startedAt: new Date('2026-08-06T00:00:01Z') },
    ])

    const { data } = await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1' },
      limit: 50,
      includeExecutionData: false,
      includeJobRuns: true,
    })

    expect(data.map((row) => [row.kind, row.id])).toEqual([
      ['workflow', 'w-1'],
      ['job', 'j-1'],
    ])
  })

  it('merges the two branches into the requested order', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { id: 'w-1', startedAt: new Date('2026-08-06T00:00:02Z') },
    ])
    queueTableRows(schemaMock.jobExecutionLogs, [
      { id: 'j-1', startedAt: new Date('2026-08-06T00:00:01Z') },
    ])

    const { data } = await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1', order: 'asc' },
      limit: 50,
      includeExecutionData: false,
      includeJobRuns: true,
    })

    expect(data.map((row) => row.id)).toEqual(['j-1', 'w-1'])
  })

  /**
   * Both tables order by `(startedAt, id)` and both ids are globally unique, so
   * the cursor the merged page mints names one position in the merged sequence.
   */
  it('mints its cursor from the last row of the merged page, whichever table it came from', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { id: 'w-1', startedAt: new Date('2026-08-06T00:00:03Z') },
    ])
    queueTableRows(schemaMock.jobExecutionLogs, [
      { id: 'j-1', startedAt: new Date('2026-08-06T00:00:02Z') },
    ])

    const { nextCursor } = await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1' },
      limit: 1,
      includeExecutionData: false,
      includeJobRuns: true,
    })

    expect(decodePublicLogCursor(nextCursor as string, 'desc')).toEqual({
      startedAt: '2026-08-06T00:00:03.000Z',
      id: 'w-1',
      order: 'desc',
    })
  })
})

/**
 * A keyset cannot compare against null — `value < NULL` is unknown, so a null
 * row is neither before nor after the cursor and the page boundary either
 * duplicates or drops it. Reading the two nullable sort columns through a
 * sentinel is what makes the ordering total.
 */
describe('sortable public log query', () => {
  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(schemaMock.workflowExecutionLogs, [])
  })

  const orderedSql = () =>
    (dbChainMockFns.orderBy.mock.calls.at(-1) ?? [])
      .map((clause) => {
        const column = (clause as { column?: unknown }).column
        return (column as { toSQL?: () => { sql: string } })?.toSQL?.().sql ?? String(column)
      })
      .join(' | ')

  async function query(sortBy: 'startedAt' | 'durationMs' | 'cost' | 'status') {
    await readPublicLogPage({
      filters: { workspaceId: 'workspace-1' },
      includeExecutionData: false,
      sortBy,
      sortOrder: 'desc',
      cursorKeys: undefined,
      limit: 50,
    })
  }

  it.each([['durationMs'], ['cost']] as const)(
    'reads the nullable %s column through a sentinel so the ordering is total',
    async (sortBy) => {
      await query(sortBy)

      expect(orderedSql()).toContain('COALESCE')
    }
  )

  it.each([['startedAt'], ['status']] as const)(
    'leaves the non-null %s column alone',
    async (sortBy) => {
      await query(sortBy)

      expect(orderedSql()).not.toContain('COALESCE')
    }
  )

  /** Without the unique trailing key, rows tied on the sort column repeat or vanish across pages. */
  it('always ends the keyset in a unique column', async () => {
    await query('status')

    expect(dbChainMockFns.orderBy.mock.calls.at(-1)).toHaveLength(2)
  })

  /**
   * `cost_total` is an unconstrained `numeric`, which node-postgres returns as a
   * string precisely because float64 cannot hold every value it can store.
   * Minting the anchor through `Number()` narrows it, and the narrowed value is
   * then compared back against full-precision `numeric` — so rows that differ
   * only beyond float64 precision collapse onto one anchor and the page
   * boundary skips or repeats them.
   */
  it('carries the cost anchor at full numeric precision', async () => {
    const costTotal = '0.12345678901234567890123'
    expect(String(Number(costTotal))).not.toBe(costTotal)
    resetDbChainMock()
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { id: 'w-1', costTotal, startedAt: new Date('2026-08-06T00:00:01.000Z') },
      { id: 'w-2', costTotal, startedAt: new Date('2026-08-06T00:00:00.000Z') },
    ])

    const page = await readPublicLogPage({
      filters: { workspaceId: 'workspace-1' },
      includeExecutionData: false,
      sortBy: 'cost',
      sortOrder: 'desc',
      cursorKeys: undefined,
      limit: 1,
    })

    expect(page.nextCursorKeys).toEqual([costTotal, 'w-1'])
  })

  /** An unsettled run has no cost, and its sentinel has to bind back as `numeric` too. */
  it('anchors an unsettled run on the cost sentinel', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { id: 'w-1', costTotal: null, startedAt: new Date('2026-08-06T00:00:01.000Z') },
      { id: 'w-2', costTotal: null, startedAt: new Date('2026-08-06T00:00:00.000Z') },
    ])

    const page = await readPublicLogPage({
      filters: { workspaceId: 'workspace-1' },
      includeExecutionData: false,
      sortBy: 'cost',
      sortOrder: 'desc',
      cursorKeys: undefined,
      limit: 1,
    })

    expect(page.nextCursorKeys).toEqual(['-1', 'w-1'])
  })

  it('over-fetches one row so the next page can be answered without a count', async () => {
    await query('startedAt')

    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(51)
  })
})
