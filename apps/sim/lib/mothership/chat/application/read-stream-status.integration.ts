/** Exercises the transcript-free stream status read against real PostgreSQL rows. */
import { db } from '@sim/db'
import { copilotChats, permissions, user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readChatStreamStatus } from '@/lib/mothership/chat/application/read-stream-status'

const ownerId = generateId()
const memberId = generateId()
const workspaceId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const member = createSessionPrincipal({ userId: memberId, sessionId: generateId() })

async function createChat(): Promise<string> {
  const [chat] = await db
    .insert(copilotChats)
    .values({ userId: ownerId, workspaceId, type: 'mothership' })
    .returning({ id: copilotChats.id })
  return chat.id
}

/**
 * A workflow Copilot panel chat, as the panel stores it. A legacy row, from before chats carried
 * a workspace, has only its workflow's.
 */
async function createWorkflowChat(
  options: { archivedWorkflow?: boolean; legacyRow?: boolean } = {}
): Promise<string> {
  const workflowId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Chat stream status workflow ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
    archivedAt: options.archivedWorkflow ? now : null,
  })
  const [chat] = await db
    .insert(copilotChats)
    .values({
      userId: ownerId,
      workflowId,
      workspaceId: options.legacyRow ? null : workspaceId,
      type: 'copilot',
    })
    .returning({ id: copilotChats.id })
  return chat.id
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ownerId, memberId].map((id) => ({
      id,
      name: 'Chat stream status fixture',
      email: `${id}@chat-stream-status.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Chat stream status fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values(
    [ownerId, memberId].map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace' as const,
      entityId: workspaceId,
      permissionType: 'admin' as const,
    }))
  )
})

afterAll(async () => {
  await db.delete(copilotChats).where(eq(copilotChats.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(inArray(user.id, [ownerId, memberId]))
  await db.$client.end()
})

describe('reading whether a chat is still streaming', () => {
  it('answers the owner of an idle chat with no active stream', async () => {
    const chatId = await createChat()
    await expect(
      readChatStreamStatus.execute({ principal: owner, input: { chatId } })
    ).resolves.toEqual({ activeStreamId: null })
  })

  it('refuses another member of the workspace, as the chat detail read does', async () => {
    const chatId = await createChat()
    await expect(
      readChatStreamStatus.execute({ principal: member, input: { chatId } })
    ).rejects.toThrow('Chat not found')
  })

  it('answers the owner of a workflow copilot chat, including a legacy row without a workspace', async () => {
    for (const chatId of [
      await createWorkflowChat(),
      await createWorkflowChat({ legacyRow: true }),
    ])
      await expect(
        readChatStreamStatus.execute({ principal: owner, input: { chatId } })
      ).resolves.toEqual({ activeStreamId: null })
  })

  it('refuses a workflow copilot chat whose workflow is archived, as the chat detail read does', async () => {
    const chatId = await createWorkflowChat({ archivedWorkflow: true })
    await expect(
      readChatStreamStatus.execute({ principal: owner, input: { chatId } })
    ).rejects.toThrow('Chat not found')
  })
})
