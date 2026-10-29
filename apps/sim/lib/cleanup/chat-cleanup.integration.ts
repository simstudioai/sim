/** Exercises chat cleanup's storage-key collection against real PostgreSQL message rows. */
import { db, dbFor } from '@sim/db'
import { copilotChats, copilotMessages, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deletableChatFiles } from '@/lib/cleanup/chat-cleanup'
import { type ChatFileRef, collectChatFiles } from '@/lib/cleanup/chat-files'

function attachment(key: string) {
  return { id: generateId(), key, filename: 'x.png', media_type: 'image/png', size: 1 }
}

const userId = generateId()
const organizationId = generateId()

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
  await db.insert(organization).values({
    id: organizationId,
    name: 'Chat cleanup fixture',
    slug: organizationId,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await db.delete(copilotChats).where(eq(copilotChats.userId, userId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(eq(user.id, userId))
  await Promise.all([db.$client.end(), dbFor('cleanup').$client.end()])
})

async function seedChat(
  contents: unknown[],
  deletedSeqs: number[] = [],
  organizationId?: string
): Promise<string> {
  const [chat] = await db
    .insert(copilotChats)
    .values({ userId, type: 'mothership', organizationId })
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

describe('chat cleanup file collection in PostgreSQL', () => {
  it('collects attachment keys from every row, never from tool payloads or inline images', async () => {
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
            { key: 42 },
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
          scope: { kind: 'organization', id: 'org-1' },
        },
        { key: 'copilot/1234/legacy.png', context: 'copilot', chatId, scope: null },
        { key: 'copilot/5/other.png', context: 'copilot', chatId: otherChatId, scope: null },
        { key: 'copilot/9/removed.png', context: 'copilot', chatId, scope: null },
      ].sort((a, b) => compareStrings(a.key, b.key))
    )
  })
})

describe('deletable chat files against PostgreSQL message rows', () => {
  const ref = (key: string, scope: ChatFileRef['scope']): ChatFileRef => ({
    key,
    context: 'copilot',
    chatId: generateId(),
    ...(scope === undefined ? {} : { scope }),
  })

  it('keeps a key another chat of its scope still attaches, and deletes the rest', async () => {
    const shared = `assistant/${organizationId}/${userId}/u1/shared.png`
    const own = `assistant/${organizationId}/${userId}/u2/own.png`
    const elsewhere = `copilot/${generateId()}/elsewhere.png`
    const source = await seedChat(
      [{ role: 'user', content: 'look', fileAttachments: [attachment(shared), attachment(own)] }],
      [],
      organizationId
    )
    await seedChat(
      [{ role: 'user', content: 'fork', fileAttachments: [attachment(shared), 'x', { key: 7 }] }],
      [],
      organizationId
    )
    // Attached only by a chat outside the scope, which cannot be a fork of the deleted one.
    await seedChat([{ role: 'user', content: 'other', fileAttachments: [attachment(elsewhere)] }])
    const files = await collectChatFiles([source])
    await db.delete(copilotChats).where(eq(copilotChats.id, source))

    const deletable = await deletableChatFiles([
      ...files,
      ref(elsewhere, { kind: 'organization', id: organizationId }),
    ])

    expect(deletable.map((file) => file.key).sort(compareStrings)).toEqual(
      [elsewhere, own].sort(compareStrings)
    )
  })

  it('places a legacy ref by its key, keeping one it cannot place', async () => {
    const referenced = `assistant/${organizationId}/${userId}/u1/kept.png`
    const unreferenced = `assistant/${organizationId}/${userId}/u2/gone.png`
    const unplaceable = `copilot/${generateId()}/legacy.png`
    await seedChat(
      [{ role: 'user', content: 'fork', fileAttachments: [attachment(referenced)] }],
      [],
      organizationId
    )

    const deletable = await deletableChatFiles(
      [referenced, unreferenced, unplaceable].map((key) => ref(key, undefined))
    )

    expect(deletable.map((file) => file.key)).toEqual([unreferenced])
  })
})
