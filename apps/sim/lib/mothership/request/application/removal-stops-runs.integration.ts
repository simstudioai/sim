/**
 * Deleting a chat, an account or a workspace, or removing someone's access, stops the runs it
 * leaves without an owner, against real PostgreSQL and Redis through the production deletion
 * paths and the worker's run-control read. A local HTTP server stands in for the worker and
 * records each Stop pushed to it.
 */
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
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

import { db } from '@sim/db'
import {
  copilotChats,
  copilotRequestStops,
  copilotRuns,
  idempotencyKey,
  member,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { admitChatTurn } from '@/lib/mothership/chat/application/admit-turn'
import { deleteCopilotChat, softDeleteMothershipChat } from '@/lib/mothership/chat/deletion'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { claimRunController } from '@/lib/mothership/request/lifecycle/controller-ownership'
import {
  acquirePendingChatStream,
  getLocalChatStreamLease,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import { executeSimControl } from '@/lib/mothership/transport/control'
import { removeOrganizationMemberRecord } from '@/lib/organizations/member-manager'
import { AccountDeletionBlockedError, deleteUserAccount } from '@/lib/users/account-deletion'
import { removeWorkspaceMemberRecord } from '@/lib/workspaces/permissions/member-removal-store'
import { DELETE as deleteWorkspace } from '@/app/api/workspaces/[id]/route'

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

/** A Chat run its controller is still driving, in a chat of its own. */
async function seedRun(
  owner: { userId: string } & ({ workspaceId: string } | { organizationId: string }),
  type: 'mothership' | 'copilot' = 'mothership'
): Promise<SeededRun> {
  const chatId = generateId()
  const streamId = generateId()
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
    requestContext: { requestId: generateId(), controllerToken: `${streamId}\n${generateId()}` },
    ...scope,
  })
  return { userId: owner.userId, chatId, streamId, runId, ...scope }
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

/** Stops the worker received; delivery runs after the removal returns. */
const pushedStops = () => [...worker.stops].sort()

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
    worker.stops.length = 0
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

  it('still stops the run when the worker cannot take the pushed Stop', async () => {
    const ownerId = await seedUser()
    const run = await seedRun({ userId: ownerId, workspaceId: await seedWorkspace(ownerId) })
    worker.unreachable.add(run.streamId)

    expect(await softDeleteMothershipChat({ chatId: run.chatId, userId: ownerId })).not.toBeNull()

    expect(worker.stops).toEqual([])
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

    await deleteUserAccount(departingId)

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

    await expect(deleteUserAccount(departingId)).rejects.toBeInstanceOf(AccountDeletionBlockedError)

    expect(worker.stops).toEqual([])
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
    const organizationId = generateId()
    organizationIds.push(organizationId)
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Run removal fixture', slug: organizationId })
    await db
      .insert(member)
      .values({ id: generateId(), organizationId, userId: ownerId, role: 'owner' })
    const organizationWorkspace = generateId()
    workspaceIds.push(organizationWorkspace)
    await insertWorkspaceFixture(db, {
      id: organizationWorkspace,
      name: 'Run removal fixture',
      ownerId,
      billedAccountUserId: ownerId,
      organizationId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId: externalId,
      entityType: 'workspace',
      entityId: organizationWorkspace,
      permissionType: 'write',
    })
    const removedRun = await seedRun({ userId: externalId, workspaceId: organizationWorkspace })
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

  it('answers Stop for a suspended owner’s run', async () => {
    const ownerId = await seedUser()
    const run = await seedRun({ userId: ownerId, workspaceId: await seedWorkspace(ownerId) })

    await db.update(user).set({ banned: true }).where(eq(user.id, ownerId))

    expect(await runControl(run)).toEqual(STOPPED)
  })

  it('never leaves a run admitted while its chat is being deleted live', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const principal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
    const outcomes = new Set<boolean>()
    /** The delete starts progressively later, from before admission locks the chat to after it commits. */
    for (let attempt = 0; attempt < 20; attempt++) {
      const chatId = generateId()
      const streamId = generateId()
      await db
        .insert(copilotChats)
        .values({ id: chatId, userId: ownerId, workspaceId, type: 'mothership' })
      const sendClaim = { normalizedKey: `run-removal:${generateId()}`, claimToken: generateId() }
      await db
        .insert(idempotencyKey)
        .values({ key: sendClaim.normalizedKey, result: { claimToken: sendClaim.claimToken } })
      expect(await acquirePendingChatStream(chatId, streamId, 0)).toBe(true)
      const lease = getLocalChatStreamLease(chatId, streamId)
      if (!lease) throw new Error('The admission needs its chat lease')
      const content = 'Summarize the quarter'
      const admission = admitChatTurn
        .execute({
          principal,
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

      const [admitted] = await Promise.all([
        admission,
        sleep(attempt * 20).then(() => softDeleteMothershipChat({ chatId, userId: ownerId })),
      ])
      outcomes.add(admitted)

      const run = { userId: ownerId, chatId, streamId, runId: '', workspaceId }
      if (admitted) {
        await expect.poll(pushedStops).toContain(streamId)
        expect(await hasStop(run)).toBe(true)
      }
      expect(await runControl(run)).toEqual(STOPPED)
    }
    expect([...outcomes].sort()).toEqual([false, true])
  })
})
