/**
 * The organization shell's chats against real PostgreSQL and Redis, through the production chat
 * route, run lifecycle, Stop and workspace-target paths. A local HTTP server stands in for the
 * worker and records every request.
 *
 * - A workspace chat open in the shell (here, on a guest workspace that renders in the viewer's
 *   team organization) sends and stops under the scope the shell derives for it. The organization
 *   the shell shows is refused for both, as the shell sent before.
 * - A client-only surface (the extension's panel) learns that scope from the chat detail, which
 *   names a workspace chat's workspace and no workspace for an organization chat.
 * - An organization chat may target a guest workspace that renders in its organization's shell,
 *   and still not a workspace its owner cannot open.
 * - An Enterprise team organization's chat sends its organization's own BYOK key on every leg.
 */
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  const worker = {
    /** Every turn leg the worker received, by stream. */
    turns: [] as Array<{ path: string; body: Record<string, unknown> }>,
    /** Streams whose explicit Stop the worker received. */
    stops: [] as string[],
    /** Streams whose leg stays open until it is stopped. */
    held: new Set<string>(),
    open: new Map<string, import('node:http').ServerResponse>(),
  }
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    const path = request.url ?? ''
    const streamId = String(body.messageId ?? body.streamId ?? '')
    if (path === '/api/streams/explicit-abort') {
      worker.stops.push(streamId)
      worker.open.get(streamId)?.socket?.destroy()
      worker.open.delete(streamId)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ settled: true }))
      return
    }
    if (path !== '/api/mothership') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Not found' }))
      return
    }
    worker.turns.push({ path, body })
    const frame = (seq: number, type: string, payload: unknown) =>
      `data: ${JSON.stringify({
        v: 1,
        type,
        seq,
        ts: new Date().toISOString(),
        stream: { streamId, chatId: body.chatId },
        payload,
      })}\n\n`
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(frame(1, 'session', { kind: 'start' }))
    response.write(
      frame(2, 'text', { channel: 'assistant', text: 'Working on it.', textOffset: 0 })
    )
    if (worker.held.has(streamId)) {
      worker.open.set(streamId, response)
      return
    }
    response.write(frame(3, 'complete', { status: 'complete', textLength: 14 }))
    response.end('data: [DONE]\n\n')
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
vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import { db } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  copilotRuns,
  member,
  organization,
  organizationBYOKKeys,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { handleUnifiedChatPost } from '@/lib/mothership/chat/post'
import { chatRequestScope } from '@/lib/mothership/chat/request-scope'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { abortRun } from '@/lib/mothership/request/application/controls'
import { resolveWorkspaceShellOrganizationId } from '@/lib/workspaces/application/workspace-shell'
import { GET as readChat } from '@/app/api/mothership/chats/[chatId]/route'

const userIds: string[] = []
const workspaceIds: string[] = []
const organizationIds: string[] = []
const chatIds: string[] = []

async function seedUser(label: string) {
  const id = generateId()
  userIds.push(id)
  const now = new Date()
  await db.insert(user).values({
    id,
    name: label,
    email: `${id}@organization-shell-chats.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

async function seedOrganization(ownerId: string, kind: 'team' | 'personal' = 'team') {
  const id = generateId()
  organizationIds.push(id)
  await db.insert(organization).values({ id, name: 'Shell fixture', slug: id, kind })
  await db
    .insert(member)
    .values({ id: generateId(), organizationId: id, userId: ownerId, role: 'owner' })
  return id
}

/** A workspace `ownerId` pays for, in `organizationId` when given, with `guests` able to write. */
async function seedWorkspace(
  ownerId: string,
  organizationId: string | null,
  guests: string[] = []
) {
  const id = generateId()
  workspaceIds.push(id)
  await insertWorkspaceFixture(db, {
    id,
    name: 'Shell fixture',
    ownerId,
    billedAccountUserId: ownerId,
    ...(organizationId ? { organizationId } : {}),
  })
  await db.insert(permissions).values(
    [ownerId, ...guests].map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: id,
      permissionType: userId === ownerId ? ('admin' as const) : ('write' as const),
    }))
  )
  return id
}

async function seedChat(
  userId: string,
  scope: { workspaceId: string } | { organizationId: string }
) {
  const id = generateId()
  chatIds.push(id)
  await db.insert(copilotChats).values({
    id,
    userId,
    type: 'mothership',
    title: 'Shell fixture',
    config: { conversationMode: 'agent' },
    ...scope,
  })
  return id
}

function signIn(userId: string) {
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@organization-shell-chats.test` },
    session: { id: `session-${userId}` },
  })
}

function send(body: Record<string, unknown>) {
  return handleUnifiedChatPost(
    new NextRequest('http://localhost/api/mothership/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Summarize this workspace', mode: 'agent', ...body }),
    })
  )
}

async function readChatWorkspaceId(chatId: string): Promise<unknown> {
  const response = await readChat(
    createMockRequest({ method: 'GET', url: `http://localhost/api/mothership/chats/${chatId}` }),
    createRouteContext({ chatId })
  )
  expect(response.status).toBe(200)
  const body = await response.json()
  return body.chat.workspaceId
}

