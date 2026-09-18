/** Real PostgreSQL contention and deletion exclusion through source lifecycle entry points. */
import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'

vi.mock('@/lib/knowledge/documents/service', async (original) => ({
  ...(await original<typeof import('@/lib/knowledge/documents/service')>()),
  processDocumentsWithQueue: vi.fn(async (documents: unknown[]) => ({
    requested: documents.length,
    accepted: documents.length,
    failed: 0,
  })),
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { deferConnectorSync } from '@/lib/knowledge/connectors/sync-deferral'
import { completeSuccessfulSync } from '@/lib/knowledge/connectors/sync-engine'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { sweepStuckDocuments } from '@/lib/knowledge/connectors/sync-primitives'
import { processDocumentsWithQueue } from '@/lib/knowledge/documents/service'
import { deleteKnowledgeBase } from '@/lib/knowledge/service'
import { GitHubRequestDeferredError } from '@/connectors/github/request'
import type { SyncResult } from '@/connectors/types'

const WAIT_OPTIONS = { interval: 5, timeout: 5000 }
const ACTIONS = ['complete', 'defer', 'recover'] as const
type Action = (typeof ACTIONS)[number]

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((ready) => {
    resolve = ready
  })
  return { promise, resolve }
}

function emptyResult(): SyncResult {
  return {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    processingDispatch: { requested: 0, accepted: 0, failed: 0 },
  }
}

describe('source lifecycle KB guards', () => {
  let ids: ReturnType<typeof createKnowledgeAclFixtureIds>
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  let retryDocumentId: string

  beforeEach(async () => {
    ids = createKnowledgeAclFixtureIds()
    await seedKnowledgeAclFixture(ids)
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    await db.insert(knowledgeConnectorSyncLog).values({
      id: ids.lockId,
      connectorId: ids.connectorId,
      status: 'started',
    })
    retryDocumentId = generateId()
    const old = new Date(Date.now() - 24 * 60 * 60_000)
    await db.insert(document).values({
      id: retryDocumentId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId: ids.connectorId,
      filename: 'Retained fixture.txt',
      fileUrl: 'data:text/plain,fixture',
      fileSize: 7,
      mimeType: 'text/plain',
      contentHash: 'fixture',
      storageKey: 'fixture-retained',
      processingStatus: 'failed',
      processingAttempts: 1,
      processingCompletedAt: old,
      uploadedAt: old,
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  })
  afterAll(async () => {
    await db.$client.end()
  })

  function run(action: Action) {
    const result = emptyResult()
    const lease = createContentSyncLease(ids.connectorId, ids.lockId)
    if (action === 'complete') {
      return completeSuccessfulSync(
        ids.connectorId,
        ids.knowledgeBaseId,
        ids.lockId,
        60,
        result,
        null
      )
    }
    if (action === 'defer') {
      return deferConnectorSync({
        connectorId: ids.connectorId,
        knowledgeBaseId: ids.knowledgeBaseId,
        runId: ids.lockId,
        lease,
        kind: 'content',
        result,
        error: new GitHubRequestDeferredError(60_000),
      })
    }
    return sweepStuckDocuments({
      connectorId: ids.connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      syncStartedAt: new Date(),
      retryCutoff: new Date(Date.now() - 7 * 24 * 60 * 60_000),
      billingAttribution: billing,
      result,
      lease,
    })
  }

  async function wrote(action: Action, tx: DbTransaction) {
    if (action === 'recover') {
      const [row] = await tx
        .select({ status: document.processingStatus })
        .from(document)
        .where(eq(document.id, retryDocumentId))
      return row.status === 'pending'
    }
    const [row] = await tx
      .select({ status: knowledgeConnectorSyncLog.status })
      .from(knowledgeConnectorSyncLog)
      .where(eq(knowledgeConnectorSyncLog.id, ids.lockId))
    return row.status !== 'started'
  }

  function holdCommit(action: Action) {
    const gate = { pid: undefined as number | undefined, release: deferred() }
    const transaction = db.transaction.bind(db)
    vi.spyOn(db, 'transaction').mockImplementation((callback, config) =>
      transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`)
        await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '15s'`)
        const result = await callback(tx)
        if (gate.pid === undefined && (await wrote(action, tx))) {
          const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
          gate.pid = backend.pid
          await gate.release.promise
        }
        return result
      }, config)
    )
    return gate
  }

  it.each(ACTIONS)(
    '%s can commit while an unrelated embedding holds the KB key-share lock',
    async (action) => {
      const release = deferred()
      const acquired = deferred()
      const holding = db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '15s'`)
        await tx
          .select({ id: knowledgeBase.id })
          .from(knowledgeBase)
          .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
          .for('key share')
        acquired.resolve()
        await release.promise
      })
      await acquired.promise
      const completed = Promise.allSettled([run(action)])
      let settled = false
      void completed.then(() => {
        settled = true
      })
      try {
        await expect.poll(() => settled, WAIT_OPTIONS).toBe(true)
        expect(await completed).toMatchObject([{ status: 'fulfilled' }])
      } finally {
        release.resolve()
        await holding
        await completed
      }
    }
  )

  it.each(ACTIONS)('%s keeps soft deletion excluded until its commit', async (action) => {
    const gate = holdCommit(action)
    const completed = Promise.allSettled([run(action)])
    let deleted: Promise<PromiseSettledResult<void>[]> | undefined
    try {
      await expect.poll(() => gate.pid, WAIT_OPTIONS).toBeDefined()
      deleted = Promise.allSettled([deleteKnowledgeBase(ids.knowledgeBaseId, 'fixture-delete')])
      await expect
        .poll(async () => {
          const [waiter] = await db.execute<{ pid: number }>(sql`
          SELECT pid FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND ${gate.pid!} = ANY(pg_blocking_pids(pid)) LIMIT 1
        `)
          return waiter?.pid
        }, WAIT_OPTIONS)
        .toBeDefined()
      const [active] = await db
        .select({ deletedAt: knowledgeBase.deletedAt })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      expect(active.deletedAt).toBeNull()
      gate.release.resolve()
      expect(await completed).toMatchObject([{ status: 'fulfilled' }])
      expect(await deleted).toMatchObject([{ status: 'fulfilled' }])
      const [archived] = await db
        .select({ id: document.id })
        .from(document)
        .where(and(eq(document.id, retryDocumentId), isNotNull(document.archivedAt)))
      expect(archived?.id).toBe(retryDocumentId)
    } finally {
      gate.release.resolve()
      await completed
      await deleted
    }
  })

  it.each(ACTIONS)('%s cannot commit writes from a replaced connector lease', async (action) => {
    await db
      .update(knowledgeConnector)
      .set({ syncLockToken: generateId() })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    await Promise.allSettled([run(action)])
    const [log] = await db
      .select({ status: knowledgeConnectorSyncLog.status })
      .from(knowledgeConnectorSyncLog)
      .where(eq(knowledgeConnectorSyncLog.id, ids.lockId))
    expect(log.status).toBe('started')
    const [unchanged] = await db
      .select({ status: document.processingStatus })
      .from(document)
      .where(eq(document.id, retryDocumentId))
    expect(unchanged.status).toBe('failed')
  })

  it('moves an expired queued generation charge to its replacement instead of adding one', async () => {
    const stampedAt = new Date(Date.now() - 24 * 60 * 60_000)
    await db
      .update(document)
      .set({
        processingStatus: 'pending',
        processingAttempts: 2,
        processingQueuedAt: stampedAt,
        processingQueueToken: 'expired-generation',
        processingCompletedAt: null,
      })
      .where(eq(document.id, retryDocumentId))
    await run('recover')
    const [row] = await db
      .select({
        status: document.processingStatus,
        attempts: document.processingAttempts,
        token: document.processingQueueToken,
      })
      .from(document)
      .where(eq(document.id, retryDocumentId))
    expect(row).toEqual({ status: 'pending', attempts: 1, token: null })
    expect(vi.mocked(processDocumentsWithQueue).mock.lastCall?.[0]).toEqual([
      expect.objectContaining({ documentId: retryDocumentId }),
    ])
  })

  it.each([
    ['failed', {}],
    ['stale processing', { processingStatus: 'processing', processingStartedAt: new Date(0) }],
  ] as const)('keeps the charge of a %s attempt that reached a worker', async (_state, row) => {
    await db
      .update(document)
      .set({ ...row, processingAttempts: 2, processingQueuedAt: new Date(0) })
      .where(eq(document.id, retryDocumentId))
    await run('recover')
    const [after] = await db
      .select({ status: document.processingStatus, attempts: document.processingAttempts })
      .from(document)
      .where(eq(document.id, retryDocumentId))
    expect(after).toEqual({ status: 'pending', attempts: 2 })
  })
})
