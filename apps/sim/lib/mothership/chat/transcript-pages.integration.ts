/** Exercises transcript windows and the stored UI projection against real PostgreSQL. */
import { db } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  permissions,
  user,
  workflow,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readChatOlderMessages } from '@/lib/mothership/chat/application/read-older-messages'
import {
  getAccessibleCopilotChatWithMessages,
  loadCopilotChatMessages,
  loadCopilotChatMessagesBefore,
  TRANSCRIPT_PAGE_SIZE,
} from '@/lib/mothership/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  buildPersistedUserMessage,
  compactToolCallParams,
  normalizeMessage,
  type PersistedMessage,
} from '@/lib/mothership/chat/persisted-message'
import { decodeTranscriptCursor } from '@/lib/mothership/chat/transcript-cursor'

const BULK_PARAM = 'p'.repeat(200_000)
const BULK_OUTPUT = 'o'.repeat(200_000)

const ownerId = generateId()
const outsiderId = generateId()
const workspaceId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const outsider = createSessionPrincipal({ userId: outsiderId, sessionId: generateId() })

function userTurn(content: string): PersistedMessage {
  return buildPersistedUserMessage({ id: generateId(), content })
}

function assistantTurn(content: string, withTools = false): PersistedMessage {
  return {
    id: generateId(),
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    ...(withTools
      ? {
          contentBlocks: [
            {
              type: 'tool',
              phase: 'call',
              toolCall: {
                id: generateId(),
                name: 'run_code',
                state: 'success',
                params: { code: BULK_PARAM, path: 'short' },
                result: { success: true, output: { stdout: BULK_OUTPUT } },
              },
            },
            {
              type: 'tool',
              phase: 'call',
              toolCall: {
                id: generateId(),
                name: 'workspace_file',
                state: 'executing',
                params: { lines: ['short', BULK_PARAM] },
              },
            },
            { type: 'text', channel: 'assistant', content },
          ],
        }
      : {}),
  } as PersistedMessage
}

/** What the chat UI received before the stored projection: the full row through its pipeline. */
function previousUiProjection(messages: PersistedMessage[]): PersistedMessage[] {
  return messages.map((message) => compactToolCallParams(normalizeMessage({ ...message })))
}

function uiProjection(messages: unknown[]): PersistedMessage[] {
  return messages.map((message) =>
    compactToolCallParams(normalizeMessage(message as Record<string, unknown>))
  )
}

function ids(messages: unknown[]): string[] {
  return messages.map((message) => (message as PersistedMessage).id)
}

function latestWindow(chatId: string) {
  return getAccessibleCopilotChatWithMessages(chatId, ownerId, {
    window: { kind: 'latest' },
  })
}

/** Every page of a chat, oldest first, by walking `before` cursors back from the latest window. */
async function readTranscriptPages(chatId: string): Promise<PersistedMessage[][]> {
  const latest = await latestWindow(chatId)
  if (!latest) throw new Error('chat not readable')
  const pages: PersistedMessage[][] = [latest.messages as PersistedMessage[]]
  let cursor = latest.olderCursor
  while (cursor) {
    const position = decodeTranscriptCursor(cursor)
    if (!position) throw new Error('undecodable cursor')
    const page = await loadCopilotChatMessagesBefore(chatId, position)
    pages.unshift(page.messages)
    cursor = page.olderCursor
  }
  return pages
}

