/** Drives POST /api/copilot/feedback against real PostgreSQL rows to prove feedback stays on the caller's own chats. */
import { db } from '@sim/db'
import {
  copilotChats,
  copilotFeedback,
  member,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/copilot/feedback/route'

vi.mock('@/lib/auth', () => authMock)

const ownerId = generateId()
const outsiderId = generateId()
const workspaceId = generateId()
const organizationId = generateId()
const workspaceChatId = generateId()
const organizationChatId = generateId()

function submitAs(userId: string, chatId: string) {
  authMockFns.mockGetSession.mockResolvedValueOnce({
    user: { id: userId },
    session: { id: generateId() },
  })
  return POST(
    new NextRequest('http://localhost:3000/api/copilot/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userQuery: 'What changed?',
        agentResponse: 'Three files changed.',
        isPositiveFeedback: false,
        feedback: 'Missed one file',
      }),
    })
  )
}

async function feedbackRows(chatId: string) {
  return db
    .select({ userId: copilotFeedback.userId })
    .from(copilotFeedback)
    .where(eq(copilotFeedback.chatId, chatId))
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ownerId, outsiderId].map((id) => ({
      id,
      name: 'Chat feedback fixture',
      email: `${id}@chat-feedback.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Chat feedback fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values(
    [ownerId, outsiderId].map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace' as const,
      entityId: workspaceId,
      permissionType: 'admin' as const,
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Chat feedback fixture',
    slug: organizationId,
    createdAt: now,
  })
  await db.insert(member).values(
    [ownerId, outsiderId].map((userId) => ({
      id: generateId(),
      userId,
      organizationId,
      role: 'member',
      createdAt: now,
    }))
  )
  await db.insert(copilotChats).values([
    { id: workspaceChatId, userId: ownerId, workspaceId, type: 'mothership' },
    { id: organizationChatId, userId: ownerId, organizationId, type: 'mothership' },
  ])
})

afterAll(async () => {
  await db
    .delete(copilotChats)
    .where(inArray(copilotChats.id, [workspaceChatId, organizationChatId]))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, outsiderId]))
  await db.$client.end()
})

describe('copilot feedback stays on the caller’s own chats', () => {
  it('records feedback on the owner’s workspace and organization chats', async () => {
    for (const chatId of [workspaceChatId, organizationChatId]) {
      const response = await submitAs(ownerId, chatId)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ success: true, feedbackId: expect.any(String) })
      expect(await feedbackRows(chatId)).toEqual([{ userId: ownerId }])
    }
  })

  it('answers a member’s foreign chat exactly like an unknown chat and stores nothing', async () => {
    const before = await Promise.all([workspaceChatId, organizationChatId].map(feedbackRows))
    const foreign = await submitAs(outsiderId, workspaceChatId)
    const foreignOrganization = await submitAs(outsiderId, organizationChatId)
    const unknown = await submitAs(outsiderId, generateId())

    expect(foreign.status).toBe(404)
    expect(foreignOrganization.status).toBe(404)
    expect(unknown.status).toBe(404)
    const { error } = await unknown.json()
    expect(error).toBe('Chat not found')
    expect((await foreign.json()).error).toBe(error)
    expect((await foreignOrganization.json()).error).toBe(error)
    expect(await Promise.all([workspaceChatId, organizationChatId].map(feedbackRows))).toEqual(
      before
    )
  })
})
