/**
 * Deleting a chat, an account or a workspace, or removing someone's access, stops the runs it
 * leaves without an owner, against real PostgreSQL and Redis through the production deletion
 * paths and the worker's run-control read. A local HTTP server stands in for the worker and
 * records each Stop pushed to it.
 */
import type { Principal } from '@sim/auth/principal'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  const worker = {
    stops: [] as string[],
    /** Streams whose Stop the worker cannot take, as during an outage. */
    unreachable: new Set<string>(),
  }
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    const streamId = String(body.messageId ?? '')
    if (request.url !== '/api/streams/explicit-abort' || worker.unreachable.has(streamId)) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Unavailable' }))
      return
    }
    worker.stops.push(streamId)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ settled: true }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = readTestRedisUrl()
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
  }
  if (url) process.env.REDIS_URL = url
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  return { redisUrl: url, inheritedEnv, worker: Object.assign(worker, { server }) }
})

vi.mock('@/lib/auth', () => authMock)

/** Every stream a Stop delivery was started for, recorded when delivery is requested. */
const requestedDeliveries = vi.hoisted(() => [] as string[])
vi.mock('@/lib/mothership/request/application/stop-delivery', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/mothership/request/application/stop-delivery')>()
  return {
    ...actual,
    deliverRunStops: (...args: Parameters<typeof actual.deliverRunStops>) => {
      requestedDeliveries.push(...args[0].map((run) => run.streamId))
      actual.deliverRunStops(...args)
    },
  }
})

import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotRequestStops,
  copilotRuns,
  idempotencyKey,
  member,
  organization,
  permissions,
  scimConnection,
  scimGroupMapping,
  scimGroupMember,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import { createRunSegment } from '@/lib/mothership/async-runs/repository'
