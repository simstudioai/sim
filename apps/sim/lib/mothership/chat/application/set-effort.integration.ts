/** Exercises a chat's explicit effort choice against real PostgreSQL rows. */
import { db } from '@sim/db'
import { copilotChats, permissions, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setChatEffort } from '@/lib/mothership/chat/application/set-effort'
import { getAccessibleCopilotChatWithMessages } from '@/lib/mothership/chat/lifecycle'
import { resolveMothershipModelSettings } from '@/lib/mothership/model-options'

const ownerId = generateId()
const outsiderId = generateId()
const workspaceId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const outsider = createSessionPrincipal({ userId: outsiderId, sessionId: generateId() })

async function createChat(config: Record<string, unknown> | null): Promise<string> {
  const [chat] = await db
    .insert(copilotChats)
    .values({ userId: ownerId, workspaceId, type: 'mothership', config })
    .returning({ id: copilotChats.id })
  return chat.id
}

async function loadEffort(chatId: string) {
  const chat = await getAccessibleCopilotChatWithMessages(chatId, ownerId)
  return chat?.effort
}

/** What the next turn of this chat runs at when the send names no effort. */
async function nextTurnEffort(chatId: string) {
  return resolveMothershipModelSettings({ effort: (await loadEffort(chatId)) ?? undefined }, false)
    .effort
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ownerId, outsiderId].map((id) => ({
      id,
      name: 'Chat effort fixture',
      email: `${id}@chat-effort.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Chat effort fixture',
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
})

afterAll(async () => {
  await db.delete(copilotChats).where(eq(copilotChats.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(inArray(user.id, [ownerId, outsiderId]))
  await db.$client.end()
})

describe('a chat keeps the effort its owner picked', () => {
  it('runs a chat with no pick at the default and a picked chat at its pick', async () => {
    const untouched = await createChat(null)
    const picked = await createChat({ conversationMode: 'plan' })

    await setChatEffort.execute({ principal: owner, input: { chatId: picked, effort: 'low' } })

    expect(await loadEffort(untouched)).toBeNull()
    expect(await nextTurnEffort(untouched)).toBe('medium')
    expect(await nextTurnEffort(picked)).toBe('low')
    const [row] = await db
      .select({ config: copilotChats.config })
      .from(copilotChats)
      .where(eq(copilotChats.id, picked))
    expect(row.config).toEqual({ conversationMode: 'plan', effort: 'low' })
  })

  it('replaces an earlier pick with the latest one', async () => {
    const chatId = await createChat({ effort: 'xhigh' })
    await setChatEffort.execute({ principal: owner, input: { chatId, effort: 'high' } })
    expect(await loadEffort(chatId)).toBe('high')
  })

  it('reads a stored value outside the effort range as no pick', async () => {
    const chatId = await createChat({ effort: 'turbo' })
    expect(await loadEffort(chatId)).toBeNull()
    expect(await nextTurnEffort(chatId)).toBe('medium')
  })

  it("refuses to change another user's chat in a shared workspace", async () => {
    const chatId = await createChat(null)
    await expect(
      setChatEffort.execute({ principal: outsider, input: { chatId, effort: 'max' } })
    ).rejects.toThrow('Chat not found')
    expect(await loadEffort(chatId)).toBeNull()
  })
})
