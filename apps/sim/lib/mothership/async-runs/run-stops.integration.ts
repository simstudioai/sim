import { db } from '@sim/db'
import {
  copilotChats,
  copilotOrganizationRequestStops,
  copilotRequestStops,
  copilotRunStops,
  copilotRuns,
  organization,
  user,
  workflow,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createRunSegment,
  insertRunSegment,
  isRunStopRequested,
  requestRunStop,
  stopLiveRunsTx,
  withRunAdmissionLock,
} from '@/lib/mothership/async-runs/repository'

/** Persisted cancellation survives a change of chat owner and also works before admission. */
describe('Actor and stream Stop intent', () => {
  const userId = generateId()
  const workspaceIds: string[] = []
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Run Stop fixture',
      email: `${userId}@run-stops.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
  })
  afterAll(async () => {
    for (const id of workspaceIds) await deleteWorkspaceFixture(db, eq(workspace.id, id))
    await db.delete(user).where(eq(user.id, userId))
  })

  async function personalRun(streamId = generateId()) {
    const chatId = generateId()
    await db.insert(copilotChats).values({ id: chatId, userId, type: 'mothership' })
    return createRunSegment({
      executionId: generateId(),
      chatId,
      userId,
      streamId,
      workspaceId: null,
      organizationId: null,
    })
  }

  it('retains a personal Stop before admission and closes the eventual run', async () => {
    const streamId = generateId()
    await requestRunStop({ userId, streamId })
    const run = await personalRun(streamId)
    expect(run.status).toBe('cancelled')
    expect(run.toolAdmissionClosedAt).not.toBeNull()
    expect(await isRunStopRequested({ userId, streamId })).toBe(true)
  })

  it('removal records personal Stop atomically and cannot stop another chat by stream', async () => {
    const run = await personalRun()
    await requestRunStop({ userId, streamId: run.streamId, chatId: generateId() })
    expect(await isRunStopRequested({ userId, streamId: run.streamId })).toBe(false)
    await expect(
      db.transaction(async (tx) => {
        await stopLiveRunsTx(tx, { chatIds: [run.chatId] })
        throw new Error('Rollback removal')
      })
    ).rejects.toThrow('Rollback removal')
    expect(await isRunStopRequested({ userId, streamId: run.streamId })).toBe(false)
    await db.transaction((tx) => stopLiveRunsTx(tx, { chatIds: [run.chatId] }))
    expect(await isRunStopRequested({ userId, streamId: run.streamId })).toBe(true)
    const [persisted] = await db
      .select({ closedAt: copilotRuns.toolAdmissionClosedAt })
      .from(copilotRuns)
      .where(eq(copilotRuns.id, run.id))
    expect(persisted.closedAt).not.toBeNull()
  })
  it('reads legacy-only intent, atomically dual-writes, and isolates original scope', async () => {
    const workspaceId = generateId()
    workspaceIds.push(workspaceId)
    const organizationId = generateId()
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Stop source',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Stop org', slug: organizationId })
    try {
      const chatId = generateId()
      const streamId = generateId()
      await db.insert(copilotChats).values({ id: chatId, userId, type: 'mothership', workspaceId })
      await db.insert(copilotRequestStops).values({ userId, streamId, workspaceId })
      expect(await isRunStopRequested({ userId, streamId, organizationId })).toBe(false)
      const stopped = await createRunSegment({
        chatId,
        userId,
        streamId,
        workspaceId,
        executionId: generateId(),
      })
      expect(stopped.status).toBe('cancelled')
      const orgStream = generateId()
      await db
        .insert(copilotOrganizationRequestStops)
        .values({ userId, streamId: orgStream, organizationId })
      expect(await isRunStopRequested({ userId, streamId: orgStream, organizationId })).toBe(true)
      expect(await isRunStopRequested({ userId, streamId: orgStream, workspaceId })).toBe(false)
      const next = generateId()
      await requestRunStop({ userId, streamId: next, workspaceId })
      expect(
        await db
          .select({ stream: copilotRunStops.streamId })
          .from(copilotRunStops)
          .where(and(eq(copilotRunStops.userId, userId), eq(copilotRunStops.streamId, next)))
      ).toHaveLength(1)
      expect(
        await db
          .select({ stream: copilotRequestStops.streamId })
          .from(copilotRequestStops)
          .where(
            and(eq(copilotRequestStops.userId, userId), eq(copilotRequestStops.streamId, next))
          )
      ).toHaveLength(1)
      await expect(
        requestRunStop({ userId, streamId: generateId(), workspaceId, organizationId })
      ).rejects.toThrow('exactly one')
    } finally {
      await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
      await db.delete(organization).where(eq(organization.id, organizationId))
    }
  })

  it('retains provenance after source deletion, permits stale source admission, and preserves chat cascade', async () => {
    const workspaceId = generateId()
    workspaceIds.push(workspaceId)
    const workflowId = generateId()
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Run source',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    const now = new Date()
    await db.insert(workflow).values({
      id: workflowId,
      workspaceId,
      userId,
      name: 'Run source',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    const run = await personalRun()
    await db.update(copilotRuns).set({ workspaceId, workflowId }).where(eq(copilotRuns.id, run.id))
    await db.delete(workflow).where(eq(workflow.id, workflowId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    const [retained] = await db
      .select({ workspaceId: copilotRuns.workspaceId, workflowId: copilotRuns.workflowId })
      .from(copilotRuns)
      .where(eq(copilotRuns.id, run.id))
    expect(retained).toEqual({ workspaceId, workflowId })
    await requestRunStop({ userId, chatId: run.chatId, streamId: run.streamId, workspaceId })
    expect(await isRunStopRequested({ userId, streamId: run.streamId, workspaceId })).toBe(true)
    const stale = await createRunSegment({
      userId,
      chatId: run.chatId,
      streamId: generateId(),
      executionId: generateId(),
      workspaceId,
      workflowId,
    })
    expect(stale.workspaceId).toBe(workspaceId)
    await db.delete(copilotChats).where(eq(copilotChats.id, run.chatId))
    expect(
      await db.select({ id: copilotRuns.id }).from(copilotRuns).where(eq(copilotRuns.id, stale.id))
    ).toHaveLength(0)
  })

  it('serializes a racing Stop with admission without losing intent', async () => {
    const chatId = generateId()
    const streamId = generateId()
    await db.insert(copilotChats).values({ id: chatId, userId, type: 'mothership' })
    await Promise.all([
      requestRunStop({ userId, streamId, chatId }),
      withRunAdmissionLock(userId, streamId, (tx) =>
        insertRunSegment(tx, {
          userId,
          streamId,
          chatId,
          executionId: generateId(),
          workspaceId: null,
          organizationId: null,
        })
      ),
    ])
    const [run] = await db
      .select({ closedAt: copilotRuns.toolAdmissionClosedAt })
      .from(copilotRuns)
      .where(and(eq(copilotRuns.userId, userId), eq(copilotRuns.streamId, streamId)))
    expect(run.closedAt).not.toBeNull()
    expect(await isRunStopRequested({ userId, streamId })).toBe(true)
  })
})
