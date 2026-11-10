/**
 * The personal-organization rollback against real PostgreSQL, with a local HTTP server standing in
 * for the worker. Failure modes: a reverted workspace left pointing at a deleted organization (or
 * its Project left behind); a rerun failing on an already-reverted organization; an organization
 * holding its owner's chats skipped (or its chats deleted) instead of moving them to the owner's
 * workspace; the worker's copy left in the old scope, which the previous release can never fix;
 * other content deleted without being asked to; a skipped organization left half-reverted.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

const { inheritedEnv, worker } = await vi.hoisted(async () => {
  const { createServer } = await import('node:http')
  const worker = { rescopes: [] as unknown[], status: 200 }
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    response.setHeader('content-type', 'application/json')
    if (request.url !== '/api/chats/rescope' || worker.status !== 200) {
      response.writeHead(request.url === '/api/chats/rescope' ? worker.status : 404)
      response.end(JSON.stringify({ error: 'Unavailable' }))
      return
    }
    worker.rescopes.push(body)
    response.writeHead(200)
    response.end(JSON.stringify({ rescoped: body.chatIds.length }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const inheritedEnv = {
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
    COPILOT_API_KEY: process.env.COPILOT_API_KEY,
  }
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  process.env.COPILOT_API_KEY = 'revert-fixture-key'
  return { inheritedEnv, worker: Object.assign(worker, { server }) }
})

import { db } from '@sim/db'
import {
  copilotChats,
  member,
  mothershipMemorySpaces,
  organization,
  outboxEvent,
  project,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { CHAT_RESCOPE_EVENT } from '@/lib/mothership/chat/rescope-event'
import { provisionPersonalOrganization } from '@/lib/organizations/provision-personal'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'
import { revertPersonalOrganization } from '@/scripts/revert-personal-organizations'

const userIds: string[] = []

/** A backfilled account: its organization-less workspace attached to its new personal organization. */
async function backfilledOwner() {
  const userId = `revert-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id: userId,
    name: 'Revert Test',
    email: `${userId}@revert.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId, storageUsedBytes: 0 })
  userIds.push(userId)
  const created = await db.transaction((tx) =>
    createWorkspaceInTransaction(tx, {
      userId,
      name: 'Personal',
      organizationId: null,
      observedOrganizationId: null,
      governingPermissionGroupOrganizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: userId,
      skipDefaultWorkflow: true,
    })
  )
  const provisioned = await provisionPersonalOrganization(userId)
  if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
  return { userId, workspaceId: created.id, organizationId: provisioned.organizationId }
}

