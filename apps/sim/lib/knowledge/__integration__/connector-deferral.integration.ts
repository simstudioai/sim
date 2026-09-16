/** Real task execution, billing ownership, PostgreSQL leases, checkpoints, and durable retry publication. */
import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    github_fixture: {
      id: 'github_fixture',
      name: 'Fixture GitHub',
      auth: { mode: 'apiKey' },
      listDocuments: fixture.list,
      getDocument: vi.fn(),
    },
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import * as connectorTokens from '@/lib/knowledge/connectors/access-token'
import { deferConnectorSync } from '@/lib/knowledge/connectors/sync-deferral'
import { createContentSyncLease, createMemberSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { executeConnectorSyncJob } from '@/background/knowledge-connector-sync'
import { GitHubRequestDeferredError } from '@/connectors/github/request'
import type { SyncResult } from '@/connectors/types'

const emptyResult = (): SyncResult => ({
  docsAdded: 0,
  docsUpdated: 0,
  docsDeleted: 0,
  docsUnchanged: 0,
  docsSkipped: 0,
  docsFailed: 0,
  processingDispatch: { requested: 0, accepted: 0, failed: 0 },
})

describe('durable connector capacity deferrals', () => {
  const ids = createKnowledgeAclFixtureIds()
  const watermark = new Date('2026-01-01T00:00:00Z')
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids)
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    vi.spyOn(connectorTokens, 'resolveConnectorAccessToken').mockResolvedValue({
      accessToken: 'fixture-token',
    })
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected outbound request')
    })
  })
  beforeEach(async () => {
    fixture.list.mockReset()
    await db
      .update(knowledgeConnector)
      .set({
        connectorType: 'github_fixture',
        accessMode: 'workspace',
        status: 'active',
        consecutiveFailures: 3,
        lastSyncAt: watermark,
        nextSyncAt: null,
        syncLockToken: null,
        syncLockLeaseAt: null,
        listingCheckpoint: null,
        memberSyncStatus: 'idle',
        memberSyncLockToken: null,
        memberSyncLockLeaseAt: null,
        archivedAt: null,
        deletedAt: null,
      })
      .where(eq(knowledgeConnector.id, ids.connectorId))
  })
  afterAll(async () => {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await db.$client.end()
  })

  it.each(['rate_limit', 'admission_timeout', 'admission_unavailable'] as const)(
    'the task durably defers %s and later resumes the same listing generation',
    async (reason) => {
      fixture.list.mockRejectedValue(new GitHubRequestDeferredError(60_000, undefined, reason))
      const before = Date.now()
      const first = await executeConnectorSyncJob({
        connectorId: ids.connectorId,
        requestId: generateId(),
        billingAttribution: billing,
      })
      expect(first).toMatchObject({
        outcome: 'deferred',
        deferred: { reason, providerId: 'github-rest' },
      })
      const [waiting] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
      expect(waiting.consecutiveFailures).toBe(3)
      expect(waiting.lastSyncAt).toEqual(watermark)
      expect(waiting.syncLockToken).toBeNull()
      expect(waiting.status).toBe('active')
      expect(waiting.nextSyncAt!.getTime()).toBeGreaterThanOrEqual(before + 60_000)
      const checkpoint = waiting.listingCheckpoint as { generationId: string }
      const [log] = await db
        .select()
        .from(knowledgeConnectorSyncLog)
        .where(eq(knowledgeConnectorSyncLog.id, checkpoint.generationId))
      expect(log.status).toBe('partial')
      expect(log.errorMessage).toContain(reason)
      fixture.list.mockResolvedValue({ documents: [], hasMore: false })
      const resumed = await executeConnectorSyncJob({
        connectorId: ids.connectorId,
        requestId: generateId(),
        billingAttribution: billing,
      })
      expect(resumed.outcome).toBe('completed')
      expect(fixture.list.mock.calls.at(-1)?.[3].syncRunId).toBe(checkpoint.generationId)
      const [complete] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
      expect(complete.listingCheckpoint).toBeNull()
      expect(complete.lastSyncAt!.getTime()).toBeGreaterThan(watermark.getTime())
      expect(complete.consecutiveFailures).toBe(0)
    }
  )

  it.each(['content', 'member'] as const)(
    'publishes %s deferrals atomically and rejects duplicate completion',
    async (kind) => {
      const runId = generateId()
      const lease =
        kind === 'content'
          ? createContentSyncLease(ids.connectorId, runId)
          : createMemberSyncLease(ids.connectorId, runId)
      await db
        .update(knowledgeConnector)
        .set(
          kind === 'content'
            ? { status: 'syncing', syncLockToken: runId }
            : { memberSyncStatus: 'running', memberSyncLockToken: runId }
        )
        .where(eq(knowledgeConnector.id, ids.connectorId))
      const log = kind === 'content' ? knowledgeConnectorSyncLog : knowledgeConnectorMemberSyncLog
      await db.insert(log).values({ id: runId, connectorId: ids.connectorId, status: 'started' })
      const input = {
        connectorId: ids.connectorId,
        knowledgeBaseId: ids.knowledgeBaseId,
        runId,
        lease,
        kind,
        result: emptyResult(),
        error: new GitHubRequestDeferredError(60_000),
      }
      const outcomes = await Promise.allSettled([
        deferConnectorSync(input),
        deferConnectorSync(input),
      ])
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const [closed] = await db.select().from(log).where(eq(log.id, runId))
      expect(closed.status).toBe('partial')
    }
  )

  it('rolls back the log when retry publication is rejected', async () => {
    const runId = generateId()
    await db
      .update(knowledgeConnector)
      .set({ status: 'syncing', syncLockToken: runId })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    await db
      .insert(knowledgeConnectorSyncLog)
      .values({ id: runId, connectorId: ids.connectorId, status: 'started' })
    const realLease = createContentSyncLease(ids.connectorId, runId)
    let calls = 0
    const lease = {
      ...realLease,
      stillHeld: () =>
        ++calls === 1
          ? realLease.stillHeld()
          : eq(knowledgeConnector.id, 'missing-fixture-connector'),
    }
    await expect(
      deferConnectorSync({
        connectorId: ids.connectorId,
        knowledgeBaseId: ids.knowledgeBaseId,
        runId,
        lease,
        kind: 'content',
        result: emptyResult(),
        error: new GitHubRequestDeferredError(60_000),
      })
    ).rejects.toThrow('retry no longer belongs')
    const [log] = await db
      .select()
      .from(knowledgeConnectorSyncLog)
      .where(eq(knowledgeConnectorSyncLog.id, runId))
    expect(log.status).toBe('started')
    const [connector] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    expect(connector.syncLockToken).toBe(runId)
    expect(connector.nextSyncAt).toBeNull()
  })
})
