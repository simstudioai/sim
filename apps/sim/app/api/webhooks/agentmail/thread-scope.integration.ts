import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
/**
 * An inbox reply continues its parent task's chat, and the parent is found by the
 * `In-Reply-To` header — a value every recipient of the agent's reply holds. Against
 * real PostgreSQL, a reply delivered to one workspace's inbox must never reach a chat,
 * task, or transcript owned by another workspace, while a reply inside the workspace
 * still continues its thread. The webhook is signed with the real Svix scheme.
 */
import { authBanMock } from '@sim/testing/mocks/auth-ban.mock'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  mothershipHeadlessLifecycleMock,
  mothershipHeadlessLifecycleMockFns,
} from '@sim/testing/mocks/mothership-headless-lifecycle.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteInboxTask, mockSendInboxResponse } = vi.hoisted(() => ({
  mockExecuteInboxTask: vi.fn(),
  mockSendInboxResponse: vi.fn(),
}))

vi.mock('@/lib/auth/ban', () => authBanMock)
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/mothership/request/lifecycle/headless', () => mothershipHeadlessLifecycleMock)
vi.mock('@/lib/mothership/request/lifecycle/start', () => ({
  requestChatTitle: async () => null,
}))
vi.mock('@/lib/mothership/inbox/response', () => ({
  sendInboxResponse: mockSendInboxResponse,
}))
vi.mock('@/lib/mothership/inbox/executor', () => ({
  executeInboxTask: mockExecuteInboxTask,
}))

import { db } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  mothershipInboxTask,
  mothershipInboxWebhook,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { Webhook } from 'svix'
import { persistCopilotChatTurn } from '@/lib/mothership/chat/messages-store'
import { buildPersistedUserMessage } from '@/lib/mothership/chat/persisted-message'
import { POST } from '@/app/api/webhooks/agentmail/route'

const { executeInboxTask } = await vi.importActual<
  typeof import('@/lib/mothership/inbox/executor')
>('@/lib/mothership/inbox/executor')
const { mockRunHeadlessCopilotLifecycle } = mothershipHeadlessLifecycleMockFns

interface InboxWorkspace {
  id: string
  ownerId: string
  ownerEmail: string
  inboxId: string
  secret: string
}

const victim = inboxWorkspace()
const attacker = inboxWorkspace()
const victimChatId = generateId()
const victimReplyMessageId = `<${generateId()}@agentmail.to>`
const victimChatUpdatedAt = new Date('2026-01-01T00:00:00.000Z')

function inboxWorkspace(): InboxWorkspace {
  const id = generateId()
  return {
    id,
    ownerId: generateId(),
    ownerEmail: `${id}@inbox-thread-scope.test`,
    inboxId: `${id}@agentmail.to`,
    secret: `whsec_${Buffer.from(generateId()).toString('base64')}`,
  }
}

async function seedWorkspace(ws: InboxWorkspace): Promise<void> {
  const now = new Date()
  await db.insert(user).values({
    id: ws.ownerId,
    name: 'Inbox thread scope fixture',
    email: ws.ownerEmail,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: ws.id,
    name: 'Inbox thread scope fixture',
    ownerId: ws.ownerId,
    billedAccountUserId: ws.ownerId,
    inboxEnabled: true,
    inboxAddress: ws.inboxId,
    inboxProviderId: ws.inboxId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ws.ownerId,
    entityType: 'workspace',
    entityId: ws.id,
    permissionType: 'admin',
  })
  await db.insert(mothershipInboxWebhook).values({
    id: generateId(),
    workspaceId: ws.id,
    webhookId: generateId(),
    secret: ws.secret,
  })
}

/** Delivers a `message.received` webhook to `ws`'s inbox from its owner, signed with its secret. */
async function deliver(
  ws: InboxWorkspace,
  message: { messageId: string; inReplyTo?: string }
): Promise<Response> {
  const body = JSON.stringify({
    event_type: 'message.received',
    message: {
      message_id: message.messageId,
      thread_id: generateId(),
      inbox_id: ws.inboxId,
      from: `Owner <${ws.ownerEmail}>`,
      to: [ws.inboxId],
      subject: 'Re: quarterly numbers',
      text: 'Please continue this thread.',
      created_at: new Date().toISOString(),
      ...(message.inReplyTo ? { in_reply_to: message.inReplyTo } : {}),
    },
  })
  const svixId = `msg_${generateId()}`
  const timestamp = new Date()
  return POST(
    new NextRequest('http://localhost:3000/api/webhooks/agentmail', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': svixId,
        'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
        'svix-signature': new Webhook(ws.secret).sign(svixId, timestamp, body),
      },
      body,
    }),
    { params: Promise.resolve({}) }
  )
}

async function taskFor(workspaceId: string, emailMessageId: string) {
  const [task] = await db
    .select()
    .from(mothershipInboxTask)
    .where(
      and(
        eq(mothershipInboxTask.workspaceId, workspaceId),
        eq(mothershipInboxTask.emailMessageId, emailMessageId)
      )
    )
  return task
}