async function workspaceOrganizations(workspaceId: string) {
  const [row] = await db
    .select({
      organizationId: workspace.organizationId,
      projectOrganizationId: project.organizationId,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .innerJoin(project, eq(project.id, workspace.projectId))
    .where(eq(workspace.id, workspaceId))
  return row
}

async function organizationChat(userId: string, organizationId: string): Promise<string> {
  const [chat] = await db
    .insert(copilotChats)
    .values({ userId, organizationId, type: 'mothership', title: 'Organization chat' })
    .returning({ id: copilotChats.id })
  return chat.id
}

async function chatScope(chatId: string) {
  const [row] = await db
    .select({ workspaceId: copilotChats.workspaceId, organizationId: copilotChats.organizationId })
    .from(copilotChats)
    .where(eq(copilotChats.id, chatId))
  return row
}

async function organizationExists(organizationId: string) {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
  return rows.length > 0
}

afterAll(async () => {
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (userIds.length === 0) return
  await db
    .delete(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, CHAT_RESCOPE_EVENT),
        inArray(sql`${outboxEvent.payload}->>'userId'`, userIds)
      )
    )
  const workspaces = await db
    .select({ id: workspace.id, projectId: workspace.projectId })
    .from(workspace)
    .where(inArray(workspace.ownerId, userIds))
  const organizations = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  if (workspaces.length > 0) {
    await db.delete(workspace).where(
      inArray(
        workspace.id,
        workspaces.map((row) => row.id)
      )
    )
    await db.delete(project).where(
      inArray(
        project.id,
        workspaces.flatMap((row) => (row.projectId ? [row.projectId] : []))
      )
    )
  }
  if (organizations.length > 0) {
    await db.delete(organization).where(
      inArray(
        organization.id,
        organizations.map((row) => row.id)
      )
    )
  }
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('reverting personal organizations', () => {
  it('returns workspaces to organization-less personal and deletes the organization, once', async () => {
    const { userId, workspaceId, organizationId } = await backfilledOwner()

    const reverted = await revertPersonalOrganization(organizationId, { deleteContent: false })

    expect(reverted).toEqual({
      status: 'reverted',
      detachedWorkspaceIds: [workspaceId],
      deletedContent: false,
      chatWorkspaceId: null,
      rehomedChatCount: 0,
      pendingRescopeEventIds: [],
    })
    expect(await workspaceOrganizations(workspaceId)).toEqual({
      organizationId: null,
      projectOrganizationId: null,
      billedAccountUserId: userId,
    })
    expect(await organizationExists(organizationId)).toBe(false)
    expect(await db.select().from(member).where(eq(member.userId, userId))).toEqual([])
    expect(await revertPersonalOrganization(organizationId, { deleteContent: false })).toEqual({
      status: 'gone',
    })
  })

  it('moves an organization’s chats into the owner’s workspace instead of skipping, and the worker’s copy with them', async () => {
    const { userId, workspaceId, organizationId } = await backfilledOwner()
    const chatId = await organizationChat(userId, organizationId)
    worker.rescopes.length = 0

    expect(await revertPersonalOrganization(organizationId, { deleteContent: false })).toEqual({
      status: 'reverted',
      detachedWorkspaceIds: [workspaceId],
      deletedContent: false,
      chatWorkspaceId: workspaceId,
      rehomedChatCount: 1,
      pendingRescopeEventIds: [],
    })
    expect(await chatScope(chatId)).toEqual({ workspaceId, organizationId: null })
    expect(await organizationExists(organizationId)).toBe(false)
    expect(worker.rescopes).toEqual([
      { chatIds: [chatId], from: { organizationId }, to: { workspaceId } },
    ])
  })

  it('reports a worker move it could not finish inline, for replay once the handler is live again', async () => {
    const { userId, organizationId } = await backfilledOwner()
    await organizationChat(userId, organizationId)
    worker.status = 503
    try {
      const reverted = await revertPersonalOrganization(organizationId, { deleteContent: false })

      expect(reverted).toMatchObject({ status: 'reverted', rehomedChatCount: 1 })
      if (reverted.status !== 'reverted') throw new Error('expected a revert')
      expect(reverted.pendingRescopeEventIds).toHaveLength(1)
      const [event] = await db
        .select({ status: outboxEvent.status })
        .from(outboxEvent)
        .where(eq(outboxEvent.id, reverted.pendingRescopeEventIds[0]))
      expect(event).toEqual({ status: 'pending' })
    } finally {
      worker.status = 200
    }
  })

  it('skips an organization holding other content, chats left in place, unless told to delete that content', async () => {
    const { userId, workspaceId, organizationId } = await backfilledOwner()
    const chatId = await organizationChat(userId, organizationId)
    await db
      .insert(mothershipMemorySpaces)
      .values({ id: generateId(), userId, organizationId, name: 'Notes' })

    expect(await revertPersonalOrganization(organizationId, { deleteContent: false })).toEqual({
      status: 'holds-content',
      table: 'mothership_memory_spaces',
    })
    expect((await workspaceOrganizations(workspaceId)).organizationId).toBe(organizationId)
    expect(await chatScope(chatId)).toEqual({ workspaceId: null, organizationId })
    expect(await organizationExists(organizationId)).toBe(true)

    expect(await revertPersonalOrganization(organizationId, { deleteContent: true })).toMatchObject(
      {
        status: 'reverted',
        deletedContent: true,
        chatWorkspaceId: workspaceId,
        rehomedChatCount: 1,
      }
    )
    expect((await workspaceOrganizations(workspaceId)).organizationId).toBeNull()
    expect(await chatScope(chatId)).toEqual({ workspaceId, organizationId: null })
    expect(
      await db
        .select()
        .from(mothershipMemorySpaces)
        .where(eq(mothershipMemorySpaces.organizationId, organizationId))
    ).toEqual([])
  })
})
