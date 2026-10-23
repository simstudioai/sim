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
 * The v1 route answers a cursor `decodePublicLogCursor` refuses with its own 400
 * and renders anything thrown later as a 500, so every cursor the decoder admits
 * has to page. Date-form cursors, which earlier releases minted or accepted, are
 * paged in `public-queries.integration.ts`: their keyset casts through the real
 * column type.
 */
describe('v1 cursor admission', () => {
  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(schemaMock.workflowExecutionLogs, [])
  })

  const decode = (startedAt: string) =>
    decodePublicLogCursor(encodePublicLogCursor({ startedAt, id: 'log-1', order: 'desc' }), 'desc')

  it('pages from a precise cursor', async () => {
    const cursor = decode('2024-01-01T00:00:00.123456Z')
    expect(cursor).not.toBeNull()

    await expect(
      listPublicWorkflowLogs({
        filters: { workspaceId: 'workspace-1', cursor: cursor ?? undefined },
        limit: 50,
        includeExecutionData: false,
      })
    ).resolves.toEqual({ data: [], nextCursor: null })
  })

  it.each([
    ['an impossible calendar day', '2024-02-30T00:00:00.000000Z'],
    ['a year Postgres cannot read back', '0000-01-01T00:00:00Z'],
  ])('refuses a cursor naming %s at the decoder', (_case, startedAt) => {
    expect(decode(startedAt)).toBeNull()
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

  /** Both branches order on the raw column, so a millisecond they share is split by its microseconds, not by id. */
  it('merges the two branches into the requested order at the precision they were read', async () => {
    const sharedMillisecond = new Date('2026-08-06T00:00:01.000Z')
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { id: 'w-1', startedAt: sharedMillisecond, startedAtCursor: '2026-08-06T00:00:01.000001Z' },
    ])
    queueTableRows(schemaMock.jobExecutionLogs, [
      { id: 'j-1', startedAt: sharedMillisecond, startedAtCursor: '2026-08-06T00:00:01.000002Z' },
    ])

    const { data } = await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1', order: 'asc' },
      limit: 50,
      includeExecutionData: false,
      includeJobRuns: true,
    })

    expect(data.map((row) => row.id)).toEqual(['w-1', 'j-1'])
  })

  /**
   * Both tables order by `(startedAt, id)` and both ids are globally unique, so
   * the cursor the merged page mints names one position in the merged sequence.
   */
  it('mints its cursor from the last row of the merged page, whichever table it came from', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      { id: 'w-1', startedAtCursor: '2026-08-06T00:00:03.000000Z' },
    ])
    queueTableRows(schemaMock.jobExecutionLogs, [
      { id: 'j-1', startedAtCursor: '2026-08-06T00:00:02.000000Z' },
    ])

    const { nextCursor } = await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1' },
      limit: 1,
      includeExecutionData: false,
      includeJobRuns: true,
    })

    expect(decodePublicLogCursor(nextCursor as string, 'desc')).toEqual({
      startedAt: '2026-08-06T00:00:03.000000Z',
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

/**
 * A page that carries execution data is materialized, projected, validated, and
 * serialized whole, so the caller's `limit` cannot be what sizes it. The read
 * narrows the page instead, and the narrowed page has to mint its cursor from
 * its own last row or the walk skips every row past the cut.
 */
describe('public log page carrying execution data', () => {
  const MB = 1024 * 1024

  beforeEach(() => {
    resetDbChainMock()
  })

  /** Rows in descending start order, each pointing at an archive of `archiveBytes`. */
  function archivedRows(count: number, archiveBytes: number, idPrefix = 'w', parity = 0) {
    return Array.from({ length: count }, (_, index) => {
      const slot = index * 2 + parity
      const second = String(59 - (slot % 60)).padStart(2, '0')
      const minute = String(59 - Math.floor(slot / 60)).padStart(2, '0')
      return {
        id: `${idPrefix}-${index}`,
        startedAtCursor: `2026-08-06T00:${minute}:${second}.000000Z`,
        executionData: {
          traceStoreRef: {
            __simLargeValueRef: true,
            version: 1,
            id: 'lv_bbbbbbbbbbbb',
            kind: 'object',
            size: archiveBytes,
            key: `execution/workspace-1/workflow-1/execution-${index}/large-value-lv_bbbbbbbbbbbb.json`,
            executionId: `execution-${index}`,
          },
        },
      }
    })
  }

  function readPage(input: { includeExecutionData: boolean; cursorKeys?: string[] }) {
    return readPublicLogPage({
      filters: { workspaceId: 'workspace-1' },
      includeExecutionData: input.includeExecutionData,
      sortBy: 'startedAt',
      sortOrder: 'desc',
      cursorKeys: input.cursorKeys,
      limit: 100,
    })
  }

  /**
   * Follows `nextCursorKeys` to the end, serving each page the rows strictly
   * after the cursor the way the keyset predicate would, and returns every
   * page's ids.
   */
  async function walk(rows: ReturnType<typeof archivedRows>) {
    const pages: string[][] = []
    let cursorKeys: string[] | undefined
    while (pages.length <= rows.length) {
      const after = cursorKeys ? rows.findIndex((row) => row.id === cursorKeys?.[1]) + 1 : 0
      queueTableRows(schemaMock.workflowExecutionLogs, rows.slice(after))
      const page = await readPage({ includeExecutionData: true, cursorKeys })
      pages.push(page.data.map((row) => row.id))
      if (!page.nextCursorKeys) return pages
      cursorKeys = page.nextCursorKeys as string[]
    }
    throw new Error('walk did not terminate')
  }

  it('reads at most one materialization wave of rows when execution data is requested', async () => {
    const rows = archivedRows(30, MB)

    const pages = await walk(rows)

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(21)
    expect(dbChainMockFns.limit).not.toHaveBeenCalledWith(101)
    expect(pages.map((page) => page.length)).toEqual([20, 10])
    expect(pages.flat()).toEqual(rows.map((row) => row.id))
  })

  it('cuts a page at its archive byte budget and resumes right after the cut', async () => {
    const rows = archivedRows(30, 10 * MB)

    const pages = await walk(rows)

    expect(pages.map((page) => page.length)).toEqual([6, 6, 6, 6, 6])
    expect(pages.flat()).toEqual(rows.map((row) => row.id))
  })

  it('keeps the requested page size when no execution data is read', async () => {
    const rows = archivedRows(30, MB)
    queueTableRows(schemaMock.workflowExecutionLogs, rows)

    const page = await readPage({ includeExecutionData: false })

    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(101)
    expect(page.data).toHaveLength(rows.length)
    expect(page.nextCursorKeys).toBeNull()
  })

  it('admits one run whose archive alone exceeds the budget, so the walk still advances', async () => {
    const rows = archivedRows(3, 100 * MB)
    queueTableRows(schemaMock.workflowExecutionLogs, rows)

    const page = await readPage({ includeExecutionData: true })

    expect(page.data.map((row) => row.id)).toEqual(['w-0'])
    expect(page.nextCursorKeys).toEqual([rows[0].startedAtCursor, 'w-0'])
  })

  it('budgets the merged page when job runs are interleaved with materialized runs', async () => {
    const workflowRows = archivedRows(10, 40 * MB, 'w', 0)
    const jobRows = archivedRows(10, 0, 'j', 1).map(({ id, startedAtCursor }) => ({
      id,
      startedAtCursor,
    }))
    queueTableRows(schemaMock.workflowExecutionLogs, workflowRows)
    queueTableRows(schemaMock.jobExecutionLogs, jobRows)

    const page = await readPublicLogPage({
      filters: { workspaceId: 'workspace-1' },
      includeExecutionData: true,
      includeJobRuns: true,
      sortBy: 'startedAt',
      sortOrder: 'desc',
      cursorKeys: undefined,
      limit: 100,
    })

    expect(page.data.map((row) => row.id)).toEqual(['w-0', 'j-0'])
    expect(page.nextCursorKeys).toEqual([jobRows[0].startedAtCursor, 'j-0'])
  })
})
