import { copilotChats, copilotMessages } from '@sim/db/schema'
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { DATA_DRAIN_LIMITS } from '@/lib/data-drains/limits'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorOrderBy,
  timeCursorPredicate,
  timeCursorStabilityBound,
} from '@/lib/data-drains/sources/cursor'
import { readBoundedSourcePage, workspaceInOrganization } from '@/lib/data-drains/sources/helpers'
import type { Cursor, DrainSource, SourcePageInput } from '@/lib/data-drains/types'

/**
 * The transcript no longer lives on `copilot_chats.messages` — it is assembled
 * per page from the normalized `copilot_messages` table, so `messages` is the
 * ordered list of message `content` objects rather than the DB column.
 *
 * `planArtifact` is omitted too: the column still exists only until a
 * follow-up migration can safely drop it, and nothing writes it any more, so
 * draining it would ship a dead field to every export consumer. External
 * conversation bindings are internal routing metadata and are not exported.
 */
type CopilotChatRow = Omit<
  typeof copilotChats.$inferSelect,
  | 'memorySpaceId'
  | 'messages'
  | 'planArtifact'
  | 'externalConversationKey'
  | 'externalConversationMetadata'
> & {
  messages: unknown[]
}

/** Chat metadata columns, excluding the legacy `messages` JSONB. */
const chatColumns = {
  id: copilotChats.id,
  userId: copilotChats.userId,
  workflowId: copilotChats.workflowId,
  workspaceId: copilotChats.workspaceId,
  organizationId: copilotChats.organizationId,
  type: copilotChats.type,
  title: copilotChats.title,
  model: copilotChats.model,
  conversationId: copilotChats.conversationId,
  previewYaml: copilotChats.previewYaml,
  config: copilotChats.config,
  resources: copilotChats.resources,
  lastSeenAt: copilotChats.lastSeenAt,
  autoAllowedTools: copilotChats.autoAllowedTools,
  pinned: copilotChats.pinned,
  deletedAt: copilotChats.deletedAt,
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
  let cursor = decodeTimeCursor(input.cursor)
  while (!input.signal.aborted) {
    const cursorClause = timeCursorPredicate(copilotChats.createdAt, copilotChats.id, cursor)
    const orderBy = timeCursorOrderBy(copilotChats.createdAt, copilotChats.id)
    const rows = await readBoundedSourcePage({
      table: copilotChats,
      idColumn: copilotChats.id,
      condition: and(
        or(
          workspaceInOrganization(copilotChats.workspaceId, input.organizationId),
          and(
            isNull(copilotChats.workspaceId),
            eq(copilotChats.organizationId, input.organizationId)
          )
        ),
        timeCursorStabilityBound(copilotChats.createdAt),
        cursorClause
      ),
      orderBy,
      chunkSize: input.chunkSize,
      measuredValue: sql`json_build_object(${sql.join(
        Object.entries(chatColumns).flatMap(([name, column]) => [
          sql`${name}::text`,
          sql`${column}`,
        ]),
        sql`, `
      )})`,
      read: async (tx, ids) => {
        const metaRows = await tx
          .select(chatColumns)
          .from(copilotChats)
          .where(inArray(copilotChats.id, ids))
          .orderBy(...orderBy)
        const messageCondition = and(
          inArray(copilotMessages.chatId, ids),
          isNull(copilotMessages.deletedAt)
        )
        const transcriptSizes = await tx
          .select({
            chatId: copilotMessages.chatId,
            bytes: sql<number>`sum(octet_length(row_to_json(${copilotMessages})::text))`.mapWith(
              Number
            ),
          })
          .from(copilotMessages)
          .where(messageCondition)
          .groupBy(copilotMessages.chatId)
        const transcriptBytes = new Map(
          transcriptSizes.map((transcript) => [transcript.chatId, transcript.bytes])
        )
        for (const row of metaRows) {
          assertKnownSizeWithinLimit(
            Buffer.byteLength(JSON.stringify({ ...row, messages: [] }), 'utf8') +
              (transcriptBytes.get(row.id) ?? 0),
            DATA_DRAIN_LIMITS.maxRowBytes,
            'Drain chat record'
          )
        }
        const messageRows = await tx
          .select({ chatId: copilotMessages.chatId, content: copilotMessages.content })
          .from(copilotMessages)
          .where(messageCondition)
          .orderBy(
            asc(copilotMessages.chatId),
            sql`${copilotMessages.seq} asc nulls last`,
            asc(copilotMessages.createdAt),
            asc(copilotMessages.id)
          )
        const messagesByChat = new Map<string, unknown[]>()
        for (const message of messageRows) {
          const existing = messagesByChat.get(message.chatId)
          if (existing) existing.push(message.content)
          else messagesByChat.set(message.chatId, [message.content])
        }
        return metaRows.map((row) => ({ ...row, messages: messagesByChat.get(row.id) ?? [] }))
      },
    })
    if (rows.length === 0) return
    yield rows
    const last = rows[rows.length - 1]
    cursor = { ts: last.createdAt.toISOString(), id: last.id }
    if (rows.length < Math.min(input.chunkSize, DATA_DRAIN_LIMITS.pageRows)) return
  }
}

export const copilotChatsSource: DrainSource<CopilotChatRow> = {
  type: 'copilot_chats',
  displayName: 'Chats',
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
      config: row.config,
      resources: row.resources,
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  },
  cursorAfter(row): Cursor {
    return encodeTimeCursor({ ts: row.createdAt.toISOString(), id: row.id })
  },
}