async function createChat(type: 'mothership' | 'copilot' = 'mothership'): Promise<string> {
  const [chat] = await db
    .insert(copilotChats)
    .values({ userId: ownerId, workspaceId, type })
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
    name: `Transcript pages workflow ${workflowId}`,
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

async function appendTurns(chatId: string, turns: number, firstTurn = 0): Promise<void> {
  const messages: PersistedMessage[] = []
  for (let turn = firstTurn; turn < firstTurn + turns; turn++) {
    messages.push(userTurn(`question ${turn}`), assistantTurn(`answer ${turn}`))
  }
  await appendCopilotChatMessages(chatId, messages)
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ownerId, outsiderId].map((id) => ({
      id,
      name: 'Transcript pages fixture',
      email: `${id}@transcript-pages.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Transcript pages fixture',
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

/** `db:push` never installs the migration-only trigger that clears a stale projection. */
const [{ migrated }] = await db.execute<{ migrated: boolean }>(sql`SELECT EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid = 'copilot_messages'::regclass
    AND tgname = 'copilot_messages_clear_stale_display_content'
) AS migrated`)

describe('chat transcript pages in PostgreSQL', () => {
  it('serves the UI the same messages as before while storing the bulk params only in content', async () => {
    const chatId = await createChat()
    const turn = [userTurn('run it'), assistantTurn('done', true)]
    await appendCopilotChatMessages(chatId, turn)

    const [stored] = await db
      .select({ display: copilotMessages.displayContent })
      .from(copilotMessages)
      .where(eq(copilotMessages.messageId, turn[1].id))
    expect(JSON.stringify(stored.display)).not.toContain(BULK_PARAM)

    const full = await loadCopilotChatMessages(chatId)
    expect(JSON.stringify(full)).toContain(BULK_PARAM)
    const whole = await getAccessibleCopilotChatWithMessages(chatId, ownerId)
    const latest = await latestWindow(chatId)
    expect(JSON.stringify(whole?.messages)).not.toContain(BULK_PARAM)
    expect(JSON.stringify(latest?.messages)).not.toContain(BULK_PARAM)
    expect(uiProjection(whole?.messages ?? [])).toEqual(previousUiProjection(full))
    expect(uiProjection(latest?.messages ?? [])).toEqual(previousUiProjection(full))
  })

  it('serves a rewritten message from its new content, not its earlier projection', async () => {
    const chatId = await createChat()
    const reply = assistantTurn('first draft', true)
    await appendCopilotChatMessages(chatId, [userTurn('run it'), reply])
    await appendCopilotChatMessages(chatId, [{ ...assistantTurn('final', true), id: reply.id }])

    const [stored] = await db
      .select({ display: copilotMessages.displayContent })
      .from(copilotMessages)
      .where(eq(copilotMessages.messageId, reply.id))
    expect(stored.display).not.toBeNull()
    expect(JSON.stringify(stored.display)).toContain('final')
    const latest = await latestWindow(chatId)
    expect(uiProjection(latest?.messages ?? [])).toEqual(
      previousUiProjection(await loadCopilotChatMessages(chatId))
    )
  })

  it.skipIf(!migrated)(
    'drops the projection when a writer that predates it replaces the content',
    async () => {
      const chatId = await createChat()
      const reply = assistantTurn('first draft', true)
      await appendCopilotChatMessages(chatId, [userTurn('run it'), reply])
      await db
        .update(copilotMessages)
        .set({ content: { ...reply, content: 'final', contentBlocks: [] } })
        .where(eq(copilotMessages.messageId, reply.id))

      const [stored] = await db
        .select({ display: copilotMessages.displayContent })
        .from(copilotMessages)
        .where(eq(copilotMessages.messageId, reply.id))
      expect(stored.display).toBeNull()
      const latest = await latestWindow(chatId)
      expect(uiProjection(latest?.messages ?? [])).toEqual(
        previousUiProjection(await loadCopilotChatMessages(chatId))
      )
    }
  )

  it('reads the full content of a message whose projection was never stored', async () => {
    const chatId = await createChat()
    await appendCopilotChatMessages(chatId, [userTurn('run it'), assistantTurn('done', true)])
    await db
      .update(copilotMessages)
      .set({ displayContent: null })
      .where(eq(copilotMessages.chatId, chatId))

    const latest = await latestWindow(chatId)
    expect(uiProjection(latest?.messages ?? [])).toEqual(
      previousUiProjection(await loadCopilotChatMessages(chatId))
    )
  })

  it('pages a long chat back to its first message exactly once, each page starting a turn', async () => {
    const chatId = await createChat()
    // Three messages a turn, so the newest window's first row is an assistant reply and the
    // window is cut forward to the next question.
    const messages: PersistedMessage[] = []
    for (let turn = 0; turn < 150; turn++) {
      messages.push(
        userTurn(`question ${turn}`),
        assistantTurn(`answer ${turn}`),
        assistantTurn(`follow-up ${turn}`)
      )
    }
    await appendCopilotChatMessages(chatId, messages)
    await db
      .update(copilotMessages)
      .set({ deletedAt: new Date() })
      .where(inArray(copilotMessages.messageId, [messages[1].id, messages[300].id]))

    const pages = await readTranscriptPages(chatId)
    expect(pages.length).toBeGreaterThanOrEqual(3)
    expect(pages[pages.length - 1].length).toBeLessThan(TRANSCRIPT_PAGE_SIZE)
    for (const page of pages) expect(page[0].role).toBe('user')
    expect(ids(pages.flat())).toEqual(ids(await loadCopilotChatMessages(chatId)))
  })

  it('returns the whole chat in the latest window when it exactly fits, with no older cursor', async () => {
    const chatId = await createChat()
    await appendTurns(chatId, TRANSCRIPT_PAGE_SIZE / 2)

    const latest = await latestWindow(chatId)
    expect(latest?.messages).toHaveLength(TRANSCRIPT_PAGE_SIZE)
    expect(latest?.olderCursor).toBeNull()
  })

  it('extends a window from its first message with every newer message', async () => {
    const chatId = await createChat()
    await appendTurns(chatId, 40)
    const latest = await latestWindow(chatId)
    const anchor = decodeTranscriptCursor(latest?.windowStartCursor ?? '')
    if (!anchor) throw new Error('latest window has no start')

    await appendTurns(chatId, 30, 40)
    const extended = await getAccessibleCopilotChatWithMessages(chatId, ownerId, {
      window: { kind: 'from', position: anchor },
    })
    const all = ids(await loadCopilotChatMessages(chatId))
    expect(ids(extended?.messages ?? [])).toEqual(
      all.slice(all.indexOf(ids(latest?.messages ?? [])[0]))
    )
    expect(extended?.windowStartCursor).toBe(latest?.windowStartCursor)
    expect(extended?.olderCursor).toBe(latest?.olderCursor)
  })

  it('orders unsequenced messages after sequenced ones and pages and extends them exactly once', async () => {
    const chatId = await createChat()
    await appendTurns(chatId, 30)
    const legacy = Array.from({ length: 2 * TRANSCRIPT_PAGE_SIZE + 20 }, (_, index) =>
      index % 2 === 0 ? userTurn(`legacy ${index}`) : assistantTurn(`legacy reply ${index}`)
    )
    // One statement's now() gives every row the same microsecond timestamp, older than the
    // sequenced rows, so only the id tie-break orders them.
    await db.insert(copilotMessages).values(
      legacy.map((message) => ({
        chatId,
        messageId: message.id,
        role: message.role,
        content: message,
        seq: null,
        createdAt: sql`now() - interval '1 day'`,
        updatedAt: sql`now()`,
      }))
    )
    const all = ids(await loadCopilotChatMessages(chatId))
    expect([...all.slice(-legacy.length)].sort()).toEqual(ids(legacy).sort())

    expect(ids((await readTranscriptPages(chatId)).flat())).toEqual(all)

    const latest = await latestWindow(chatId)
    const anchor = decodeTranscriptCursor(latest?.windowStartCursor ?? '')
    if (!anchor) throw new Error('latest window has no start')
    expect(anchor.seq).toBeNull()
    const extended = await getAccessibleCopilotChatWithMessages(chatId, ownerId, {
      window: { kind: 'from', position: anchor },
    })
    expect(ids(extended?.messages ?? [])).toEqual(
      all.slice(all.indexOf(ids(latest?.messages ?? [])[0]))
    )
  })

  it("serves older pages only to the chat's owner and only for issued cursors", async () => {
    const chatId = await createChat()
    await appendTurns(chatId, 40)
    const before = (await latestWindow(chatId))?.olderCursor
    if (!before) throw new Error('latest window reaches the first message')

    const page = await readChatOlderMessages.execute({
      principal: owner,
      input: { chatId, before },
    })
    expect(page.messages.length).toBeGreaterThan(0)

    await expect(
      readChatOlderMessages.execute({ principal: outsider, input: { chatId, before } })
    ).rejects.toThrow('Chat not found')
    await expect(
      readChatOlderMessages.execute({ principal: owner, input: { chatId, before: 'tampered' } })
    ).rejects.toThrow('Invalid cursor')
  })

  it('serves older pages of a workflow copilot chat while its owner may read the workflow', async () => {
    const chatId = await createWorkflowChat()
    const legacyChatId = await createWorkflowChat({ legacyRow: true })
    const archivedChatId = await createWorkflowChat({ archivedWorkflow: true })
    for (const id of [chatId, legacyChatId, archivedChatId]) await appendTurns(id, 40)

    for (const id of [chatId, legacyChatId]) {
      const cursor = (await latestWindow(id))?.olderCursor
      if (!cursor) throw new Error('latest window reaches the first message')
      const page = await readChatOlderMessages.execute({
        principal: owner,
        input: { chatId: id, before: cursor },
      })
      expect(page.messages.length).toBeGreaterThan(0)
    }

    const before = (await latestWindow(chatId))?.olderCursor
    if (!before) throw new Error('latest window reaches the first message')
    await expect(
      readChatOlderMessages.execute({ principal: outsider, input: { chatId, before } })
    ).rejects.toThrow('Chat not found')
    await expect(
      readChatOlderMessages.execute({ principal: owner, input: { chatId: archivedChatId, before } })
    ).rejects.toThrow('Chat not found')
  })
})
