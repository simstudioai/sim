/** Exercises chat cleanup's storage-key collection against real PostgreSQL message rows. */
import { db, dbFor } from '@sim/db'
import { copilotChats, copilotMessages, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { deletableChatFiles } from '@/lib/cleanup/chat-cleanup'
import { type ChatFileRef, collectChatFiles } from '@/lib/cleanup/chat-files'

function attachment(key: string) {
  return { id: generateId(), key, filename: 'x.png', media_type: 'image/png', size: 1 }
}

const userId = generateId()
/** One organization with chats, and one whose only chats were the deleted ones. */
const organizationIds = { withChats: generateId(), empty: generateId() }

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
  await db.insert(organization).values(
    Object.values(organizationIds).map((id) => ({
      id,
      name: 'Chat cleanup fixture',
      slug: id,
      createdAt: now,
      updatedAt: now,
    }))
  )
})

afterAll(async () => {
  await db.delete(copilotChats).where(eq(copilotChats.userId, userId))
  await db.delete(organization).where(inArray(organization.id, Object.values(organizationIds)))
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
    const shared = `copilot/${generateId()}/shared.png`
    const elsewhere = `copilot/${generateId()}/elsewhere.png`
    const own = `copilot/${generateId()}/own.png`
    await seedChat(
      [{ role: 'user', content: 'fork', fileAttachments: [attachment(shared), 'x', { key: 7 }] }],
      [],
      organizationIds.withChats
    )
    // Attached only by a chat outside the scope, which cannot be a fork of the deleted one.
    await seedChat([{ role: 'user', content: 'other', fileAttachments: [attachment(elsewhere)] }])
    const scope = { kind: 'organization', id: organizationIds.withChats } as const

    const deletable = await deletableChatFiles([
      ref(shared, scope),
      ref(elsewhere, scope),
      ref(own, scope),
    ])

    expect(deletable.map((file) => file.key).sort(compareStrings)).toEqual(
      [elsewhere, own].sort(compareStrings)
    )
  })

  it('scans no messages for a scope with no chat left', async () => {
    const scan = vi.spyOn(dbFor('cleanup'), 'execute')
    const key = `copilot/${generateId()}/gone.png`

    const deletable = await deletableChatFiles([
      ref(key, { kind: 'organization', id: organizationIds.empty }),
    ])

    expect(deletable.map((file) => file.key)).toEqual([key])
    expect(scan).not.toHaveBeenCalled()
    scan.mockRestore()
  })

  it('places a legacy ref by its key, keeping one it cannot place', async () => {
    const referenced = `assistant/${organizationIds.withChats}/${userId}/u1/kept.png`
    const unreferenced = `assistant/${organizationIds.withChats}/${userId}/u2/gone.png`
    const unplaceable = `copilot/${generateId()}/legacy.png`
    await seedChat(
      [{ role: 'user', content: 'fork', fileAttachments: [attachment(referenced)] }],
      [],
      organizationIds.withChats
    )

    const deletable = await deletableChatFiles(
      [referenced, unreferenced, unplaceable].map((key) => ref(key, undefined))
    )

    expect(deletable.map((file) => file.key)).toEqual([unreferenced])
  })
})
