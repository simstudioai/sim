import { createServer } from 'node:http'
import { db } from '@sim/db'
import { outboxEvent, permissions, project, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'

const userId = generateId()
const workspaceId = generateId()
const projectId = generateId()
const received: { body: unknown; key: string | string[] | undefined }[] = []
let status = 503
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  received.push({ body: JSON.parse(body), key: req.headers['x-api-key'] })
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ success: status === 200 }))
})
let runtime: {
  deletion: typeof import('@/lib/users/account-deletion')
  cleanup: typeof import('@/lib/mothership/memories/cleanup-outbox')
  outbox: typeof import('@/lib/core/outbox/service')
  event: typeof import('@/lib/mothership/memories/cleanup-event')
}
let eventIds: string[] = []

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${address.port}`
  process.env.COPILOT_API_KEY = 'memory-cleanup-fixture-key'
  const [deletion, cleanup, outbox, event] = await Promise.all([
    import('@/lib/users/account-deletion'),
    import('@/lib/mothership/memories/cleanup-outbox'),
    import('@/lib/core/outbox/service'),
    import('@/lib/mothership/memories/cleanup-event'),
  ])
  runtime = { deletion, cleanup, outbox, event }
  await db.insert(user).values({
    id: userId,
    name: 'Cleanup fixture',
    email: `${userId}@memory.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    projectId,
    name: 'Cleanup fixture',
    ownerId: userId,
    billedAccountUserId: userId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
}, 60_000)

afterAll(async () => {
  if (eventIds.length) await db.delete(outboxEvent).where(inArray(outboxEvent.id, eventIds))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(project).where(eq(project.id, projectId))
  await db.delete(user).where(eq(user.id, userId))
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
})

it('rolls cleanup back with deletion and retries committed account/target erasure after the account is gone', async () => {
  await expect(
    db.transaction(async (tx) => {
      await runtime.cleanup.enqueueMemoryCleanup(tx, [{ kind: 'private_owner', userId }])
      throw new Error('rollback fixture')
    })
  ).rejects.toThrow('rollback fixture')
  const pending = () =>
    db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, runtime.event.MEMORY_CLEANUP_EVENT),
          sql`(${outboxEvent.payload}->'request'->'target'->>'userId' = ${userId}
          OR ${outboxEvent.payload}->'request'->'target'->>'workspaceId' = ${workspaceId}
          OR ${outboxEvent.payload}->'request'->'target'->>'projectId' = ${projectId})`
        )
      )
  expect(await pending()).toEqual([])

  await runtime.deletion.deleteUserAccount(userId, { recordIdentity: false })
  expect(await db.select({ id: user.id }).from(user).where(eq(user.id, userId))).toEqual([])
  expect(
    await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, workspaceId))
  ).toEqual([])
  expect(
    await db.select({ id: project.id }).from(project).where(eq(project.id, projectId))
  ).toEqual([])
  const events = await pending()
  eventIds = events.map((event) => event.id)
  expect(events).toHaveLength(3)
  expect(JSON.stringify(events)).not.toContain('memory-cleanup-fixture-key')
  expect(received).toHaveLength(0)
  for (const event of events) {
    await runtime.outbox.processOutboxEventById(
      event.id,
      runtime.cleanup.memoryCleanupOutboxHandlers
    )
  }
  expect(
    (await pending()).every((event) => event.status === 'pending' && event.attempts === 1)
  ).toBe(true)
  status = 200
  await db
    .update(outboxEvent)
    .set({ availableAt: new Date(0) })
    .where(inArray(outboxEvent.id, eventIds))
  for (const event of events) {
    await runtime.outbox.processOutboxEventById(
      event.id,
      runtime.cleanup.memoryCleanupOutboxHandlers
    )
  }
  expect((await pending()).every((event) => event.status === 'completed')).toBe(true)
  expect(received.slice(3).map((request) => request.body)).toEqual(
    expect.arrayContaining([
      { version: 1, target: { kind: 'private_owner', userId } },
      { version: 1, target: { kind: 'workspace', workspaceId } },
      { version: 1, target: { kind: 'project', projectId } },
    ])
  )
  expect(received.every((request) => request.key === 'memory-cleanup-fixture-key')).toBe(true)

  const first = events[0]
  const replay = async (payload: unknown = first.payload, attempts = 9) => {
    await db
      .update(outboxEvent)
      .set({ status: 'pending', availableAt: new Date(0), attempts, payload })
      .where(eq(outboxEvent.id, first.id))
    await runtime.outbox.processOutboxEventById(
      first.id,
      runtime.cleanup.memoryCleanupOutboxHandlers
    )
    const [row] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, first.id))
    return row
  }
  const waitsAnHour = (row: typeof outboxEvent.$inferSelect) => {
    expect(row).toMatchObject({ status: 'pending', attempts: 9 })
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000)
  }

  status = 404
  const before = received.length
  waitsAnHour(await replay())
  expect(received).toHaveLength(before + 1)

  status = 401
  const rejected = await replay(first.payload, 5)
  expect(rejected).toMatchObject({ status: 'pending', attempts: 6 })
  expect(rejected.availableAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000)
  expect(await replay()).toMatchObject({ status: 'dead_letter', attempts: 10 })
  expect(received).toHaveLength(before + 3)

  status = 200
  waitsAnHour(await replay({ ...toRecord(first.payload), baseUrl: 'https://unconfigured.test' }))
  expect(received).toHaveLength(before + 3)

  const legacy = await replay({ ...toRecord(first.payload), credentialFingerprint: 'retired' })
  expect(legacy.status).toBe('completed')
  expect(received).toHaveLength(before + 4)
}, 30_000)
