/** Real PostgreSQL coverage for bounded lifecycle writes and changing observations. */
import { db } from '@sim/db'
import {
  document,
  knowledgeConnector,
  knowledgeDocumentObservation,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  applyMemberDocumentLifecycle,
  recordMemberObservations,
  removeMemberObservationsForDocuments,
} from '@/lib/knowledge/connectors/member-observations'
import { MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN } from '@/lib/knowledge/connectors/sync-limits'
import {
  assertSyncLeaseHeldInTx,
  SyncLockLostException,
  stillHoldsMemberSyncLock,
} from '@/lib/knowledge/connectors/sync-lock'

describe('member document lifecycle in PostgreSQL', () => {
  let ids: ReturnType<typeof createKnowledgeAclFixtureIds>
  let members: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>>
  const seenAt = sql`'2026-01-01 00:00:00.000123'::timestamp`
  const deletedAt = new Date()

  beforeEach(async () => {
    ids = await seedKnowledgeAclFixture()
    members = await seedKnowledgeMemberFixture(ids)
  })

  afterEach(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  })

  afterAll(() => db.$client.end())

  const row = (externalId: string) => ({
    id: generateId(),
    knowledgeBaseId: ids.knowledgeBaseId,
    connectorId: members.connectorId,
    externalId,
    filename: externalId,
    fileUrl: '',
    fileSize: 0,
    mimeType: 'text/plain',
    processingStatus: 'completed',
    contentHash: 'verified-content',
    sourceSeenAt: seenAt,
  })

  const observe = (documentIds: string[]) =>
    recordMemberObservations(db, members.members[0].id, documentIds, members.runId)

  const run = (
    options: {
      beforeWrite?: () => Promise<void>
      allowRemoval?: boolean
      unobservedDocumentIds?: string[]
    } = {}
  ) =>
    applyMemberDocumentLifecycle({
      connectorId: members.connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      runId: members.runId,
      allowRemoval: options.allowRemoval ?? true,
      unobservedDocumentIds: options.unobservedDocumentIds ?? [],
      deadlineAt: Date.now() + 60_000,
      lease: { beatIfDue: async () => {} },
      withLease: async (fn) => {
        await options.beforeWrite?.()
        return db.transaction(async (tx) => {
          await assertSyncLeaseHeldInTx(tx, members.connectorId, {
            stillHeld: () => stillHoldsMemberSyncLock(members.connectorId, members.runId),
          })
          return fn(tx)
        })
      },
    })

  it('walks multiple batches across null and microsecond timestamps and preserves exclusions', async () => {
    const stale = Array.from({ length: 1100 }, (_, index) => ({
      ...row(String(index)),
      sourceSeenAt: index < 550 ? null : seenAt,
    }))
    const observed = row('observed')
    const excluded = { ...row('excluded'), userExcluded: true }
    const archived = { ...row('archived'), archivedAt: new Date() }
    const restore = { ...row('restore'), deletedAt }
    const noContent = { ...row('no-content'), deletedAt, contentHash: null }
    const rows = [...stale, observed, excluded, archived, restore, noContent]
    for (let offset = 0; offset < rows.length; offset += 500)
      await db.insert(document).values(rows.slice(offset, offset + 500))
    await observe([observed.id, restore.id, noContent.id])

    expect(await run()).toEqual({ tombstoned: 1100, resurrected: 1, purged: 0, finished: true })
    const stored = await db
      .select({ id: document.id, deletedAt: document.deletedAt })
      .from(document)
      .where(eq(document.connectorId, members.connectorId))
    const byId = new Map(stored.map((entry) => [entry.id, entry.deletedAt]))
    expect(stale.every((entry) => byId.get(entry.id) instanceof Date)).toBe(true)
    for (const entry of [observed, excluded, archived, restore])
      expect(byId.get(entry.id)).toBeNull()
    expect(byId.get(noContent.id)).toEqual(deletedAt)
  })

  const insertRows = async (rows: ReturnType<typeof row>[]) => {
    for (let offset = 0; offset < rows.length; offset += 500)
      await db.insert(document).values(rows.slice(offset, offset + 500))
  }
  const tombstonedIds = async () =>
    new Set(
      (
        await db
          .select({ id: document.id })
          .from(document)
          .where(and(eq(document.connectorId, members.connectorId), isNotNull(document.deletedAt)))
      ).map(({ id }) => id)
    )
  const savedCursor = async () =>
    (
      await db
        .select({ cursor: knowledgeConnector.memberTombstoneCursor })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, members.connectorId))
    )[0].cursor

  it('tombstones what this run unobserved right away and leaves the rest of a large connector to later runs', async () => {
    const pageBudget = MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN * 500
    const unobserved = Array.from({ length: pageBudget + 20 }, (_, index) =>
      row(`unobserved-${index}`)
    )
    const lastSeen = sql`'2026-06-01 00:00:00'::timestamp`
    const [lostByThisRun, stillObservedByBob] = [
      { ...row('lost-by-this-run'), sourceSeenAt: lastSeen },
      { ...row('still-observed-by-bob'), sourceSeenAt: lastSeen },
    ]
    await insertRows([...unobserved, lostByThisRun, stillObservedByBob])
    await observe([lostByThisRun.id, stillObservedByBob.id])
    await recordMemberObservations(
      db,
      members.members[1].id,
      [stillObservedByBob.id],
      members.runId
    )
    const removed = await removeMemberObservationsForDocuments(db, members.members[0].id, [
      lostByThisRun.id,
      stillObservedByBob.id,
    ])
    expect(removed.sort()).toEqual([lostByThisRun.id, stillObservedByBob.id].sort())

    expect(await run({ unobservedDocumentIds: removed })).toEqual({
      tombstoned: pageBudget + 1,
      resurrected: 0,
      purged: 0,
      finished: true,
    })
    const afterFirst = await tombstonedIds()
    expect(afterFirst.has(lostByThisRun.id)).toBe(true)
    expect(afterFirst.has(stillObservedByBob.id)).toBe(false)
    expect(unobserved.filter(({ id }) => !afterFirst.has(id))).toHaveLength(20)
    expect(await savedCursor()).toEqual({ seenAt: expect.any(String), id: expect.any(String) })

    expect(await run()).toEqual({ tombstoned: 20, resurrected: 0, purged: 0, finished: true })
    const afterSecond = await tombstonedIds()
    expect(unobserved.every(({ id }) => afterSecond.has(id))).toBe(true)
    expect(afterSecond.has(stillObservedByBob.id)).toBe(false)
    expect(await savedCursor()).toBeNull()
  })

  it('continues past a full selected batch even if its observations change before UPDATE', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => row(String(index)))
    await db.insert(document).values(rows)
    const selected = await db
      .select({ id: document.id })
      .from(document)
      .where(eq(document.connectorId, members.connectorId))
      .orderBy(document.id)
      .limit(500)
    let writes = 0
    const result = await run({
      beforeWrite: async () => {
        if (writes++ === 0) await observe(selected.map(({ id }) => id))
      },
    })
    expect(result).toEqual({ tombstoned: 1, resurrected: 0, purged: 0, finished: true })
    const stored = await db
      .select({ id: document.id, deletedAt: document.deletedAt })
      .from(document)
      .where(eq(document.connectorId, members.connectorId))
    expect(stored.filter((entry) => entry.deletedAt !== null)).toHaveLength(1)
    const observedIds = new Set(selected.map(({ id }) => id))
    expect(stored.every((entry) => !observedIds.has(entry.id) || entry.deletedAt === null)).toBe(
      true
    )
  })

  it('does not resurrect a document whose last observation disappeared before UPDATE', async () => {
    const target = { ...row('lost-observation'), deletedAt }
    await db.insert(document).values(target)
    await observe([target.id])
    expect(
      await run({
        beforeWrite: async () => {
          await db
            .delete(knowledgeDocumentObservation)
            .where(eq(knowledgeDocumentObservation.documentId, target.id))
        },
      })
    ).toEqual({ tombstoned: 0, resurrected: 0, purged: 0, finished: true })
    const [stored] = await db.select().from(document).where(eq(document.id, target.id))
    expect(stored.deletedAt).toEqual(deletedAt)
  })

  it('leaves unobserved documents alone until a member completed a listing', async () => {
    const target = row('not-yet-observed')
    await db.insert(document).values(target)
    expect(await run({ allowRemoval: false })).toEqual({
      tombstoned: 0,
      resurrected: 0,
      purged: 0,
      finished: true,
    })
    const [stored] = await db.select().from(document).where(eq(document.id, target.id))
    expect(stored.deletedAt).toBeNull()
  })

  it('refuses the write when another run claimed the connector after selection', async () => {
    const target = row('lost-lease')
    await db.insert(document).values(target)
    await expect(
      run({
        beforeWrite: async () => {
          await db
            .update(knowledgeConnector)
            .set({ memberSyncLockToken: generateId() })
            .where(eq(knowledgeConnector.id, members.connectorId))
        },
      })
    ).rejects.toBeInstanceOf(SyncLockLostException)
    const [stored] = await db.select().from(document).where(eq(document.id, target.id))
    expect(stored.deletedAt).toBeNull()
  })
})
