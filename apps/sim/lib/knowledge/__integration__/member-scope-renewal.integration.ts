/** Real PostgreSQL coverage for renewing member observations by access scope. */
import { db } from '@sim/db'
import {
  document,
  knowledgeDocumentObservation,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  recordMemberObservations,
  renewMemberObservationsInScopes,
} from '@/lib/knowledge/connectors/member-observations'

describe('member observation renewal by access scope in PostgreSQL', () => {
  let ids: ReturnType<typeof createKnowledgeAclFixtureIds>
  let members: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>>
  const scope = (channel: string) => `slack:v4:T0TEAM:${channel}:`

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

  const row = (externalId: string, overrides: Partial<typeof document.$inferInsert> = {}) => ({
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
    ...overrides,
  })

  it('renews only still-granted scopes across pages, keeping each observation generation', async () => {
    const memberId = members.members[0].id
    const renewBefore = new Date(Date.now() - 12 * 60 * 60 * 1000)
    const renew = (channels: string[]) =>
      renewMemberObservationsInScopes({
        connectorId: members.connectorId,
        memberId,
        scopePrefixes: channels.map(scope),
        renewBefore,
        deadlineAt: Date.now() + 60_000,
        beforeBatch: async () => {},
        withLease: (fn) => db.transaction(fn),
      })
    const threads = (channel: string, count: number) =>
      Array.from({ length: count }, (_, index) =>
        row(`${scope(channel)}${1700000000 + index}.000100`)
      )
    const granted = [...threads('C0GENERAL', 1200), ...threads('G0PRIVATE', 900)]
    const revoked = threads('C0LEFT', 300)
    const tombstoned = row(`${scope('C0GENERAL')}1800000000.000100`, { deletedAt: new Date() })
    const rows = [...granted, ...revoked, tombstoned]
    for (let offset = 0; offset < rows.length; offset += 500)
      await db.insert(document).values(rows.slice(offset, offset + 500))
    await recordMemberObservations(
      db,
      memberId,
      rows.map((entry) => entry.id),
      members.runId
    )
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await db
      .update(knowledgeDocumentObservation)
      .set({ lastSeenAt: twoDaysAgo })
      .where(eq(knowledgeDocumentObservation.memberId, memberId))

    expect(await renew(['C0GENERAL', 'G0PRIVATE', 'C0UNSEEN'])).toEqual({
      renewed: granted.length,
      finished: true,
    })

    const observations = await db
      .select({
        documentId: knowledgeDocumentObservation.documentId,
        lastSeenAt: knowledgeDocumentObservation.lastSeenAt,
        runId: knowledgeDocumentObservation.runId,
      })
      .from(knowledgeDocumentObservation)
      .where(eq(knowledgeDocumentObservation.memberId, memberId))
    const byId = new Map(observations.map((entry) => [entry.documentId, entry]))
    expect(granted.every((entry) => (byId.get(entry.id)?.lastSeenAt ?? 0) > renewBefore)).toBe(true)
    for (const entry of [...revoked, tombstoned])
      expect(byId.get(entry.id)?.lastSeenAt).toEqual(twoDaysAgo)
    expect(observations.every((entry) => entry.runId === members.runId)).toBe(true)

    expect(await renew(['C0GENERAL', 'G0PRIVATE'])).toEqual({ renewed: 0, finished: true })
    const [{ stale }] = await db
      .select({ stale: sql<number>`count(*)::int` })
      .from(knowledgeDocumentObservation)
      .where(
        and(
          eq(knowledgeDocumentObservation.memberId, memberId),
          lt(knowledgeDocumentObservation.lastSeenAt, renewBefore)
        )
      )
    expect(stale).toBe(revoked.length + 1)
  })
})