async function messageCount(chatId: string): Promise<number> {
  const messages = await db
    .select({ id: copilotMessages.id })
    .from(copilotMessages)
    .where(eq(copilotMessages.chatId, chatId))
  return messages.length
}

async function victimChatState() {
  const [chat] = await db
    .select({ updatedAt: copilotChats.updatedAt })
    .from(copilotChats)
    .where(eq(copilotChats.id, victimChatId))
  return { updatedAt: chat?.updatedAt, messageCount: await messageCount(victimChatId) }
}

describe('inbox reply threading stays inside the receiving workspace', () => {
  beforeAll(async () => {
    await seedWorkspace(victim)
    await seedWorkspace(attacker)
    await db.insert(copilotChats).values({
      id: victimChatId,
      userId: victim.ownerId,
      workspaceId: victim.id,
      type: 'mothership',
      updatedAt: victimChatUpdatedAt,
    })
    await db.insert(mothershipInboxTask).values({
      id: generateId(),
      workspaceId: victim.id,
      fromEmail: victim.ownerEmail,
      subject: 'quarterly numbers',
      status: 'completed',
      chatId: victimChatId,
      responseMessageId: victimReplyMessageId,
    })
  })

  beforeEach(() => {
    mockExecuteInboxTask.mockResolvedValue(undefined)
    mockSendInboxResponse.mockResolvedValue(null)
    billingSubscriptionMockFns.mockHasWorkspaceInboxAccess.mockResolvedValue(true)
    billingAttributionMockFns.mockResolveBillingAttribution.mockResolvedValue({})
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'Here are the numbers.',
      contentBlocks: [],
      toolCalls: [],
    })
  })

  afterAll(async () => {
    const ownerIds = [victim.ownerId, attacker.ownerId]
    await db.delete(permissions).where(inArray(permissions.userId, ownerIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, [victim.id, attacker.id]))
    await db.delete(user).where(inArray(user.id, ownerIds))
  })

  it("does not adopt another workspace's chat for a reply to that workspace's message", async () => {
    const messageId = `<${generateId()}@attacker.test>`

    const response = await deliver(attacker, { messageId, inReplyTo: victimReplyMessageId })

    expect(response.status).toBe(200)
    const task = await taskFor(attacker.id, messageId)
    expect(task?.inReplyTo).toBe(victimReplyMessageId)
    expect(task?.chatId).toBeNull()
  })

  it('continues the parent chat for a reply inside the same workspace', async () => {
    const messageId = `<${generateId()}@victim.test>`

    await deliver(victim, { messageId, inReplyTo: victimReplyMessageId })

    expect((await taskFor(victim.id, messageId))?.chatId).toBe(victimChatId)
  })

  it("accepts a message whose id another workspace's inbox already received", async () => {
    const sharedMessageId = `<${generateId()}@cc-both.test>`

    await deliver(attacker, { messageId: sharedMessageId })
    await deliver(victim, { messageId: sharedMessageId })

    expect(await taskFor(attacker.id, sharedMessageId)).toMatchObject({ status: 'received' })
    expect(await taskFor(victim.id, sharedMessageId)).toMatchObject({ status: 'received' })
  })

  it("runs a task carrying another workspace's chat in a fresh chat of its own workspace", async () => {
    const taskId = generateId()
    await db.insert(mothershipInboxTask).values({
      id: taskId,
      workspaceId: attacker.id,
      fromEmail: attacker.ownerEmail,
      subject: 'Re: quarterly numbers',
      bodyText: 'Append me to the victim transcript.',
      status: 'received',
      chatId: victimChatId,
      inReplyTo: victimReplyMessageId,
    })

    await executeInboxTask(taskId)

    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledOnce()
    const [, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
    expect(options).toMatchObject({ workspaceId: attacker.id })
    expect(options.chatId).not.toBe(victimChatId)
    const [runChat] = await db
      .select({ workspaceId: copilotChats.workspaceId })
      .from(copilotChats)
      .where(eq(copilotChats.id, options.chatId))
    expect(runChat?.workspaceId).toBe(attacker.id)

    const [task] = await db
      .select({ status: mothershipInboxTask.status, chatId: mothershipInboxTask.chatId })
      .from(mothershipInboxTask)
      .where(eq(mothershipInboxTask.id, taskId))
    expect(task).toEqual({ status: 'completed', chatId: options.chatId })
    expect(await messageCount(options.chatId)).toBe(2)
    expect(await victimChatState()).toEqual({
      updatedAt: victimChatUpdatedAt,
      messageCount: 0,
    })
  })

  it("writes nothing when a turn is persisted into another workspace's chat", async () => {
    await persistCopilotChatTurn(
      victimChatId,
      [buildPersistedUserMessage({ id: generateId(), content: 'Injected turn' })],
      { workspaceId: attacker.id }
    )

    expect(await victimChatState()).toEqual({
      updatedAt: victimChatUpdatedAt,
      messageCount: 0,
    })
  })
})
