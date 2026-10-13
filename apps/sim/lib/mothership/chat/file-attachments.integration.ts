/** Exercises the targeted attachment read against real PostgreSQL transcripts. */
import { db } from '@sim/db'
import { copilotChats, copilotMessages, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  loadChatFileAttachmentsNamed,
  loadCopilotChatMessages,
} from '@/lib/mothership/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  buildPersistedUserMessage,
  type PersistedFileAttachment,
  type PersistedMessage,
} from '@/lib/mothership/chat/persisted-message'

/** The whole-transcript scan this query replaced, kept as the equivalence oracle. */
function collectFromTranscript(
  messages: PersistedMessage[],
  name: string
): PersistedFileAttachment[] {
  return messages.flatMap((message) =>
    (message.fileAttachments ?? []).filter((file) => file.id === name || file.filename === name)
  )
}

function attachment(id: string, filename: string): PersistedFileAttachment {
  return { id, key: `assistant/${id}/${filename}`, filename, media_type: 'text/csv', size: 1 }
}

function userTurn(fileAttachments?: PersistedFileAttachment[]): PersistedMessage {
  return buildPersistedUserMessage({ id: generateId(), content: 'turn', fileAttachments })
}

describe('chat file attachment lookup in PostgreSQL', () => {
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
      name: 'Attachment lookup fixture',
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

  it('returns id and filename matches in transcript order, matching the transcript scan', async () => {
    const chatId = await createChat()
    const first = attachment('upload-a', 'report.csv')
    const second = attachment('upload-b', 'report.csv')
    await appendCopilotChatMessages(chatId, [
      userTurn([first, attachment('upload-c', 'other.csv')]),
      userTurn(),
      userTurn([second, first]),
    ])
    const transcript = await loadCopilotChatMessages(chatId)

    for (const name of ['report.csv', 'upload-a', 'upload-c', 'missing.csv']) {
      expect(await loadChatFileAttachmentsNamed(chatId, name)).toEqual(
        collectFromTranscript(transcript, name)
      )
    }
    expect(await loadChatFileAttachmentsNamed(chatId, 'report.csv')).toEqual([first, second, first])
  })

  it('ignores malformed attachments and non-string ids that spell the name', async () => {
    const chatId = await createChat()
    await db.insert(copilotMessages).values([
      {
        chatId,
        messageId: generateId(),
        role: 'user',
        seq: 0,
        content: { role: 'user', content: 'x', fileAttachments: { id: '7', filename: '7' } },
      },
      {
        chatId,
        messageId: generateId(),
        role: 'user',
        seq: 1,
        content: {
          role: 'user',
          content: 'y',
          fileAttachments: ['7', null, { id: 7, filename: 'seven.csv' }, attachment('7', 'ok.csv')],
        },
      },
    ])

    expect(await loadChatFileAttachmentsNamed(chatId, '7')).toEqual([attachment('7', 'ok.csv')])
  })

  it('skips deleted messages and other chats', async () => {
    const chatId = await createChat()
    const otherChatId = await createChat()
    const deleted = userTurn([attachment('upload-deleted', 'gone.csv')])
    await appendCopilotChatMessages(chatId, [deleted])
    await appendCopilotChatMessages(otherChatId, [userTurn([attachment('upload-x', 'gone.csv')])])
    await db
      .update(copilotMessages)
      .set({ deletedAt: new Date() })
      .where(and(eq(copilotMessages.chatId, chatId), eq(copilotMessages.messageId, deleted.id)))

    expect(await loadChatFileAttachmentsNamed(chatId, 'gone.csv')).toEqual([])
  })
})