async function waitFor(condition: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function drain(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return
  while (!(await reader.read()).done) {}
}

afterAll(async () => {
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(Boolean(redisUrl))('chats in the organization shell', () => {
  let viewerId: string
  let shellOrganizationId: string
  /** Someone else's workspace outside any organization, which the viewer may write to. */
  let guestWorkspaceId: string
  /** A workspace the viewer has no access to at all. */
  let closedWorkspaceId: string

  beforeAll(async () => {
    viewerId = await seedUser('Viewer')
    const hostId = await seedUser('Host')
    shellOrganizationId = await seedOrganization(viewerId)
    guestWorkspaceId = await seedWorkspace(hostId, null, [viewerId])
    closedWorkspaceId = await seedWorkspace(hostId, null)
  })

  beforeEach(() => {
    worker.turns.length = 0
    worker.stops.length = 0
    resetEnvFlagsMock()
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
    signIn(viewerId)
  })

  afterAll(async () => {
    if (chatIds.length) {
      await db.delete(copilotMessages).where(inArray(copilotMessages.chatId, chatIds))
      await db.delete(copilotRuns).where(inArray(copilotRuns.chatId, chatIds))
    }
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

  it('renders the guest workspace in the viewer’s own organization', async () => {
    expect(await resolveWorkspaceShellOrganizationId(null, viewerId)).toBe(shellOrganizationId)
  })

  it('sends and stops a workspace chat under the scope the shell derives, and refuses the organization', async () => {
    const chatId = await seedChat(viewerId, { workspaceId: guestWorkspaceId })
    // What the shell's chat gate hands the conversation, and what its requests then name.
    const scope = chatRequestScope({
      organizationId: shellOrganizationId,
      workspaceId: guestWorkspaceId,
    })
    expect(scope).toEqual({ workspaceId: guestWorkspaceId })

    const refused = await send({
      chatId,
      userMessageId: generateId(),
      organizationId: shellOrganizationId,
    })
    expect(refused.status).toBe(404)
    expect(worker.turns).toEqual([])

    const streamId = generateId()
    worker.held.add(streamId)
    const response = await send({ chatId, userMessageId: streamId, ...scope })
    expect(response.status).toBe(200)
    const drained = drain(response)
    await waitFor(() => worker.open.has(streamId), 'the turn to reach the worker')
    expect(worker.turns.at(-1)?.body).toMatchObject({ chatId, workspaceId: guestWorkspaceId })

    const principal = createSessionPrincipal({ userId: viewerId, sessionId: `session-${viewerId}` })
    await expect(
      abortRun.execute({
        principal,
        input: { streamId, chatId, organizationId: shellOrganizationId },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(worker.stops).toEqual([])

    await expect(
      abortRun.execute({ principal, input: { streamId, chatId, ...scope } })
    ).resolves.toMatchObject({ aborted: true })
    expect(worker.stops).toEqual([streamId])
    await drained
    const [run] = await db
      .select({ status: copilotRuns.status })
      .from(copilotRuns)
      .where(eq(copilotRuns.streamId, streamId))
    expect(run?.status).not.toBe('active')
  })

  it('names the scope a client-only surface must send under on the chat detail', async () => {
    const workspaceChatId = await seedChat(viewerId, { workspaceId: guestWorkspaceId })
    const organizationChatId = await seedChat(viewerId, { organizationId: shellOrganizationId })

    for (const chatId of [workspaceChatId, organizationChatId]) {
      const workspaceId = await readChatWorkspaceId(chatId)
      expect(workspaceId).toBe(chatId === workspaceChatId ? guestWorkspaceId : null)
      // What the extension's panel derives from that detail before it sends.
      const scope = chatRequestScope({
        organizationId: shellOrganizationId,
        workspaceId: typeof workspaceId === 'string' ? workspaceId : undefined,
      })
      const response = await send({ chatId, userMessageId: generateId(), ...scope })
      expect(response.status).toBe(200)
      await drain(response)
    }
  })

  it('lets an organization chat target a guest workspace in its shell, never one its owner cannot open', async () => {
    const chatId = await seedChat(viewerId, { organizationId: shellOrganizationId })
    const owner = { userId: viewerId, organizationId: shellOrganizationId, chatId }

    await expect(resolveInvocationWorkspace(owner, guestWorkspaceId)).resolves.toMatchObject({
      workspaceId: guestWorkspaceId,
      chatOrganizationId: shellOrganizationId,
      permission: 'write',
    })
    await expect(resolveInvocationWorkspace(owner, closedWorkspaceId)).rejects.toMatchObject({
      code: expect.stringMatching(/^(not_found|forbidden)$/),
    })
  })

  it('sends an Enterprise team organization’s own BYOK key with its chat’s turn', async () => {
    setEnvFlags({ isHosted: true })
    const { encrypted } = await encryptSecret('sk-ant-organization-fixture')
    await db.insert(organizationBYOKKeys).values({
      id: generateId(),
      organizationId: shellOrganizationId,
      providerId: 'anthropic',
      encryptedApiKey: encrypted,
    })
    const chatId = await seedChat(viewerId, { organizationId: shellOrganizationId })
    const streamId = generateId()

    const response = await send({
      chatId,
      userMessageId: streamId,
      organizationId: shellOrganizationId,
    })
    expect(response.status).toBe(200)
    await drain(response)

    const leg = worker.turns.find((turn) => turn.body.messageId === streamId)
    expect(leg?.body).toMatchObject({
      organizationId: shellOrganizationId,
      byokApiKey: 'sk-ant-organization-fixture',
    })
  })

  it('keeps the hosted key for a personal organization’s chat', async () => {
    setEnvFlags({ isHosted: true })
    const loneId = await seedUser('Personal')
    const personalOrganizationId = await seedOrganization(loneId, 'personal')
    signIn(loneId)
    const chatId = await seedChat(loneId, { organizationId: personalOrganizationId })
    const streamId = generateId()

    const response = await send({
      chatId,
      userMessageId: streamId,
      organizationId: personalOrganizationId,
    })
    expect(response.status).toBe(200)
    await drain(response)

    const leg = worker.turns.find((turn) => turn.body.messageId === streamId)
    expect(leg?.body.organizationId).toBe(personalOrganizationId)
    expect(leg?.body).not.toHaveProperty('byokApiKey')
  })
})
