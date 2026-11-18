import { db } from '@sim/db'
import {
  knowledgeConnectorPermissionImportGrant as grants,
  knowledgeConnectorPermissionImport as imports,
  knowledgeBase,
  knowledgeConnector,
  organization,
  outboxEvent,
  knowledgeConnectorPermissionSnapshot as snapshots,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  cleanupKnowledgeConnector,
  enqueueConnectorDeletion,
} from '@/lib/knowledge/connectors/deletion'
import {
  KNOWLEDGE_CONNECTOR_CLEANUP_EVENT,
  KNOWLEDGE_PERMISSION_IMPORT_CLEANUP_EVENT,
} from '@/lib/knowledge/connectors/outbox-events'
import {
  cleanupPermissionImport,
  enqueuePermissionImportCleanup,
} from '@/lib/knowledge/connectors/permission-import-cleanup'

const handlers = {
  [KNOWLEDGE_PERMISSION_IMPORT_CLEANUP_EVENT]: cleanupPermissionImport,
  [KNOWLEDGE_CONNECTOR_CLEANUP_EVENT]: cleanupKnowledgeConnector,
}

describe('permission import reclamation through the PostgreSQL outbox', () => {
  const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
  const eventIds: string[] = []

  afterAll(async () => {
    if (eventIds.length) await db.delete(outboxEvent).where(inArray(outboxEvent.id, eventIds))
    for (const ids of fixtures) {
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await db.$client.end()
  })

  async function seed() {
    const ids = createKnowledgeAclFixtureIds()
    fixtures.push(ids)
    await seedKnowledgeAclFixture(ids)
    return ids
  }

  async function importRows(
    connectorId: string,
    count: number,
    options: { active?: boolean; completed?: boolean; expiresAt?: Date } = {}
  ) {
    const id = generateId()
    await db.insert(imports).values({
      id,
      connectorId,
      credentialBinding: 'fixture',
      expectedRevision: 1,
      completedRevision: options.completed ? 2 : null,
      metadata: {},
      manifest: {},
      expiresAt: options.expiresAt ?? new Date(0),
    })
    await db.execute(sql`
      insert into ${grants} (import_id, project_path, user_id, group_key)
      select ${id}, 'fixture/project', series::text, 'project'
      from generate_series(1, ${count}) series`)
    if (options.active) {
      await db.insert(snapshots).values({
        connectorId,
        revision: 2,
        metadata: {},
        payload: { importId: id },
      })
    }
    return id
  }

  async function scheduledEvent(importId: string, connectorId: string) {
    await db.transaction((tx) => enqueuePermissionImportCleanup(tx, importId, connectorId))
    const [event] = await db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(sql`${outboxEvent.payload}::jsonb ->> 'importId' = ${importId}`)
      .limit(1)
    if (!event) throw new Error('Cleanup intent was not committed')
    eventIds.push(event.id)
    return event.id
  }

  async function countRows(importId: string) {
    const [result] = await db
      .select({ count: sql<number>`count(*)::integer` })
      .from(grants)
      .where(eq(grants.importId, importId))
    return result?.count ?? 0
  }

  async function runAgain(eventId: string) {
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvent.id, eventId))
    return processOutboxEventById(eventId, handlers)
  }

  async function finishCleanup(eventId: string, importId: string, remaining: number) {
    for (let continuation = 0; continuation < 200; continuation++) {
      const result = await runAgain(eventId)
      const next = await countRows(importId)
      if (remaining > 0) expect(next).toBeLessThan(remaining)
      else expect(next).toBe(0)
      const [event] = await db
        .select({ attempts: outboxEvent.attempts })
        .from(outboxEvent)
        .where(eq(outboxEvent.id, eventId))
      expect(event?.attempts).toBe(0)
      if (result === 'completed') {
        expect(next).toBe(0)
        return
      }
      expect(result).toBe('pending')
      remaining = next
    }
    throw new Error('Cleanup did not finish within the bounded continuation budget')
  }

  it('preserves active and unexpired uploads while reclaiming abandoned rows across continuations', async () => {
    const ids = await seed()
    const active = await importRows(ids.connectorId, 1, { active: true, completed: true })
    const pending = await importRows(ids.connectorId, 1, {
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    const expired = await importRows(ids.connectorId, 1_000_001)
    const activeEvent = await scheduledEvent(active, ids.connectorId)
    const pendingEvent = await scheduledEvent(pending, ids.connectorId)
    const expiredEvent = await scheduledEvent(expired, ids.connectorId)

    expect(await processOutboxEventById(activeEvent, handlers)).toBe('completed')
    expect(await processOutboxEventById(pendingEvent, handlers)).toBe('pending')
    expect(await processOutboxEventById(expiredEvent, handlers)).toBe('pending')
    expect(await countRows(active)).toBe(1)
    expect(await countRows(pending)).toBe(1)
    const remaining = await countRows(expired)
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThan(1_000_001)
    const [event] = await db
      .select({ attempts: outboxEvent.attempts })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, expiredEvent))
    expect(event?.attempts).toBe(0)
    await finishCleanup(expiredEvent, expired, remaining)
    expect(await countRows(expired)).toBe(0)
    expect(
      await db.select({ id: imports.id }).from(imports).where(eq(imports.id, expired))
    ).toEqual([])
    expect(await countRows(active)).toBe(1)
  })

  it('reclaims a superseded completed generation before its upload expiry', async () => {
    const ids = await seed()
    const retired = await importRows(ids.connectorId, 1, {
      completed: true,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    const event = await scheduledEvent(retired, ids.connectorId)
    expect(await processOutboxEventById(event, handlers)).toBe('completed')
    expect(await countRows(retired)).toBe(0)
    expect(
      await db.select({ id: imports.id }).from(imports).where(eq(imports.id, retired))
    ).toEqual([])
  })

  it('drains permission descendants before physically deleting a retired source', async () => {
    const ids = await seed()
    const imported = await importRows(ids.connectorId, 45_001, { active: true, completed: true })
    const deletedAt = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(knowledgeConnector)
        .set({ deletedAt })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      await enqueueConnectorDeletion(tx, {
        connectorId: ids.connectorId,
        knowledgeBaseId: ids.knowledgeBaseId,
        deletedAt: deletedAt.toISOString(),
      })
    })
    const [event] = await db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(sql`${outboxEvent.payload}::jsonb ->> 'connectorId' = ${ids.connectorId}`)
      .limit(1)
    if (!event) throw new Error('Connector cleanup intent was not committed')
    eventIds.push(event.id)
    expect(await processOutboxEventById(event.id, handlers)).toBe('pending')
    const remaining = await countRows(imported)
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThan(45_001)
    const [source] = await db
      .select({ deletedAt: knowledgeConnector.deletedAt })
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    expect(source?.deletedAt?.toISOString()).toBe(deletedAt.toISOString())
    await finishCleanup(event.id, imported, remaining)
    expect(
      await db
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
    ).toEqual([])
    expect(await countRows(imported)).toBe(0)
  })
})
