/** Real PostgreSQL coverage for bounded lifecycle writes and changing observations. */
import { db } from '@sim/db'
import {
  document,
  knowledgeConnector,
  knowledgeConnectorMember,
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
import { resumeMembershipRewrites } from '@/lib/knowledge/connectors/member-sync-engine'
import { MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN } from '@/lib/knowledge/connectors/sync-limits'
import {
  assertSyncLeaseHeldInTx,
  createMemberSyncLease,
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
    /** Both sort after every unobserved document, beyond what this run's reconcile reaches. */
    const [lostByThisRun, stillObservedByBob] = [
      row('zz-lost-by-this-run'),
      row('zz-still-observed-by-bob'),
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
    expect(await savedCursor()).toEqual({ externalId: expect.any(String) })

    expect(await run()).toEqual({ tombstoned: 20, resurrected: 0, purged: 0, finished: true })
    const afterSecond = await tombstonedIds()
    expect(unobserved.every(({ id }) => afterSecond.has(id))).toBe(true)
    expect(afterSecond.has(stillObservedByBob.id)).toBe(false)
    expect(await savedCursor()).toBeNull()
  })

  it('tombstones what removing the only listed member unobserved, though the run stops right after the removal', async () => {
    const [removedMember, otherMember] = members.members
    await db
      .update(knowledgeConnectorMember)
      .set({
        lastCompleteListingAt: new Date(),
        listingCheckpoint: { kind: 'membership', cursor: null, removeMember: true },
      })
      .where(eq(knowledgeConnectorMember.id, removedMember.id))
    const onlyRemoved = Array.from({ length: 1_200 }, (_, index) => row(`only-removed-${index}`))
    const sharedWithOther = row('shared-with-other-member')
    const neverObserved = row('never-observed')
    await insertRows([...onlyRemoved, sharedWithOther, neverObserved])
    await observe([...onlyRemoved.map(({ id }) => id), sharedWithOther.id])
    await recordMemberObservations(db, otherMember.id, [sharedWithOther.id], members.runId)
    const removal = (stopAfterFirstPage: boolean) => {
      const lease = createMemberSyncLease(members.connectorId, members.runId)
      const input: Parameters<typeof resumeMembershipRewrites>[0] = {
        connectorId: members.connectorId,
        runId: members.runId,
        deadlineAt: Date.now() + 60_000,
        tombstonesUnobserved: true,
        lease: {
          ...lease,
          beatIfDue: async () => {
            await lease.beatIfDue()
            if (stopAfterFirstPage) input.deadlineAt = Date.now() - 1
          },
        },
      }
      return resumeMembershipRewrites(input)
    }

    /** The first run walks one page before its deadline; the second finishes and deletes the member. */
    expect(await removal(true)).toBe(false)
    const [paused] = await db
      .select({ checkpoint: knowledgeConnectorMember.listingCheckpoint })
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, removedMember.id))
    expect(paused.checkpoint).toMatchObject({ removeMember: true, cursor: expect.any(String) })
    expect(await removal(false)).toBe(true)
    const [completed] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeConnectorMember)
      .where(
        and(
          eq(knowledgeConnectorMember.connectorId, members.connectorId),
          isNotNull(knowledgeConnectorMember.lastCompleteListingAt)
        )
      )
    expect(completed.count).toBe(0)
    /** No lifecycle ran in either run: the tombstones landed with the removal itself. */
    const afterRemoval = await tombstonedIds()
    expect(onlyRemoved.every(({ id }) => afterRemoval.has(id))).toBe(true)
    expect(afterRemoval.has(sharedWithOther.id)).toBe(false)
    expect(afterRemoval.has(neverObserved.id)).toBe(false)

    expect(await run({ allowRemoval: false })).toEqual({
      tombstoned: 0,
      resurrected: 0,
      purged: 0,
      finished: true,
    })
    expect(await tombstonedIds()).toEqual(afterRemoval)
  })

  it('brings back what a withdrawn removal tombstoned within the same run, and nothing else', async () => {
    const [member] = members.members
    await db
      .update(knowledgeConnectorMember)
      .set({ listingCheckpoint: { kind: 'membership', cursor: null, removeMember: true } })
      .where(eq(knowledgeConnectorMember.id, member.id))
    const walked = Array.from({ length: 600 }, (_, index) => row(`walked-${index}`))
    const excluded = { ...row('excluded'), userExcluded: true, deletedAt }
    const archived = { ...row('archived'), archivedAt: new Date(), deletedAt }
    const noContent = { ...row('no-content'), contentHash: null, deletedAt }
    await insertRows([...walked, excluded, archived, noContent])
    await observe([...walked, excluded, archived, noContent].map(({ id }) => id))
    const walk = (stopAfterFirstPage: boolean) => {
      const lease = createMemberSyncLease(members.connectorId, members.runId)
      const input: Parameters<typeof resumeMembershipRewrites>[0] = {
        connectorId: members.connectorId,
        runId: members.runId,
        deadlineAt: Date.now() + 60_000,
        tombstonesUnobserved: true,
        lease: {
          ...lease,
          beatIfDue: async () => {
            await lease.beatIfDue()
            if (stopAfterFirstPage) input.deadlineAt = Date.now() - 1
          },
        },
      }
      return resumeMembershipRewrites(input)
    }

    expect(await walk(true)).toBe(false)
    const tombstonedByRemoval = await tombstonedIds()
    const walkedIds = new Set(walked.map(({ id }) => id))
    const removedPage = [...tombstonedByRemoval].filter((id) => walkedIds.has(id))
    expect(removedPage.length).toBeGreaterThan(0)
    expect(removedPage.length).toBeLessThan(walked.length)

    /** Directory re-listing withdraws the removal: the member is active again and its walk restarts. */
    await db
      .update(knowledgeConnectorMember)
      .set({
        status: 'active',
        listingCheckpoint: { kind: 'membership', cursor: null, removeMember: false },
      })
      .where(eq(knowledgeConnectorMember.id, member.id))
    expect(await walk(false)).toBe(true)

    const after = await tombstonedIds()
    expect(walked.every(({ id }) => !after.has(id))).toBe(true)
    for (const kept of [excluded, archived, noContent]) expect(after.has(kept.id)).toBe(true)
  })

  it('leaves a service-owned corpus alone when a member is removed', async () => {
    const [removedMember] = members.members
    await db
      .update(knowledgeConnectorMember)
      .set({ listingCheckpoint: { kind: 'membership', cursor: null, removeMember: true } })
      .where(eq(knowledgeConnectorMember.id, removedMember.id))
    const onlyRemoved = row('service-owned')
    await insertRows([onlyRemoved])
    await observe([onlyRemoved.id])
    expect(
      await resumeMembershipRewrites({
        connectorId: members.connectorId,
        runId: members.runId,
        deadlineAt: Date.now() + 60_000,
        lease: createMemberSyncLease(members.connectorId, members.runId),
        tombstonesUnobserved: false,
      })
    ).toBe(true)
    expect((await tombstonedIds()).size).toBe(0)
  })

  it('finishes a pass within its page budget while listings re-stamp every observed document', async () => {
    const pageBudget = MEMBER_TOMBSTONE_RECONCILE_PAGES_PER_RUN * 500
    const total = pageBudget + 500
    const runsPerPass = Math.ceil(total / pageBudget)
    const firstInEveryOrder = {
      ...row('walk-0000000'),
      id: '00000000-0000-4000-8000-000000000000',
    }
    const rest = Array.from({ length: total - 1 }, (_, index) =>
      row(`walk-${String(index + 1).padStart(7, '0')}`)
    )
    await insertRows([firstInEveryOrder, ...rest])
    const all = [firstInEveryOrder, ...rest].map(({ id }) => id)
    for (let offset = 0; offset < all.length; offset += 5000)
      await observe(all.slice(offset, offset + 5000))
    /** A listing stamps what it saw with its start; the document nobody observes keeps its old stamp. */
    const relist = () =>
      db
        .update(document)
        .set({ sourceSeenAt: new Date() })
        .where(
          and(
            eq(document.connectorId, members.connectorId),
            sql`EXISTS (SELECT 1 FROM knowledge_document_observation o WHERE o.document_id = ${document.id})`
          )
        )

    expect(await run()).toMatchObject({ tombstoned: 0 })
    expect(await savedCursor()).not.toBeNull()
    await db
      .delete(knowledgeDocumentObservation)
      .where(eq(knowledgeDocumentObservation.documentId, firstInEveryOrder.id))
    for (let pass = 1; pass < runsPerPass; pass++) {
      await relist()
      await run()
    }
    expect(await savedCursor()).toBeNull()
    expect((await tombstonedIds()).has(firstInEveryOrder.id)).toBe(false)

    for (let next = 0; next < runsPerPass; next++) {
      await relist()
      await run()
    }
    expect(await tombstonedIds()).toEqual(new Set([firstInEveryOrder.id]))
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
