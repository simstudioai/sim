import { db } from '@sim/db'
import { type CopilotRunStatus, copilotChats, copilotMessages, copilotRuns } from '@sim/db/schema'
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'
import {
  type CursorKey,
  encodeKeyset,
  keysetAfter,
  keysetColumns,
  listOrderBy,
  timestampKey,
  uuidKey,
} from '@/lib/api/list-query'

export const PUBLIC_CHAT_RUN_SORT = 'startedAt:desc'

export interface PublicChatRunRow {
  runId: string
  chatId: string
  chatTitle: string | null
  streamId: string
  status: CopilotRunStatus
  startedAt: Date
  completedAt: Date | null
}

const PUBLIC_CHAT_RUN_KEYS = [
  timestampKey<PublicChatRunRow>(copilotRuns.startedAt, (row) => row.startedAt),
  uuidKey<PublicChatRunRow>(copilotRuns.id, (row) => row.runId),
]

const publicChatRunSelection = {
  runId: copilotRuns.id,
  chatId: copilotRuns.chatId,
  chatTitle: copilotChats.title,
  streamId: copilotRuns.streamId,
  status: copilotRuns.status,
  startedAt: copilotRuns.startedAt,
  completedAt: copilotRuns.completedAt,
} as const

function ownedRootMothershipRunWhere(input: {
  userId: string
  workspaceId: string
  runId?: string
  status?: CopilotRunStatus
  resumeAfter?: SQL
}) {
  return and(
    eq(copilotRuns.userId, input.userId),
    eq(copilotRuns.workspaceId, input.workspaceId),
    isNull(copilotRuns.parentRunId),
    eq(copilotChats.userId, input.userId),
    eq(copilotChats.workspaceId, input.workspaceId),
    eq(copilotChats.type, 'mothership'),
    isNull(copilotChats.deletedAt),
    input.runId ? eq(copilotRuns.id, input.runId) : undefined,
    input.status ? eq(copilotRuns.status, input.status) : undefined,
    input.resumeAfter
  )
}

export type ListPublicChatRunsResult =
  | { status: 'ok'; rows: PublicChatRunRow[] }
  | { status: 'invalid_cursor' }

/** Lists only user-owned root runs from live Mothership chats. */
export async function listPublicChatRuns(input: {
  userId: string
  workspaceId: string
  status?: CopilotRunStatus
  limit: number
  cursorKeys?: CursorKey[]
}): Promise<ListPublicChatRunsResult> {
  const resumeAfter = input.cursorKeys
    ? keysetAfter(PUBLIC_CHAT_RUN_KEYS, input.cursorKeys, 'desc')
    : undefined
  if (resumeAfter === null) return { status: 'invalid_cursor' }

  const rows = await db
    .select(publicChatRunSelection)
    .from(copilotRuns)
    .innerJoin(copilotChats, eq(copilotChats.id, copilotRuns.chatId))
    .where(ownedRootMothershipRunWhere({ ...input, resumeAfter }))
    .orderBy(...listOrderBy(keysetColumns(PUBLIC_CHAT_RUN_KEYS), 'desc'))
    .limit(input.limit + 1)

  return { status: 'ok', rows }
}

export function encodePublicChatRunCursor(row: PublicChatRunRow): CursorKey[] {
  return encodeKeyset(PUBLIC_CHAT_RUN_KEYS, row)
}

/**
 * Loads one public run while masking every ownership, scope, type, deletion,
 * and parent-run mismatch behind the same absence result.
 */
export async function getPublicChatRun(input: {
  runId: string
  userId: string
  workspaceId: string
}): Promise<PublicChatRunRow | null> {
  const [run] = await db
    .select(publicChatRunSelection)
    .from(copilotRuns)
    .innerJoin(copilotChats, eq(copilotChats.id, copilotRuns.chatId))
    .where(ownedRootMothershipRunWhere(input))
    .limit(1)

  return run ?? null
}

/**
 * Reads only the root assistant prose persisted for this stream. Tool blocks
 * stay inside the JSON message and never cross the public boundary.
 */
export async function getPersistedPublicChatRunResponse(
  chatId: string,
  streamId: string
): Promise<string | null> {
  const [row] = await db
    .select({ content: copilotMessages.content })
    .from(copilotMessages)
    .where(
      and(
        eq(copilotMessages.chatId, chatId),
        eq(copilotMessages.streamId, streamId),
        eq(copilotMessages.role, 'assistant'),
        isNull(copilotMessages.deletedAt)
      )
    )
    .orderBy(desc(copilotMessages.seq), desc(copilotMessages.createdAt), desc(copilotMessages.id))
    .limit(1)

  if (!row?.content || typeof row.content !== 'object' || Array.isArray(row.content)) return null
  const response = (row.content as Record<string, unknown>).content
  return typeof response === 'string' ? response : null
}
