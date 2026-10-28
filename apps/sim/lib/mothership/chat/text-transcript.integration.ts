/** Exercises the text-only transcript read against real PostgreSQL rows, multi-MB tool payloads included. */
import { db } from '@sim/db'
import { copilotChats, copilotMessages, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  getAccessibleCopilotChatWithMessages,
  getAccessibleCopilotChatWithTextMessages,
} from '@/lib/mothership/chat/lifecycle'
import { quoteChatTranscript } from '@/lib/mothership/chat/text-transcript'

const MULTI_MB_PARAMS = 'x'.repeat(3 * 1024 * 1024)

function toolBlock(id: string) {
  return {
    type: 'tool',
    toolCall: { id, name: 'edit_workflow', state: 'success', params: { code: MULTI_MB_PARAMS } },
  }
}

describe('text-only chat transcript in PostgreSQL', () => {
  const userId = generateId()

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Text transcript fixture',
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

  async function seedChat(contents: unknown[]): Promise<string> {
    const [chat] = await db
      .insert(copilotChats)
      .values({ userId, type: 'mothership' })
      .returning({ id: copilotChats.id })
    await db.insert(copilotMessages).values(
      contents.map((content, seq) => ({
        chatId: chat.id,
        messageId: generateId(),
        role: 'user',
        seq,
        content,
      }))
    )
    return chat.id
  }

  it('quotes the same transcript as the full read without loading tool payloads', async () => {
    const chatId = await seedChat([
      { id: 'm1', role: 'user', content: 'Build me a workflow', timestamp: '2026-01-01T00:00:00Z' },
      {
        id: 'm2',
        role: 'assistant',
        content: 'fallback text',
        requestId: 'req-1',
        contentBlocks: [
          { type: 'text', content: 'Working on it. ' },
          toolBlock('tool-1'),
          { type: 'text', content: 'Done.' },
          'not a block',
          { type: true, content: 'not text' },
        ],
      },
      { role: 'assistant', content: 'only tools ran', contentBlocks: [toolBlock('tool-2')] },
      { content: 'no role' },
      { role: 'assistant', contentBlocks: [{ type: 'text', content: '   ' }] },
      'a bare string message',
      [1, 2],
    ])

    const full = await getAccessibleCopilotChatWithMessages(chatId, userId)
    const text = await getAccessibleCopilotChatWithTextMessages(chatId, userId)

    expect(full).not.toBeNull()
    expect(text).not.toBeNull()
    expect(quoteChatTranscript(text?.messages ?? [])).toBe(
      quoteChatTranscript(full?.messages ?? [])
    )
    expect(quoteChatTranscript(text?.messages ?? [])).toBe(
      [
        'user: Build me a workflow',
        'assistant: Working on it. Done.',
        'assistant: only tools ran',
        'user: no role',
        'assistant:',
        'user:',
        'user:',
      ].join('\n')
    )
    expect(JSON.stringify(text?.messages).length).toBeLessThan(10_000)
  })

  it('quotes a message whose contentBlocks is not an array by its content', async () => {
    const chatId = await seedChat([
      { role: 'assistant', content: 'blocks not an array', contentBlocks: 'oops' },
    ])

    const text = await getAccessibleCopilotChatWithTextMessages(chatId, userId)
    expect(quoteChatTranscript(text?.messages ?? [])).toBe('assistant: blocks not an array')
  })

  it('skips deleted messages and refuses a chat the caller does not own', async () => {
    const chatId = await seedChat([
      { role: 'user', content: 'kept' },
      { role: 'user', content: 'deleted' },
    ])
    await db
      .update(copilotMessages)
      .set({ deletedAt: new Date() })
      .where(and(eq(copilotMessages.chatId, chatId), eq(copilotMessages.seq, 1)))

    const text = await getAccessibleCopilotChatWithTextMessages(chatId, userId)
    expect(quoteChatTranscript(text?.messages ?? [])).toBe('user: kept')
    expect(await getAccessibleCopilotChatWithTextMessages(chatId, generateId())).toBeNull()
  })
})