import { admitChatTurn } from '@/lib/mothership/chat/application/admit-turn'
import { deleteCopilotChat, softDeleteMothershipChat } from '@/lib/mothership/chat/deletion'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { abortRun, steerRun } from '@/lib/mothership/request/application/controls'
import { claimRunController } from '@/lib/mothership/request/lifecycle/controller-ownership'
import {
  acquirePendingChatStream,
  getLocalChatStreamLease,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import { chatStreamLockKey } from '@/lib/mothership/request/session/controller-lease'
import { executeSimControl } from '@/lib/mothership/transport/control'
import {
  removeOrganizationMemberRecord,
  updateOrganizationMemberRecord,
} from '@/lib/organizations/member-manager'
import { changeMemberRoleTx } from '@/lib/organizations/members/lifecycle'
import { AccountDeletionBlockedError, deleteUserAccount } from '@/lib/users/account-deletion'
import { revokeWorkspaceAccessTx } from '@/lib/workspaces/access/workspace-access'
import { removeWorkspaceMemberRecord } from '@/lib/workspaces/permissions/member-removal-store'
import { DELETE as deleteWorkspace } from '@/app/api/workspaces/[id]/route'
import { replaceScimGroup } from '@/ee/scim/lib/application/groups/manage-groups'
import {
  PROJECTION_BATCH_SIZE,
  reconcileUsersProjectionInBatches,
} from '@/ee/scim/lib/projection/reconcile-user'
import { insertScimGroup } from '@/ee/scim/lib/repository/groups'
import { insertScimUser } from '@/ee/scim/lib/repository/users'

const userIds: string[] = []
const workspaceIds: string[] = []
const organizationIds: string[] = []

interface SeededRun {
  userId: string
  chatId: string
  streamId: string
  runId: string
  workspaceId?: string
  organizationId?: string
}

async function seedUser() {
  const id = generateId()
  userIds.push(id)
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Run removal fixture',
    email: `${id}@run-removal.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

/** A workspace its owner pays for, with each listed member granted access. */
async function seedWorkspace(ownerId: string, members: string[] = []) {
  const id = generateId()
  workspaceIds.push(id)
  await insertWorkspaceFixture(db, {
    id,
    name: 'Run removal fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values(
    [ownerId, ...members].map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: id,
      permissionType: userId === ownerId ? ('admin' as const) : ('write' as const),
    }))
  )
  return id
}

/** An organization its owner runs, with one workspace of its own. */
async function seedOrganization(ownerId: string) {
  const organizationId = generateId()
  organizationIds.push(organizationId)
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Run removal fixture', slug: organizationId })
  await db
    .insert(member)
    .values({ id: generateId(), organizationId, userId: ownerId, role: 'owner' })
  const workspaceId = generateId()
  workspaceIds.push(workspaceId)
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Run removal fixture',
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
  })
  return { organizationId, workspaceId }
}

async function grantWrite(userId: string, workspaceId: string) {
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'write',
  })
}

/** A Chat run its controller is still driving, in a chat of its own. */
async function seedRun(
  owner: { userId: string } & ({ workspaceId: string } | { organizationId: string }),
  type: 'mothership' | 'copilot' = 'mothership'
): Promise<SeededRun> {
  const chatId = generateId()
  const streamId = generateId()
  testStreams.add(streamId)
  const runId = generateId()
  const scope =
    'workspaceId' in owner
      ? { workspaceId: owner.workspaceId }
      : { organizationId: owner.organizationId }
  await db.insert(copilotChats).values({
    id: chatId,
    userId: owner.userId,
    type,
    conversationId: streamId,
    ...scope,
  })
  await db.insert(copilotRuns).values({
    id: runId,
    executionId: generateId(),
    chatId,
    userId: owner.userId,
    streamId,
    status: 'active',
    toolExecutionVersion: SIM_TOOL_EXECUTION_VERSION,
    requestContext: { requestId: generateId(), controllerToken: `${streamId}\n${generateId()}` },
    ...scope,
  })
  return { userId: owner.userId, chatId, streamId, runId, ...scope }
}

/** A chat with no run yet, as a task wake, inbox email, API or Slack turn finds it. */
async function seedChat(userId: string, workspaceId: string) {
  const chatId = generateId()
  await db.insert(copilotChats).values({ id: chatId, userId, workspaceId, type: 'mothership' })
  return chatId
}

/** Admits a headless turn's run the way those surfaces do, without the chat view's admission. */
async function admitHeadlessRun(userId: string, chatId: string, workspaceId: string) {
  const streamId = generateId()
  testStreams.add(streamId)
  const run = await createRunSegment({
    id: generateId(),
    executionId: generateId(),
    chatId,
    userId,
    workspaceId,
    streamId,
    requestContext: { source: 'headless_lifecycle' },
  })
  return { run, seeded: { userId, chatId, streamId, runId: run.id, workspaceId } }
}

async function toolAdmissionClosedAt(run: SeededRun) {
  const [row] = await db
    .select({ closedAt: copilotRuns.toolAdmissionClosedAt })
    .from(copilotRuns)
    .where(eq(copilotRuns.id, run.runId))
  return row?.closedAt ?? null
}

/** What the worker's heartbeat reads, through the outbound control transport. */
async function runControl(run: SeededRun) {
  const result = await executeSimControl({
    id: generateId(),
    expiresAt: Date.now() + 15_000,
    scope: {
      userId: run.userId,
      chatId: run.chatId,
      ...(run.workspaceId ? { workspaceId: run.workspaceId } : {}),
      ...(run.organizationId ? { organizationId: run.organizationId } : {}),
    },
    operation: { kind: 'run_control', input: { chatId: run.chatId, streamId: run.streamId } },
  })
  return { status: result.status, body: JSON.parse(result.body) }
}

async function hasStop(run: SeededRun) {
  const rows = await db
    .select({ streamId: copilotRequestStops.streamId })
    .from(copilotRequestStops)
    .where(
      and(
        eq(copilotRequestStops.userId, run.userId),
        eq(copilotRequestStops.streamId, run.streamId)
      )
    )
  return rows.length > 0
}

async function runStatus(run: SeededRun) {
  const [row] = await db
    .select({ status: copilotRuns.status })
    .from(copilotRuns)
    .where(eq(copilotRuns.id, run.runId))
  return row?.status
}

/** This test's streams: a removal's delivery runs after it returns, and can outlive its test. */
const testStreams = new Set<string>()

/** The Stops the worker received for this test's runs. */
const pushedStops = () => worker.stops.filter((streamId) => testStreams.has(streamId)).sort()

/** The backend queued on a lock behind any of these, once one is. */
async function lockWaiterBehind(...blockers: number[]) {
  const pids = sql`ARRAY[${sql.join(
    blockers.map((pid) => sql`${pid}::int`),
    sql`, `
  )}]`
  let waiter: number | undefined
  await expect
    .poll(
      async () => {
        const [row] = await db.execute<{ pid: number }>(sql`
          SELECT pid FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND pid <> ALL(${pids})
            AND pg_blocking_pids(pid) && ${pids} LIMIT 1
        `)
        waiter = row?.pid
        return waiter
      },
      { interval: 5, timeout: 5000 }
    )
    .toBeDefined()
  return waiter as number
}

/** Holds the chat row locked while `run` queues work behind it, then commits. */
async function whileHolding<T>(chatId: string, run: (holder: number) => Promise<T>): Promise<T> {
  const locked = createDeferred<number>()
  const release = createDeferred<void>()
  const holding = db.transaction(async (tx) => {
    await tx
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
      .for('update')
    const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
    locked.resolve(backend.pid)
    await release.promise
  })
  holding.catch(locked.reject)
  const holder = await locked.promise
  try {
    return await run(holder)
  } finally {
    release.resolve()
    await holding
  }
}

type DirectoryTarget = { workspaceId: string } | { role: 'admin' }

/** Points the group's only mapping at `target`, as an administrator's mapping edit does. */
async function mapGroup(groupId: string, target: DirectoryTarget) {
  await db.delete(scimGroupMapping).where(eq(scimGroupMapping.groupId, groupId))
  await db.insert(scimGroupMapping).values({
    id: generateId(),
    groupId,
    ...('workspaceId' in target
      ? {
          targetKind: 'workspace',
          workspaceId: target.workspaceId,
          permissionType: 'write' as const,
        }
      : { targetKind: 'org_role', role: target.role }),
  })
}

/** A directory connection for the organization, with one group mapped to `target`. */
async function seedDirectory(organizationId: string, target: DirectoryTarget) {
  const connectionId = generateId()
  await db.insert(scimConnection).values({ id: connectionId, organizationId })
  const group = await insertScimGroup(db, { connectionId, displayName: generateId() })
  await mapGroup(group.id, target)
  const principal: Principal = {
    kind: 'scim_connection',
    organizationId,
    connectionId,
    credentialId: generateId(),
    scopes: ['groups:write'],
  }
  /** Sets the group's members, as a directory's full-group PUT does. */
  const setGroupMembers = (memberIds: string[]) =>
    replaceScimGroup.execute({
      principal,
      input: { groupId: group.id, group: { displayName: group.displayName, memberIds } },
    })
  /** Re-projects these users in bounded transactions, as the scheduled pass and mapping edits do. */
  const reconcile = (scimUserIds: string[]) =>
    reconcileUsersProjectionInBatches({ connectionId, organizationId, scimUserIds, settings: {} })
  return {
    connectionId,
    groupId: group.id,
    setGroupMembers,
    reconcile,
    remap: (next: DirectoryTarget) => mapGroup(group.id, next),
  }
}

/** An organization member the directory provisions, returning their directory user id. */
async function seedDirectoryMember(connectionId: string, organizationId: string) {
  const userId = await seedUser()
  await db.insert(member).values({ id: generateId(), organizationId, userId, role: 'member' })
  const { id } = await insertScimUser(db, {
    connectionId,
    userId,
    attributes: {
      userName: `${userId}@run-removal.test`,
      active: true,
      name: { formatted: 'Run removal fixture' },
      emails: [{ value: `${userId}@run-removal.test`, primary: true }],
    },
    active: true,
  })
  return { userId, scimUserId: id }
}

/** Fails, inside its transaction, any projection that records a grant for this directory user. */
async function refuseGrantsFor(scimUserId: string) {
  const name = `refuse_grant_${scimUserId.replaceAll('-', '_')}`
  await db.execute(
    sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'projection refused'; END $$`)
  )
  await db.execute(
    sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON scim_projection_grant FOR EACH ROW
      WHEN (NEW.scim_user_id = '${scimUserId}') EXECUTE FUNCTION ${name}()`)
  )
  return async () => {
    await db.execute(sql.raw(`DROP TRIGGER ${name} ON scim_projection_grant`))
    await db.execute(sql.raw(`DROP FUNCTION ${name}()`))
  }
}

const REFUSED = { cause: { message: 'projection refused' } }

/** Directory members, ordered as a projection visits them. */
async function seedDirectoryMembersInOrder(
  connectionId: string,
  organizationId: string,
  count: number
) {
  const members = []
  for (let index = 0; index < count; index += 1) {
    members.push(await seedDirectoryMember(connectionId, organizationId))
  }
  return members.sort((left, right) => (left.scimUserId < right.scimUserId ? -1 : 1))
}

/** Stop deliveries started for this test's runs; one is started before its write returns. */
const requestedStops = () =>
  requestedDeliveries.filter((streamId) => testStreams.has(streamId)).sort()

/** Queues admission and deletion behind a held chat row in the order `first` names. */
async function queueOnChat<A, D>(
  chatId: string,
  first: 'admission' | 'deletion',
  admit: () => Promise<A>,
  remove: () => Promise<D>
): Promise<{ admission: Promise<A>; deletion: Promise<D> }> {
  return whileHolding(chatId, async (holder) => {
    const admission = first === 'admission' ? admit() : undefined
    const deletion = admission ? undefined : remove()
    const waiter = await lockWaiterBehind(holder)
    const queued = { admission: admission ?? admit(), deletion: deletion ?? remove() }
    await lockWaiterBehind(holder, waiter)
    return queued
  })
}

const STOPPED = { status: 200, body: { stopped: true } }
const LIVE = { status: 200, body: { stopped: false } }

/** Runs whether or not the suite does, so a skipped suite never leaks the worker or env. */
afterAll(async () => {
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('removing a run’s chat, owner or access stops the run', () => {
  beforeEach(() => {
    testStreams.clear()
    worker.unreachable.clear()
  })

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(copilotRuns).where(inArray(copilotRuns.userId, userIds))
      await db.delete(copilotChats).where(inArray(copilotChats.userId, userIds))
      await db.delete(permissions).where(inArray(permissions.userId, userIds))
      await db.delete(member).where(inArray(member.userId, userIds))
    }
    if (workspaceIds.length) await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
    if (organizationIds.length)
      await db.delete(organization).where(inArray(organization.id, organizationIds))
    if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
    chatPubSub?.dispose()
    await closeRedisConnection()
  })

  it('lets a run continue while its chat, owner and access remain', async () => {
    const ownerId = await seedUser()
    const run = await seedRun({ userId: ownerId, workspaceId: await seedWorkspace(ownerId) })

    expect(await runControl(run)).toEqual(LIVE)
  })

  it('stops a deleted Mothership chat’s run at once, and a restore does not revive it', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const run = await seedRun({ userId: ownerId, workspaceId })
    const sibling = await seedRun({ userId: ownerId, workspaceId })

    expect(await softDeleteMothershipChat({ chatId: run.chatId, userId: ownerId })).toEqual({
      workspaceId,
      organizationId: null,
    })

    await expect.poll(pushedStops).toEqual([run.streamId])
    expect(await hasStop(run)).toBe(true)
    await expect.poll(() => runStatus(run)).toBe('cancelled')
    expect(await runControl(run)).toEqual(STOPPED)
    await db.update(copilotChats).set({ deletedAt: null }).where(eq(copilotChats.id, run.chatId))
    expect(await runControl(run)).toEqual(STOPPED)
    expect(await hasStop(sibling)).toBe(false)
    expect(await runControl(sibling)).toEqual(LIVE)
  })

  it('stops a permanently deleted copilot chat’s run', async () => {
    const ownerId = await seedUser()
    const run = await seedRun(
      { userId: ownerId, workspaceId: await seedWorkspace(ownerId) },
      'copilot'
    )

    expect(await deleteCopilotChat({ chatId: run.chatId, userId: ownerId })).not.toBeNull()

    await expect.poll(pushedStops).toEqual([run.streamId])
    expect(await runControl(run)).toEqual(STOPPED)
  })

  it('cancels the client workflow a permanently deleted chat’s run started', async () => {
    const ownerId = await seedUser()
    const run = await seedRun(
      { userId: ownerId, workspaceId: await seedWorkspace(ownerId) },
      'copilot'
    )
    const executionId = generateId()
    await db.insert(copilotAsyncToolCalls).values({
      runId: run.runId,
      toolCallId: generateId(),
      toolName: 'run_workflow',
      clientWorkflowExecutionId: executionId,
      executionStartedAt: new Date(),
    })

    expect(await deleteCopilotChat({ chatId: run.chatId, userId: ownerId })).not.toBeNull()

    await expect.poll(() => getRedisClient()?.exists(`execution:cancel:${executionId}`)).toBe(1)
  })

  it('still stops the run when the worker cannot take the pushed Stop', async () => {
    const ownerId = await seedUser()
    const run = await seedRun({ userId: ownerId, workspaceId: await seedWorkspace(ownerId) })
    worker.unreachable.add(run.streamId)

    expect(await softDeleteMothershipChat({ chatId: run.chatId, userId: ownerId })).not.toBeNull()

    expect(pushedStops()).toEqual([])
    expect(await runControl(run)).toEqual(STOPPED)
  })

  it('never lets a takeover adopt a run whose chat was deleted', async () => {
    const ownerId = await seedUser()
    const run = await seedRun({ userId: ownerId, workspaceId: await seedWorkspace(ownerId) })
    const [stored] = await db
      .select({ requestContext: copilotRuns.requestContext })
      .from(copilotRuns)
      .where(eq(copilotRuns.id, run.runId))
    await db
      .update(copilotChats)
      .set({ deletedAt: new Date() })
      .where(eq(copilotChats.id, run.chatId))

    const claimed = await claimRunController({
      runId: run.runId,
      chatId: run.chatId,
      previousToken: String((stored.requestContext as { controllerToken: string }).controllerToken),
      token: `${run.streamId}\n${generateId()}`,
      recoveryBackoff: { attempts: 1, claimedAt: Date.now(), notBefore: Date.now() },
    })

    expect(claimed).toBe(false)
  })

  it('stops a deleted account’s runs in every workspace it erases, and no one else’s', async () => {
    const ownerId = await seedUser()
    const departingId = await seedUser()
    const first = await seedRun({
      userId: departingId,
      workspaceId: await seedWorkspace(departingId),
    })
    const second = await seedRun({
      userId: departingId,
      workspaceId: await seedWorkspace(departingId),
    })
    const bystander = await seedRun({ userId: ownerId, workspaceId: await seedWorkspace(ownerId) })

    await deleteUserAccount(departingId, { recordIdentity: false })

    await expect.poll(pushedStops).toEqual([first.streamId, second.streamId].sort())
    expect(await runControl(first)).toEqual(STOPPED)
    expect(await runControl(second)).toEqual(STOPPED)
    expect(await runControl(bystander)).toEqual(LIVE)
  })

  it('stops nothing when the account deletion is refused', async () => {
    const ownerId = await seedUser()
    const departingId = await seedUser()
    const run = await seedRun({
      userId: departingId,
      workspaceId: await seedWorkspace(ownerId, [departingId]),
    })

    await expect(deleteUserAccount(departingId, { recordIdentity: false })).rejects.toBeInstanceOf(
      AccountDeletionBlockedError
    )

    expect(pushedStops()).toEqual([])
    expect(await hasStop(run)).toBe(false)
    expect(await runControl(run)).toEqual(LIVE)
  })

  it('stops every member’s runs in an archived workspace and none elsewhere', async () => {
    const ownerId = await seedUser()
    const memberId = await seedUser()
    const archived = await seedWorkspace(ownerId, [memberId])
    const ownerRun = await seedRun({ userId: ownerId, workspaceId: archived })
    const memberRun = await seedRun({ userId: memberId, workspaceId: archived })
    const elsewhere = await seedRun({
      userId: memberId,
      workspaceId: await seedWorkspace(memberId),
    })

    await seedWorkspace(ownerId)
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: ownerId },
      session: { id: generateId() },
    })

    const response = await deleteWorkspace(
      new NextRequest(`http://localhost/api/workspaces/${archived}`, {
        method: 'DELETE',
        body: '{}',
      }),
      { params: Promise.resolve({ id: archived }) }
    )

    expect(response.status).toBe(200)

    await expect.poll(pushedStops).toEqual([ownerRun.streamId, memberRun.streamId].sort())
    expect(await runControl(ownerRun)).toEqual(STOPPED)
    expect(await runControl(memberRun)).toEqual(STOPPED)
    expect(await runControl(elsewhere)).toEqual(LIVE)
  })

  it('stops a removed member’s runs in that workspace only', async () => {
    const ownerId = await seedUser()
    const memberId = await seedUser()
    const left = await seedWorkspace(ownerId, [memberId])
    const removedRun = await seedRun({ userId: memberId, workspaceId: left })
    const ownerRun = await seedRun({ userId: ownerId, workspaceId: left })
    const elsewhere = await seedRun({
      userId: memberId,
      workspaceId: await seedWorkspace(memberId),
    })

    await removeWorkspaceMemberRecord(left, memberId, ownerId)

    await expect.poll(pushedStops).toEqual([removedRun.streamId])
    expect(await hasStop(removedRun)).toBe(true)
    expect(await runControl(removedRun)).toEqual(STOPPED)
    expect(await runControl(ownerRun)).toEqual(LIVE)
    expect(await runControl(elsewhere)).toEqual(LIVE)
  })

  it('keeps an organization admin’s run when only their explicit grant is withdrawn', async () => {
    const ownerId = await seedUser()
    const adminId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    await db
      .insert(member)
      .values({ id: generateId(), organizationId, userId: adminId, role: 'admin' })
    await grantWrite(adminId, workspaceId)
    const run = await seedRun({ userId: adminId, workspaceId })

    const revocation = await db.transaction((tx) =>
      revokeWorkspaceAccessTx(tx, { workspaceId, userId: adminId })
    )

    expect(revocation).toMatchObject({ revoked: true, stoppedRuns: [] })
    expect(await hasStop(run)).toBe(false)
    expect(await runControl(run)).toEqual(LIVE)
  })

  it('stops an organization admin’s runs once a demotion ends their derived access', async () => {
    const ownerId = await seedUser()
    const adminId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    await db
      .insert(member)
      .values({ id: generateId(), organizationId, userId: adminId, role: 'admin' })
    const derived = await seedRun({ userId: adminId, workspaceId })
    const granted = await seedRun({ userId: adminId, workspaceId: await seedWorkspace(ownerId) })
    await grantWrite(adminId, granted.workspaceId ?? '')

    await updateOrganizationMemberRecord({
      organizationId,
      userId: adminId,
      role: 'member',
      actorUserId: ownerId,
    })

    await expect.poll(pushedStops).toEqual([derived.streamId])
    expect(await runControl(derived)).toEqual(STOPPED)
    expect(await runControl(granted)).toEqual(LIVE)
  })

  it('records Stop when a directory withdraws an admin’s grant and then their admin role', async () => {
    const ownerId = await seedUser()
    const adminId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    await db
      .insert(member)
      .values({ id: generateId(), organizationId, userId: adminId, role: 'admin' })
    await grantWrite(adminId, workspaceId)
    const run = await seedRun({ userId: adminId, workspaceId })

    await db.transaction(async (tx) => {
      await revokeWorkspaceAccessTx(tx, { workspaceId, userId: adminId })
      await changeMemberRoleTx(tx, { organizationId, userId: adminId, role: 'member' })
    })

    expect(await hasStop(run)).toBe(true)
    expect(await runControl(run)).toEqual(STOPPED)
  })

  it('pushes Stop for a directory group removal once its transaction commits', async () => {
    const ownerId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    const directory = await seedDirectory(organizationId, { workspaceId })
    const removed = await seedDirectoryMember(directory.connectionId, organizationId)
    await directory.setGroupMembers([removed.scimUserId])
    const run = await seedRun({ userId: removed.userId, workspaceId })
    const ownerRun = await seedRun({ userId: ownerId, workspaceId })

    await directory.setGroupMembers([])

    await expect.poll(pushedStops).toEqual([run.streamId])
    expect(await runControl(run)).toEqual(STOPPED)
    expect(await runControl(ownerRun)).toEqual(LIVE)
  })

  it('pushes Stop for a directory demotion that ends an admin’s derived access', async () => {
    const ownerId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    const directory = await seedDirectory(organizationId, { role: 'admin' })
    const demoted = await seedDirectoryMember(directory.connectionId, organizationId)
    await directory.setGroupMembers([demoted.scimUserId])
    const derived = await seedRun({ userId: demoted.userId, workspaceId })

    await directory.setGroupMembers([])

    await expect.poll(pushedStops).toEqual([derived.streamId])
    expect(await runControl(derived)).toEqual(STOPPED)
  })

  it('pushes no Stop when the directory group write that stopped the run rolls back', async () => {
    const ownerId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    const directory = await seedDirectory(organizationId, { workspaceId })
    const [removed, added] = await seedDirectoryMembersInOrder(
      directory.connectionId,
      organizationId,
      2
    )
    await directory.setGroupMembers([removed.scimUserId])
    const run = await seedRun({ userId: removed.userId, workspaceId })
    const allowGrants = await refuseGrantsFor(added.scimUserId)

    try {
      /** The removal is projected first and stops the run; the addition then fails the write. */
      await expect(directory.setGroupMembers([added.scimUserId])).rejects.toMatchObject(REFUSED)
    } finally {
      await allowGrants()
    }

    expect(requestedStops()).toEqual([])
    expect(await hasStop(run)).toBe(false)
    expect(await runControl(run)).toEqual(LIVE)
  })

  it('pushes Stop for a committed batch when a later batch rolls back, and none for that batch', async () => {
    const ownerId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    const directory = await seedDirectory(organizationId, { workspaceId })
    const members = await seedDirectoryMembersInOrder(
      directory.connectionId,
      organizationId,
      PROJECTION_BATCH_SIZE + 2
    )
    const committed = members[0]
    const rolledBack = members[PROJECTION_BATCH_SIZE]
    const refused = members[PROJECTION_BATCH_SIZE + 1]
    await directory.setGroupMembers([committed.scimUserId, rolledBack.scimUserId])
    const committedRun = await seedRun({ userId: committed.userId, workspaceId })
    const rolledBackRun = await seedRun({ userId: rolledBack.userId, workspaceId })
    /** Membership drifts behind the projection's back, as the scheduled pass repairs it. */
    await db.delete(scimGroupMember).where(eq(scimGroupMember.groupId, directory.groupId))
    await db
      .insert(scimGroupMember)
      .values({ id: generateId(), groupId: directory.groupId, scimUserId: refused.scimUserId })
    const allowGrants = await refuseGrantsFor(refused.scimUserId)

    try {
      await expect(
        directory.reconcile(members.map((entry) => entry.scimUserId))
      ).rejects.toMatchObject(REFUSED)
    } finally {
      await allowGrants()
    }

    expect(requestedStops()).toEqual([committedRun.streamId])
    await expect.poll(pushedStops).toEqual([committedRun.streamId])
    expect(await runControl(committedRun)).toEqual(STOPPED)
    expect(await hasStop(rolledBackRun)).toBe(false)
    expect(await runControl(rolledBackRun)).toEqual(LIVE)
  })

  it('keeps a demoted admin’s run when the same pass grants its workspace', async () => {
    const ownerId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    const directory = await seedDirectory(organizationId, { role: 'admin' })
    const demoted = await seedDirectoryMember(directory.connectionId, organizationId)
    await directory.setGroupMembers([demoted.scimUserId])
    const run = await seedRun({ userId: demoted.userId, workspaceId })

    await directory.remap({ workspaceId })
    await directory.reconcile([demoted.scimUserId])

    expect(requestedStops()).toEqual([])
    expect(await hasStop(run)).toBe(false)
    expect(await runControl(run)).toEqual(LIVE)
  })

  it('keeps a run when the same pass trades its workspace grant for the admin role', async () => {
    const ownerId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    const directory = await seedDirectory(organizationId, { workspaceId })
    const promoted = await seedDirectoryMember(directory.connectionId, organizationId)
    await directory.setGroupMembers([promoted.scimUserId])
    const run = await seedRun({ userId: promoted.userId, workspaceId })

    await directory.remap({ role: 'admin' })
    await directory.reconcile([promoted.scimUserId])

    expect(requestedStops()).toEqual([])
    expect(await hasStop(run)).toBe(false)
    expect(await runControl(run)).toEqual(LIVE)
  })

  it('stops a removed organization member’s Assistant runs', async () => {
    const ownerId = await seedUser()
    const memberId = await seedUser()
    const organizationId = generateId()
    organizationIds.push(organizationId)
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Run removal fixture', slug: organizationId })
    await db.insert(member).values([
      { id: generateId(), organizationId, userId: ownerId, role: 'owner' },
      { id: generateId(), organizationId, userId: memberId, role: 'member' },
    ])
    const removedRun = await seedRun({ userId: memberId, organizationId })
    const ownerRun = await seedRun({ userId: ownerId, organizationId })

    await removeOrganizationMemberRecord({ organizationId, userId: memberId, actorUserId: ownerId })

    await expect.poll(pushedStops).toEqual([removedRun.streamId])
    expect(await runControl(removedRun)).toEqual(STOPPED)
    expect(await runControl(ownerRun)).toEqual(LIVE)
  })

  it('stops an external collaborator’s runs in the organization’s workspaces only', async () => {
    const ownerId = await seedUser()
    const externalId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    await grantWrite(externalId, workspaceId)
    const removedRun = await seedRun({ userId: externalId, workspaceId })
    const elsewhere = await seedRun({
      userId: externalId,
      workspaceId: await seedWorkspace(externalId),
    })

    await removeOrganizationMemberRecord({
      organizationId,
      userId: externalId,
      actorUserId: ownerId,
    })

    await expect.poll(pushedStops).toEqual([removedRun.streamId])
    expect(await runControl(removedRun)).toEqual(STOPPED)
    expect(await runControl(elsewhere)).toEqual(LIVE)
  })

  it('delivers the Stop it recorded even when there was no access left to remove', async () => {
    const ownerId = await seedUser()
    const externalId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    const run = await seedRun({ userId: externalId, workspaceId })

    await expect(
      removeOrganizationMemberRecord({ organizationId, userId: externalId, actorUserId: ownerId })
    ).rejects.toThrow('External workspace member not found')

    await expect.poll(pushedStops).toEqual([run.streamId])
  })

  it('delivers each Stop once when leaving a workspace also ends the organization membership', async () => {
    const ownerId = await seedUser()
    const memberId = await seedUser()
    const { organizationId, workspaceId } = await seedOrganization(ownerId)
    await db
      .insert(member)
      .values({ id: generateId(), organizationId, userId: memberId, role: 'member' })
    await grantWrite(memberId, workspaceId)
    const workspaceRun = await seedRun({ userId: memberId, workspaceId })
    const assistantRun = await seedRun({ userId: memberId, organizationId })
    /** A live controller keeps the run unsettled, as it would be while both removals commit. */
    await getRedisClient()?.set(
      chatStreamLockKey(workspaceRun.chatId),
      workspaceRun.streamId,
      'EX',
      60
    )

    await removeWorkspaceMemberRecord(workspaceId, memberId, ownerId)

    const expected = [workspaceRun.streamId, assistantRun.streamId].sort()
    await expect.poll(pushedStops).toEqual(expected)
    await sleep(300)
    expect(pushedStops()).toEqual(expected)
    await getRedisClient()?.del(chatStreamLockKey(workspaceRun.chatId))
  })

  it('answers Stop for a suspended owner’s run', async () => {
    const ownerId = await seedUser()
    const run = await seedRun({ userId: ownerId, workspaceId: await seedWorkspace(ownerId) })

    await db.update(user).set({ banned: true }).where(eq(user.id, ownerId))

    expect(await runControl(run)).toEqual(STOPPED)
  })

  it('lets a blocked owner Stop their run, and neither steer nor send, nor anyone else Stop it', async () => {
    const ownerId = await seedUser()
    const memberId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId, [memberId])
    const run = await seedRun({ userId: ownerId, workspaceId })
    await db.update(user).set({ banned: true }).where(eq(user.id, ownerId))
    const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
    const input = { streamId: run.streamId, chatId: run.chatId, workspaceId }

    await expect(
      steerRun.execute({
        principal: owner,
        input: { ...input, steeringId: generateId(), content: 'Keep going' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    const sendStreamId = generateId()
    expect(await acquirePendingChatStream(run.chatId, sendStreamId, 0)).toBe(true)
    const lease = getLocalChatStreamLease(run.chatId, sendStreamId)
    if (!lease) throw new Error('The send needs its chat lease')
    const sendClaim = { normalizedKey: `run-removal:${generateId()}`, claimToken: generateId() }
    await db
      .insert(idempotencyKey)
      .values({ key: sendClaim.normalizedKey, result: { claimToken: sendClaim.claimToken } })
    await expect(
      admitChatTurn
        .execute({
          principal: owner,
          input: {
            chatId: run.chatId,
            runId: generateId(),
            executionId: generateId(),
            requestId: generateId(),
            message: { id: sendStreamId, content: 'Start over' },
            recovery: {
              kind: 'interactive_stream',
              goRoute: '/api/mothership',
              clientToolPickupExpected: false,
              request: {
                userId: ownerId,
                chatId: run.chatId,
                messageId: sendStreamId,
                workspaceId,
                message: 'Start over',
              },
            },
            lease,
            sendClaim,
            notifyWorkspaceStatus: false,
          },
        })
        .finally(() => releasePendingChatStream(run.chatId, sendStreamId, lease))
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      abortRun.execute({
        principal: createSessionPrincipal({ userId: memberId, sessionId: generateId() }),
        input,
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(await hasStop(run)).toBe(false)
    expect(pushedStops()).toEqual([])

    await expect(abortRun.execute({ principal: owner, input })).resolves.toMatchObject({
      aborted: true,
    })
    expect(await hasStop(run)).toBe(true)
    expect(pushedStops()).toEqual([run.streamId])
  })

  /**
   * Admission and deletion both write the chat row, so they serialize on its lock; holding it
   * queues them in a chosen order, then releases them together.
   */
  it.each(['admission', 'deletion'] as const)(
    'never leaves a run admitted while its chat is being deleted, when %s reaches the chat first',
    async (first) => {
      const ownerId = await seedUser()
      const workspaceId = await seedWorkspace(ownerId)
      const chatId = await seedChat(ownerId, workspaceId)
      const streamId = generateId()
      testStreams.add(streamId)
      const sendClaim = { normalizedKey: `run-removal:${generateId()}`, claimToken: generateId() }
      await db
        .insert(idempotencyKey)
        .values({ key: sendClaim.normalizedKey, result: { claimToken: sendClaim.claimToken } })
      expect(await acquirePendingChatStream(chatId, streamId, 0)).toBe(true)
      const lease = getLocalChatStreamLease(chatId, streamId)
      if (!lease) throw new Error('The admission needs its chat lease')
      const content = 'Summarize the quarter'
      const admit = () =>
        admitChatTurn
          .execute({
            principal: createSessionPrincipal({ userId: ownerId, sessionId: generateId() }),
            input: {
              chatId,
              runId: generateId(),
              executionId: generateId(),
              requestId: generateId(),
              message: { id: streamId, content },
              recovery: {
                kind: 'interactive_stream',
                goRoute: '/api/mothership',
                clientToolPickupExpected: false,
                request: {
                  userId: ownerId,
                  chatId,
                  messageId: streamId,
                  workspaceId,
                  message: content,
                },
              },
              lease,
              sendClaim,
              notifyWorkspaceStatus: false,
            },
          })
          .then(
            () => true,
            (error) => {
              if (!(error instanceof OrchestrationError) || error.code !== 'not_found') throw error
              return false
            }
          )
          .finally(() => releasePendingChatStream(chatId, streamId, lease))
      const remove = () => softDeleteMothershipChat({ chatId, userId: ownerId })

      const { admission, deletion } = await queueOnChat(chatId, first, admit, remove)

      const admitted = await admission
      expect(await deletion).not.toBeNull()
      const run = { userId: ownerId, chatId, streamId, runId: '', workspaceId }
      expect(admitted).toBe(first === 'admission')
      if (admitted) {
        await expect.poll(pushedStops).toEqual([streamId])
        expect(await hasStop(run)).toBe(true)
      }
      expect(await runControl(run)).toEqual(STOPPED)
    }
  )

  it('admits a headless run of a live chat as live', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)

    const { run, seeded } = await admitHeadlessRun(
      ownerId,
      await seedChat(ownerId, workspaceId),
      workspaceId
    )

    expect(run).toMatchObject({ status: 'active', toolAdmissionClosedAt: null, completedAt: null })
    expect(await runControl(seeded)).toEqual(LIVE)
  })

  it('admits a headless run of a chat deleted before it as already stopped', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const chatId = await seedChat(ownerId, workspaceId)
    expect(await softDeleteMothershipChat({ chatId, userId: ownerId })).not.toBeNull()

    const { run, seeded } = await admitHeadlessRun(ownerId, chatId, workspaceId)

    expect(run.status).toBe('cancelled')
    expect(run.toolAdmissionClosedAt).not.toBeNull()
    expect(run.completedAt).not.toBeNull()
    expect(await runControl(seeded)).toEqual(STOPPED)
  })

  /**
   * A headless run is admitted without writing the chat row, so only its read of the chat
   * serializes it with a deletion: holding the row queues both in a chosen order.
   */
  it.each(['admission', 'deletion'] as const)(
    'never leaves a headless run live while its chat is being deleted, when %s reaches the chat first',
    async (first) => {
      const ownerId = await seedUser()
      const workspaceId = await seedWorkspace(ownerId)
      const chatId = await seedChat(ownerId, workspaceId)
      const admit = () => admitHeadlessRun(ownerId, chatId, workspaceId)
      const remove = () => softDeleteMothershipChat({ chatId, userId: ownerId })

      const { admission, deletion } = await queueOnChat(chatId, first, admit, remove)

      const { run, seeded } = await admission
      expect(await deletion).not.toBeNull()
      if (first === 'admission') {
        await expect.poll(pushedStops).toEqual([seeded.streamId])
        expect(await hasStop(seeded)).toBe(true)
      } else {
        expect(run.status).toBe('cancelled')
        expect(pushedStops()).toEqual([])
      }
      expect(await toolAdmissionClosedAt(seeded)).not.toBeNull()
      expect(await runControl(seeded)).toEqual(STOPPED)
    }
  )
})
