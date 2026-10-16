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
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDeferred } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createRunSegment,
  isRunStopRequested,
  requestRunStop,
  stopLiveRunsTx,
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

  it('orders Stop after admission has read intent but before its run insert commits', async () => {
    const chatId = generateId()
    const streamId = generateId()
    const gate = `stop-race-${streamId}`
    const trigger = `stop_race_${streamId.replaceAll('-', '')}`
    const monitor = postgres(readTestDatabaseUrl(), { max: 2, prepare: false })
    await db.insert(copilotChats).values({ id: chatId, userId, type: 'mothership' })
    // A disposable DB trigger pauses the actual INSERT after its earlier Stop lookup.
    // No production hook or mocked repository supplies the ordering.
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stream_id = '${streamId}' THEN PERFORM pg_advisory_xact_lock(hashtextextended('${gate}', 0)); END IF; RETURN NEW; END $$`
      )
    )
    await db.execute(
      sql.raw(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON copilot_runs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`
      )
    )
    const released = createDeferred<void>()
    const held = createDeferred<void>()
    const holder = monitor.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${gate}, 0))`
      held.resolve()
      await released.promise
    })
    let admission: Promise<unknown> | undefined
    let stop: Promise<unknown> | undefined
    try {
      await held.promise
      admission = createRunSegment({
        userId,
        streamId,
        chatId,
        executionId: generateId(),
        workspaceId: null,
        organizationId: null,
      })
      let inserting = false
      for (let attempt = 0; attempt < 50 && !inserting; attempt++) {
        const rows =
          await monitor`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query ILIKE 'insert into "copilot_runs"%'`
        inserting = rows.length > 0
        if (!inserting) await sleep(20)
      }
      expect(inserting, 'actual run INSERT reached the held gate').toBe(true)
      let stopFinished = false
      stop = requestRunStop({ userId, streamId, chatId }).then((result) => {
        stopFinished = true
        return result
      })
      let waiting = false
      for (let attempt = 0; attempt < 50 && !waiting && !stopFinished; attempt++) {
        const rows =
          await monitor`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE ${"%lock='copilot_run_admission'%"}`
        waiting = rows.length > 0
        if (!waiting && !stopFinished) await sleep(20)
      }
      // With serialization removed, Stop commits against no run while INSERT is gated.
      // Release either way, then assert durable behavior rather than just a lock implementation.
      released.resolve()
      await holder
      await Promise.all([admission, stop])
      const [run] = await db
        .select({ closedAt: copilotRuns.toolAdmissionClosedAt })
        .from(copilotRuns)
        .where(and(eq(copilotRuns.userId, userId), eq(copilotRuns.streamId, streamId)))
      expect(run.closedAt, 'racing Stop must close the newly inserted run').not.toBeNull()
      expect(await isRunStopRequested({ userId, streamId })).toBe(true)
    } finally {
      released.resolve()
      await holder
      await Promise.allSettled([admission, stop].filter(Boolean))
      await db.execute(sql.raw(`DROP TRIGGER ${trigger} ON copilot_runs`))
      await db.execute(sql.raw(`DROP FUNCTION ${trigger}()`))
      await monitor.end()
    }
  })

  it.each(['workspace', 'organization'] as const)(
    'rolls back unified intent and admission closure when the %s legacy write fails',
    async (kind) => {
      const sourceId = generateId()
      const streamId = generateId()
      const chatId = generateId()
      const trigger = `stop_failure_${streamId.replaceAll('-', '')}`
      const table =
        kind === 'workspace' ? 'copilot_request_stops' : 'copilot_organization_request_stops'
      const owner = kind === 'workspace' ? { workspaceId: sourceId } : { organizationId: sourceId }
      if (kind === 'workspace') {
        workspaceIds.push(sourceId)
        await insertWorkspaceFixture(db, {
          id: sourceId,
          name: 'Stop rollback',
          ownerId: userId,
          billedAccountUserId: userId,
        })
      } else
        await db
          .insert(organization)
          .values({ id: sourceId, name: 'Stop rollback', slug: sourceId })
      await db.insert(copilotChats).values({ id: chatId, userId, type: 'mothership', ...owner })
      const run = await createRunSegment({
        userId,
        chatId,
        streamId,
        executionId: generateId(),
        ...owner,
      })
      await db.execute(
        sql.raw(
          `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stream_id = '${streamId}' THEN RAISE EXCEPTION 'injected legacy Stop failure'; END IF; RETURN NEW; END $$`
        )
      )
      await db.execute(
        sql.raw(
          `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${trigger}()`
        )
      )
      try {
        const error = await requestRunStop({ userId, streamId, chatId, ...owner }).catch(
          (error) => error
        )
        expect(error?.cause?.message ?? error?.message).toContain('injected legacy Stop failure')
        expect(await isRunStopRequested({ userId, streamId, ...owner })).toBe(false)
        const [unchanged] = await db
          .select({ closedAt: copilotRuns.toolAdmissionClosedAt })
          .from(copilotRuns)
          .where(eq(copilotRuns.id, run.id))
        expect(unchanged.closedAt).toBeNull()
      } finally {
        await db.execute(sql.raw(`DROP TRIGGER ${trigger} ON ${table}`))
        await db.execute(sql.raw(`DROP FUNCTION ${trigger}()`))
      }
      await requestRunStop({ userId, streamId, chatId, ...owner })
      expect(await isRunStopRequested({ userId, streamId, ...owner })).toBe(true)
      const legacy = kind === 'workspace' ? copilotRequestStops : copilotOrganizationRequestStops
      expect(
        await db
          .select({ streamId: legacy.streamId })
          .from(legacy)
          .where(and(eq(legacy.userId, userId), eq(legacy.streamId, streamId)))
      ).toHaveLength(1)
      await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
      if (kind === 'organization')
        await db.delete(organization).where(eq(organization.id, sourceId))
    }
  )
})
