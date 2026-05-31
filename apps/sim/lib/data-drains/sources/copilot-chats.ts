import { db } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { and, asc, inArray, isNull, sql } from 'drizzle-orm'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorOrderBy,
  timeCursorPredicate,
} from '@/lib/data-drains/sources/cursor'
import { getOrganizationWorkspaceIds } from '@/lib/data-drains/sources/helpers'
import type { Cursor, DrainSource, SourcePageInput } from '@/lib/data-drains/types'

/**
 * The transcript no longer lives on `copilot_chats.messages` — it is assembled
 * per page from the normalized `copilot_messages` table, so `messages` is the
 * ordered list of message `content` objects rather than the DB column.
 */
type CopilotChatRow = Omit<typeof copilotChats.$inferSelect, 'messages'> & {
  messages: unknown[]
}

/** Chat metadata columns, excluding the legacy `messages` JSONB. */
const chatColumns = {
  id: copilotChats.id,
  userId: copilotChats.userId,
  workflowId: copilotChats.workflowId,
  workspaceId: copilotChats.workspaceId,
  type: copilotChats.type,
  title: copilotChats.title,
  model: copilotChats.model,
  conversationId: copilotChats.conversationId,
  previewYaml: copilotChats.previewYaml,
  planArtifact: copilotChats.planArtifact,
  config: copilotChats.config,
  resources: copilotChats.resources,
  lastSeenAt: copilotChats.lastSeenAt,
  pinned: copilotChats.pinned,
  createdAt: copilotChats.createdAt,
  updatedAt: copilotChats.updatedAt,
} as const

/**
 * Cursor is `createdAt` (immutable) but rows themselves are mutable —
 * `messages`, `title`, `lastSeenAt`, etc. are updated in-place over the chat's
 * lifetime. This means a chat exported once will not be re-exported when its
 * messages change. Consumers who need the latest state should periodically
 * full-refresh from a separate snapshot job; drains are append-mostly by
 * design and `data-drains` is not a CDC pipeline.
 */
async function* pages(input: SourcePageInput): AsyncIterable<CopilotChatRow[]> {
  const workspaceIds = await getOrganizationWorkspaceIds(input.organizationId)
  if (workspaceIds.length === 0) return

  let cursor = decodeTimeCursor(input.cursor)
  while (!input.signal.aborted) {
    const cursorClause = timeCursorPredicate(copilotChats.createdAt, copilotChats.id, cursor)

    const metaRows = await db
      .select(chatColumns)
      .from(copilotChats)
      .where(and(inArray(copilotChats.workspaceId, workspaceIds), cursorClause))
      .orderBy(...timeCursorOrderBy(copilotChats.createdAt, copilotChats.id))
      .limit(input.chunkSize)

    if (metaRows.length === 0) return

    const chatIds = metaRows.map((r) => r.id)
    const messageRows = await db
      .select({ chatId: copilotMessages.chatId, content: copilotMessages.content })
      .from(copilotMessages)
      .where(and(inArray(copilotMessages.chatId, chatIds), isNull(copilotMessages.deletedAt)))
      .orderBy(
        asc(copilotMessages.chatId),
        sql`${copilotMessages.seq} asc nulls last`,
        asc(copilotMessages.createdAt),
        asc(copilotMessages.id)
      )
    const messagesByChat = new Map<string, unknown[]>()
    for (const m of messageRows) {
      const existing = messagesByChat.get(m.chatId)
      if (existing) existing.push(m.content)
      else messagesByChat.set(m.chatId, [m.content])
    }

    const rows: CopilotChatRow[] = metaRows.map((r) => ({
      ...r,
      messages: messagesByChat.get(r.id) ?? [],
    }))

    yield rows
    const last = metaRows[metaRows.length - 1]
    cursor = { ts: last.createdAt.toISOString(), id: last.id }
    if (metaRows.length < input.chunkSize) return
  }
}

export const copilotChatsSource: DrainSource<CopilotChatRow> = {
  type: 'copilot_chats',
  displayName: 'Copilot chats',
  pages,
  serialize(row) {
    return {
      id: row.id,
      userId: row.userId,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
      type: row.type,
      title: row.title,
      messages: row.messages,
      model: row.model,
      conversationId: row.conversationId,
      previewYaml: row.previewYaml,
      planArtifact: row.planArtifact,
      config: row.config,
      resources: row.resources,
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  },
  cursorAfter(row): Cursor {
    return encodeTimeCursor({ ts: row.createdAt.toISOString(), id: row.id })
  },
}
