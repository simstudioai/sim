/**
 * Public log paging against real PostgreSQL: the `(started_at, id)` keyset walks
 * rows that share a millisecond in their stored microsecond order, across both
 * log tables, without repeating or dropping one.
 */
import { db } from '@sim/db'
import {
  jobExecutionLogs,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import type { LogFilters } from '@/lib/logs/public-filters'
import {
  decodePublicLogCursor,
  encodePublicLogCursor,
  readPublicLogPage,
} from '@/lib/logs/public-queries'

const prefix = generateId()
const ids = {
  owner: `public-log-paging-${prefix}`,
  workspace: generateId(),
  workflow: generateId(),
  snapshot: generateId(),
}

/** Run id → microseconds past `12:00:00.123`, inverted against id order inside the millisecond. */
const WORKFLOW_RUNS = {
  [`${prefix}-0`]: -1000,
  [`${prefix}-1`]: 100,
  [`${prefix}-2`]: 500,
  [`${prefix}-3`]: 500,
  [`${prefix}-4`]: 900,
}
const JOB_RUNS = { [`${prefix}-5`]: 700 }

/** Stored order, newest first: microseconds decide, and `id` only splits the exact tie. */
const NEWEST_FIRST = [4, 5, 3, 2, 1, 0].map((n) => `${prefix}-${n}`)

function startedAt(offsetMicroseconds: number) {
  return sql`timestamp '2026-01-01 12:00:00.123' + ${offsetMicroseconds} * interval '1 microsecond'`
}

async function walk(
  filters: Omit<LogFilters, 'workspaceId'>,
  order: ListSortOrder,
  options: { includeJobRuns: boolean; cursorKeys?: CursorKey[] }
) {
  const seen: string[] = []
  const cursors: CursorKey[][] = []
  let cursorKeys = options.cursorKeys
  for (let page = 0; page <= NEWEST_FIRST.length; page++) {
    const result = await readPublicLogPage({
      filters: { ...filters, workspaceId: ids.workspace },
      limit: 1,
      includeExecutionData: false,
      includeJobRuns: options.includeJobRuns,
      sortBy: 'startedAt',
      sortOrder: order,
      cursorKeys,
    })
    seen.push(...result.data.map((row) => row.id))
    if (!result.nextCursorKeys) break
    cursors.push(result.nextCursorKeys)
    cursorKeys = result.nextCursorKeys
  }
  return { seen, cursors }
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ids.owner,
    name: 'Public Log Paging',
    email: `${ids.owner}@public-log-paging.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: ids.workspace,
    name: 'Public Log Paging',
    ownerId: ids.owner,
    billedAccountUserId: ids.owner,
  })
  await db.insert(workflow).values({
    id: ids.workflow,
    userId: ids.owner,
    workspaceId: ids.workspace,
    name: 'Public Log Paging',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workflowExecutionSnapshots).values({
    id: ids.snapshot,
    workflowId: ids.workflow,
    stateHash: ids.snapshot,
    stateData: {},
  })
  await db.insert(workflowExecutionLogs).values(
    Object.entries(WORKFLOW_RUNS).map(([id, offset]) => ({
      id,
      workflowId: ids.workflow,
      workspaceId: ids.workspace,
      executionId: generateId(),
      stateSnapshotId: ids.snapshot,
      level: 'info',
      status: 'completed',
      trigger: 'api',
      startedAt: startedAt(offset),
    }))
  )
  await db.insert(jobExecutionLogs).values(
    Object.entries(JOB_RUNS).map(([id, offset]) => ({
      id,
      workspaceId: ids.workspace,
      executionId: generateId(),
      level: 'info',
      status: 'completed',
      trigger: 'mothership',
      startedAt: startedAt(offset),
    }))
  )
}, 30_000)

afterAll(async () => {
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workspaceId, ids.workspace))
  await db.delete(jobExecutionLogs).where(eq(jobExecutionLogs.workspaceId, ids.workspace))
  await db.delete(workflowExecutionSnapshots).where(eq(workflowExecutionSnapshots.id, ids.snapshot))
  await db.delete(workflow).where(eq(workflow.id, ids.workflow))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspace))
  await db.delete(user).where(eq(user.id, ids.owner))
})

describe('public log keyset paging', () => {
  it.each([
    ['desc', NEWEST_FIRST],
    ['asc', [...NEWEST_FIRST].reverse()],
  ] as const)(
    'pages one run at a time in stored %s order across a shared millisecond and both tables',
    async (order, expected) => {
      const { seen } = await walk({}, order, { includeJobRuns: true })

      expect(seen).toEqual(expected)
    }
  )

  it('pages a workflow filter in stored order', async () => {
    const { seen } = await walk({ workflowIds: [ids.workflow] }, 'desc', {
      includeJobRuns: false,
    })

    expect(seen).toEqual(NEWEST_FIRST.filter((id) => id in WORKFLOW_RUNS))
  })

  /**
   * Earlier releases accepted any date a v1 caller sent and resumed it under
   * millisecond ordering, which `-0` (`.122`) then the `.123` runs in `id` order.
   */
  it.each([
    ['without a fraction', '2026-01-01T12:00:00Z', [0, 1, 2, 3, 4, 5]],
    ['with a four-digit fraction', '2026-01-01T12:00:00.1225Z', [1, 2, 3, 4, 5]],
  ])('resumes a v1 date cursor %s under millisecond ordering', async (_case, startedAt, rest) => {
    const cursor = decodePublicLogCursor(
      encodePublicLogCursor({ startedAt, id: `${prefix}-0`, order: 'asc' }),
      'asc'
    )
    expect(cursor).not.toBeNull()

    const { seen } = await walk({}, 'asc', {
      includeJobRuns: true,
      cursorKeys: [cursor?.startedAt ?? '', cursor?.id ?? ''],
    })

    expect(seen).toEqual(rest.map((n) => `${prefix}-${n}`))
  })

  /**
   * A cursor minted before raw ordering names a millisecond and was read under
   * millisecond-truncated ordering, where the shared millisecond fell in `id`
   * order: `-5`, then `-4`, … Resuming after `-4` must serve exactly the runs
   * that order had not reached, and keep minting cursors it can resume.
   */
  it('finishes a walk begun under a millisecond cursor in the order it began', async () => {
    const { seen, cursors } = await walk({}, 'desc', {
      includeJobRuns: true,
      cursorKeys: ['2026-01-01T12:00:00.123Z', `${prefix}-4`],
    })

    expect(seen).toEqual([3, 2, 1, 0].map((n) => `${prefix}-${n}`))
    for (const [startedAtKey] of cursors) {
      expect(startedAtKey).toMatch(/\.\d{3}Z$/)
    }
  })
})
