import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, inArray } from 'drizzle-orm'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorOrderBy,
  timeCursorPredicate,
} from '@/lib/data-drains/sources/cursor'
import { getOrganizationWorkspaceIds } from '@/lib/data-drains/sources/helpers'
import type { Cursor, DrainSource, SourcePageInput } from '@/lib/data-drains/types'

type CopilotChatRow = typeof copilotChats.$inferSelect

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

    const rows = await db
      .select()
      .from(copilotChats)
      .where(and(inArray(copilotChats.workspaceId, workspaceIds), cursorClause))
      .orderBy(...timeCursorOrderBy(copilotChats.createdAt, copilotChats.id))
      .limit(input.chunkSize)

    if (rows.length === 0) return
    yield rows
    const last = rows[rows.length - 1]
    cursor = { ts: last.createdAt.toISOString(), id: last.id }
    if (rows.length < input.chunkSize) return
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
