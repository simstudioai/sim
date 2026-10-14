/** Exercises chat cleanup's storage-key collection against real PostgreSQL message rows. */
import { db, dbFor } from '@sim/db'
import { copilotChats, copilotMessages, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collectChatFiles } from '@/lib/cleanup/chat-cleanup'
import { inlineChatImageKey } from '@/lib/mothership/chat/inline-image-key'

function attachment(key: string) {
  return { id: generateId(), key, filename: 'x.png', media_type: 'image/png', size: 1 }
}

describe('chat cleanup file collection in PostgreSQL', () => {
  const userId = generateId()

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Chat cleanup fixture',
      email: `${userId}@fixture.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.userId, userId))
    await db.delete(user).where(eq(user.id, userId))
    await Promise.all([db.$client.end(), dbFor('cleanup').$client.end()])
  })

  async function seedChat(contents: unknown[], deletedSeqs: number[] = []): Promise<string> {
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
        ...(deletedSeqs.includes(seq) ? { deletedAt: new Date() } : {}),
      }))
    )
    return chat.id
  }

  it('collects attachment and inline image keys from every row, never from tool payloads', async () => {
    const chatId = await seedChat(
      [
        {
          role: 'user',
          content: 'look',
          fileAttachments: [
            attachment('copilot/1234/legacy.png'),
            attachment('assistant/org-1/user-1/u1/shared.png'),
            attachment('workspace/ws-1/1700-abc-shared.png'),
            'not an attachment',
            null,
            { key: '' },
          ],
        },
        {
          role: 'assistant',
          requestId: 'req-1',
          content: 'Here: ![chart](files/chart.png)',
          contentBlocks: [
            { type: 'text', content: '![other](/tmp/out.png)' },
            {
              type: 'tool',
              toolCall: {
                id: 'tool-1',
                name: 'edit_workflow',
                state: 'success',
                params: {
                  code: `![tool](files/tool.png)${'x'.repeat(3 * 1024 * 1024)}`,
                  fileAttachments: [attachment('copilot/1234/in-params.png')],
                },
              },
            },
          ],
        },
        {
          role: 'user',
          content: 'removed',
          fileAttachments: [attachment('copilot/9/removed.png')],
        },
        { role: 'assistant', content: '![x](files/x.png)', contentBlocks: 'not an array' },
        'a bare string message',
      ],
      [2]
    )
    const otherChatId = await seedChat([
      { role: 'user', content: 'other', fileAttachments: [attachment('copilot/5/other.png')] },
    ])

    const files = await collectChatFiles([chatId, otherChatId])

    expect([...files].sort((a, b) => compareStrings(a.key, b.key))).toEqual(
      [
        {
          key: 'assistant/org-1/user-1/u1/shared.png',
          context: 'mothership',
          chatId,
          organizationId: 'org-1',
        },
        {
          key: inlineChatImageKey(chatId, 'req-1', 'files/chart.png'),
          context: 'mothership',
          chatId,
        },
        { key: inlineChatImageKey(chatId, 'req-1', '/tmp/out.png'), context: 'mothership', chatId },
        { key: 'copilot/1234/legacy.png', context: 'copilot', chatId },
        { key: 'copilot/5/other.png', context: 'copilot', chatId: otherChatId },
        { key: 'copilot/9/removed.png', context: 'copilot', chatId },
      ].sort((a, b) => compareStrings(a.key, b.key))
    )
  })
})
