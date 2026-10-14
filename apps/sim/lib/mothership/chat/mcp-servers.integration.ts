/** Exercises MCP server inheritance against real PostgreSQL transcripts written by the append path. */
import { db } from '@sim/db'
import { copilotChats, copilotMessages, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadChatMcpServerIds, loadCopilotChatMessages } from '@/lib/mothership/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  buildPersistedUserMessage,
  type PersistedMessage,
} from '@/lib/mothership/chat/persisted-message'

/** The transcript-based collection this query replaced, kept as the equivalence oracle. */
function collectFromTranscript(messages: PersistedMessage[]): string[] {
  const serverIds = new Set<string>()
  for (const message of messages) {
    if (!Array.isArray(message.contexts)) continue
    for (const ctx of message.contexts) {
      if (ctx.kind === 'mcp' && typeof ctx.serverId === 'string' && ctx.serverId) {
        serverIds.add(ctx.serverId)
      }
    }
  }
  return Array.from(serverIds)
}

function userTurn(contexts: PersistedMessage['contexts'], content = 'turn'): PersistedMessage {
  return buildPersistedUserMessage({ id: generateId(), content, contexts })
}

function assistantTurn(): PersistedMessage {
  return {
    id: generateId(),
    role: 'assistant',
    content: 'reply',
    timestamp: new Date().toISOString(),
  }
}

describe('chat MCP server inheritance in PostgreSQL', () => {
  const userId = generateId()

  async function createChat(): Promise<string> {
    const [chat] = await db
      .insert(copilotChats)
      .values({ userId, type: 'mothership' })
      .returning({ id: copilotChats.id })
    return chat.id
  }

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'MCP inheritance fixture',
      email: `${userId}@fixture.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.userId, userId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('keeps servers tagged on earlier turns, in first-tagged order, matching the transcript', async () => {
    const chatId = await createChat()
    await appendCopilotChatMessages(chatId, [
      userTurn([
        { kind: 'mcp', serverId: 'server-b', label: 'B' },
        { kind: 'workflow', workflowId: 'wf-1', label: 'Workflow' },
        { kind: 'mcp', serverId: 'server-c', label: 'C' },
      ]),
      assistantTurn(),
      userTurn(undefined),
      userTurn([
        { kind: 'mcp', serverId: 'server-a', label: 'A' },
        { kind: 'mcp', serverId: 'server-b', label: 'B again' },
      ]),
      assistantTurn(),
    ])

    const serverIds = await loadChatMcpServerIds(chatId)

    expect(serverIds).toEqual(['server-b', 'server-c', 'server-a'])
    expect(serverIds).toEqual(collectFromTranscript(await loadCopilotChatMessages(chatId)))
  })

  it('orders by transcript position, not by row insertion order', async () => {
    const chatId = await createChat()
    await db.insert(copilotMessages).values(
      [
        { seq: 1, serverId: 'server-second' },
        { seq: 0, serverId: 'server-first' },
      ].map(({ seq, serverId }) => ({
        chatId,
        messageId: generateId(),
        role: 'user',
        seq,
        content: { role: 'user', content: 'x', contexts: [{ kind: 'mcp', serverId }] },
      }))
    )

    expect(await loadChatMcpServerIds(chatId)).toEqual(['server-first', 'server-second'])
  })

  it('ignores malformed contexts instead of failing the turn', async () => {
    const chatId = await createChat()
    await db.insert(copilotMessages).values([
      {
        chatId,
        messageId: generateId(),
        role: 'user',
        seq: 0,
        content: { role: 'user', content: 'x', contexts: { kind: 'mcp', serverId: 'object' } },
      },
      {
        chatId,
        messageId: generateId(),
        role: 'user',
        seq: 1,
        content: {
          role: 'user',
          content: 'y',
          contexts: [
            'mcp',
            { kind: 'mcp', serverId: '' },
            { kind: 'mcp', serverId: 7 },
            { kind: 'mcp', serverId: 'server-ok' },
          ],
        },
      },
    ])

    expect(await loadChatMcpServerIds(chatId)).toEqual(['server-ok'])
  })

  it('does not inherit servers from a deleted message', async () => {
    const chatId = await createChat()
    const deleted = userTurn([{ kind: 'mcp', serverId: 'server-deleted', label: 'Gone' }])
    await appendCopilotChatMessages(chatId, [
      deleted,
      userTurn([{ kind: 'mcp', serverId: 'server-kept', label: 'Kept' }]),
    ])
    await db
      .update(copilotMessages)
      .set({ deletedAt: new Date() })
      .where(and(eq(copilotMessages.chatId, chatId), eq(copilotMessages.messageId, deleted.id)))

    expect(await loadChatMcpServerIds(chatId)).toEqual(['server-kept'])
  })

  it('never reads servers tagged in another chat', async () => {
    const chatId = await createChat()
    const otherChatId = await createChat()
    await appendCopilotChatMessages(otherChatId, [
      userTurn([{ kind: 'mcp', serverId: 'server-other', label: 'Other' }]),
    ])

    expect(await loadChatMcpServerIds(chatId)).toEqual([])
  })
})
