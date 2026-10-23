import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  authorizeWorkflowByWorkspacePermission,
  getActiveWorkflowRecord,
} from '@sim/platform-authz/workflow'
import { and, asc, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'
import { preciseTimestampText } from '@/lib/api/list-query'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ConversationMode,
  chatEffortSelection,
  conversationModeSelection,
} from '@/lib/mothership/chat/intent'
import {
  authorizeOrganizationChat,
  authorizeOrganizationChatCancellation,
} from '@/lib/mothership/chat/organization-chats'
import {
  type PersistedFileAttachment,
  type PersistedMessage,
  stripToolResultOutput,
} from '@/lib/mothership/chat/persisted-message'
import { detoastedMessageContent, textMessageContent } from '@/lib/mothership/chat/text-transcript'
import {
  encodeTranscriptCursor,
  type TranscriptPosition,
  transcriptAtOrAfter,
  transcriptBefore,
} from '@/lib/mothership/chat/transcript-cursor'
import { isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import { selectedMemorySpaceForNewChat } from '@/lib/mothership/memory/spaces'
import type { MothershipEffort } from '@/lib/mothership/model-options'
import {
  assertActiveWorkspaceAccess,
  checkWorkspaceAccess,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotChatLifecycle')

export interface ChatLoadResult {
  chatId: string
  chat: CopilotChatDetail | null
  isNew: boolean
}

/**
 * Minimal column set needed to perform workflow/workspace authorization for a
 * copilot chat. Heavy TOAST-able columns (messages, previewYaml, config,
 * resources) are intentionally excluded — callers that only need to
 * verify ownership should not pay the detoast cost for those fields.
 */
const copilotChatAuthColumns = {
  id: copilotChats.id,
  mode: conversationModeSelection,
  userId: copilotChats.userId,
  workflowId: copilotChats.workflowId,
  workspaceId: copilotChats.workspaceId,
  organizationId: copilotChats.organizationId,
  type: copilotChats.type,
} as const

/**
 * Column set for chat-detail callers that need chat metadata. The conversation
 * transcript is no longer selected from `copilot_chats.messages` (JSONB) —
 * reads now source it from the normalized `copilot_messages` table via
 * `loadCopilotChatMessages`, which avoids detoasting the large messages blob on
 * every load. The copilot-only TOAST-able fields (`previewYaml`, `config`)
 * and unused metadata (`model`, `pinned`, `lastSeenAt`) remain excluded.
 */
const copilotChatDetailColumns = {
  ...copilotChatAuthColumns,
  title: copilotChats.title,
  conversationId: copilotChats.conversationId,
  resources: copilotChats.resources,
  effort: chatEffortSelection,
  createdAt: copilotChats.createdAt,
  updatedAt: copilotChats.updatedAt,
} as const

/** Canonical transcript order; `NULLS LAST` sorts a not-yet-sequenced row after sequenced ones. */
const TRANSCRIPT_ORDER = [
  sql`${copilotMessages.seq} asc nulls last`,
  asc(copilotMessages.createdAt),
  asc(copilotMessages.id),
]

const TRANSCRIPT_ORDER_DESC = [
  sql`${copilotMessages.seq} desc nulls first`,
  desc(copilotMessages.createdAt),
  desc(copilotMessages.id),
]

/**
 * A message as the chat UI receives it: the stored `display_content` projection when the
 * message has one, so a transcript read never detoasts the full tool-call params.
 */
const displayMessageContent = sql<unknown>`coalesce(${copilotMessages.displayContent}, ${copilotMessages.content})`

/**
 * Each element of a message's `content -> field` array as `alias(value, ordinal)`, for a
 * lateral join that reads one array of every message instead of whole transcripts. A
 * message whose field is missing or not an array contributes nothing.
 */
function messageArrayElements(field: string, alias: string): SQL {
  const array = sql`${copilotMessages.content} -> ${field}::text`
  return sql`jsonb_array_elements(
    case when jsonb_typeof(${array}) = 'array' then ${array} else '[]'::jsonb end
  ) with ordinality as ${sql.identifier(alias)}(value, ordinal)`
}

/**
 * Load a chat's transcript from the normalized `copilot_messages` table in
 * canonical order (`seq` first, then `created_at`/`id` as a deterministic
 * tiebreak; `NULLS LAST` so any not-yet-sequenced row sorts after sequenced
 * ones). Each row's `content` is the full message object — identical in shape
 * to a legacy JSONB array element — so the downstream normalize/transcript
 * pipeline is unchanged. `projection: 'display'` reads the chat UI's projection
 * instead, whose tool-call params arrive already compacted wherever it is stored.
 */
export async function loadCopilotChatMessages(
  chatId: string,
  options?: { projection?: 'display' }
): Promise<PersistedMessage[]> {
  const rows = await db
    .select({
      content: options?.projection === 'display' ? displayMessageContent : copilotMessages.content,
    })
    .from(copilotMessages)
    .where(and(eq(copilotMessages.chatId, chatId), isNull(copilotMessages.deletedAt)))
    .orderBy(...TRANSCRIPT_ORDER)
  // Also strip on read: rows written before the backfill still carry outputs.
  return rows.map((row) => stripToolResultOutput(row.content as PersistedMessage))
}

/** Messages in the newest window the chat UI opens on. */
export const TRANSCRIPT_PAGE_SIZE = 50

/** Messages per page of older history, which the chat UI loads in the background. */
const TRANSCRIPT_OLDER_PAGE_SIZE = 200

/**
 * Which part of a transcript to read:
 * - `latest`: the newest {@link TRANSCRIPT_PAGE_SIZE} messages, cut to start at a user message.
 * - `from`: every message at or after `position`, so a reload extends what the reader holds.
 * - `before`: up to {@link TRANSCRIPT_OLDER_PAGE_SIZE} messages before `position`, cut to start
 *   at a user message.
 */
type TranscriptWindow =
  | { kind: 'latest' }
  | { kind: 'from'; position: TranscriptPosition }
  | { kind: 'before'; position: TranscriptPosition }

interface TranscriptPage {
  messages: PersistedMessage[]
  /** Where the page before this one ends, or null when this page reaches the first message. */
  olderCursor: string | null
  /** The first message of this page, to read it again extended with newer messages. */
  windowStartCursor: string | null
}

/**
 * One window of a chat's transcript in the chat UI's projection, in one read: the limit sits
 * above the ordered index scan, so only the window's rows are detoasted however long the chat
 * is. A page reading backwards starts at a user message whenever older messages exist, so a
 * turn is never split across pages; it holds every message when the window has no user message.
 */
async function loadCopilotChatTranscriptPage(
  chatId: string,
  window: TranscriptWindow
): Promise<TranscriptPage> {
  const live = and(eq(copilotMessages.chatId, chatId), isNull(copilotMessages.deletedAt))
  const columns = {
    id: copilotMessages.id,
    seq: copilotMessages.seq,
    createdAt: preciseTimestampText(copilotMessages.createdAt),
    role: copilotMessages.role,
    content: displayMessageContent,
  }

  let rows: Array<TranscriptPosition & { role: string; content: unknown }>
  let hasOlder: boolean
  if (window.kind === 'from') {
    const [page, older] = await Promise.all([
      db
        .select(columns)
        .from(copilotMessages)
        .where(and(live, transcriptAtOrAfter(window.position)))
        .orderBy(...TRANSCRIPT_ORDER),
      db
        .select({ id: copilotMessages.id })
        .from(copilotMessages)
        .where(and(live, transcriptBefore(window.position)))
        .limit(1),
    ])
    rows = page
    hasOlder = older.length > 0
  } else {
    const limit = window.kind === 'latest' ? TRANSCRIPT_PAGE_SIZE : TRANSCRIPT_OLDER_PAGE_SIZE
    const newestFirst = await db
      .select(columns)
      .from(copilotMessages)
      .where(window.kind === 'before' ? and(live, transcriptBefore(window.position)) : live)
      .orderBy(...TRANSCRIPT_ORDER_DESC)
      .limit(limit + 1)
    hasOlder = newestFirst.length > limit
    rows = newestFirst.slice(0, limit).reverse()
    const firstUser = rows.findIndex((row) => row.role === 'user')
    if (hasOlder && firstUser > 0) rows = rows.slice(firstUser)
  }

  const first = rows[0]
  const windowStart = first
    ? { seq: first.seq, createdAt: first.createdAt, id: first.id }
    : window.kind === 'latest'
      ? null
      : window.position
  const windowStartCursor = windowStart ? encodeTranscriptCursor(windowStart) : null
  return {
    messages: rows.map((row) => stripToolResultOutput(row.content as PersistedMessage)),
    olderCursor: hasOlder ? windowStartCursor : null,
    windowStartCursor,
  }
}

/**
 * File attachments on a chat's live messages whose `id` or `filename` equals `name`, in
 * transcript order. Reads only the matching `fileAttachments` entries instead of
 * materializing the whole transcript. The SQL text comparison admits a superset of the
 * strict match, which is re-applied here so a non-string `id` never matches its spelling.
 */
export async function loadChatFileAttachmentsNamed(
  chatId: string,
  name: string
): Promise<PersistedFileAttachment[]> {
  const rows = await db
    .select({ attachment: sql<PersistedFileAttachment>`file_attachment.value` })
    .from(copilotMessages)
    .crossJoinLateral(messageArrayElements('fileAttachments', 'file_attachment'))
    .where(
      and(
        eq(copilotMessages.chatId, chatId),
        isNull(copilotMessages.deletedAt),
        sql`(file_attachment.value ->> 'id' = ${name} or file_attachment.value ->> 'filename' = ${name})`
      )
    )
    .orderBy(...TRANSCRIPT_ORDER, sql`file_attachment.ordinal`)
  return rows
    .map((row) => row.attachment)
    .filter((attachment) => attachment.id === name || attachment.filename === name)
}

/**
 * MCP server ids tagged (`/name`) on a chat's live messages, in first-tagged
 * transcript order. Reads only the `mcp` entries of each message's `contexts`
 * instead of materializing the whole transcript, and skips soft-deleted
 * messages so a removed turn no longer tags its servers.
 */
export async function loadChatMcpServerIds(chatId: string): Promise<string[]> {
  const rows = await db
    .select({ serverId: sql<string>`mcp_context.value ->> 'serverId'` })
    .from(copilotMessages)
    .crossJoinLateral(messageArrayElements('contexts', 'mcp_context'))
    .where(
      and(
        eq(copilotMessages.chatId, chatId),
        isNull(copilotMessages.deletedAt),
        sql`mcp_context.value ->> 'kind' = 'mcp'`,
        sql`jsonb_typeof(mcp_context.value -> 'serverId') = 'string'`,
        sql`mcp_context.value ->> 'serverId' <> ''`
      )
    )
    .orderBy(...TRANSCRIPT_ORDER, sql`mcp_context.ordinal`)
  return [...new Set(rows.map((row) => row.serverId))]
}

/**
 * Ownership + liveness predicate shared by the accessible-chat loaders:
 * the chat must belong to the user and not be soft-deleted.
 */
function ownedLiveChatWhere(chatId: string, userId: string) {
  return and(
    eq(copilotChats.id, chatId),
    eq(copilotChats.userId, userId),
    isNull(copilotChats.deletedAt)
  )
}

type CopilotChatAuthRow = Pick<
  typeof copilotChats.$inferSelect,
  'id' | 'userId' | 'workflowId' | 'workspaceId' | 'organizationId' | 'type'
> & { mode: ConversationMode }

type CopilotChatDetail = Pick<
  typeof copilotChats.$inferSelect,
  | 'id'
  | 'userId'
  | 'workflowId'
  | 'workspaceId'
  | 'organizationId'
  | 'type'
  | 'title'
  | 'conversationId'
  | 'resources'
  | 'createdAt'
  | 'updatedAt'
> & { mode: ConversationMode; effort: MothershipEffort | null }

export type CopilotChatDetailRow = CopilotChatDetail & {
  /** Transcript assembled from `copilot_messages` (no longer a chat-row column). */
  messages: unknown[]
}

/**
 * A chat's workflow when the user may read it, or null when the workflow is archived, missing,
 * or unreadable. A workflow chat is authorized through its workflow, whose workspace also scopes
 * a legacy chat row that carries no workspace of its own.
 */
export async function authorizeChatWorkflowRead(
  chatId: string,
  userId: string,
  workflowId: string
) {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action: 'read',
  })
  if (!authorization.allowed || !authorization.workflow) {
    logger.warn('Copilot chat workflow not authorized for user', { chatId, userId, workflowId })
    return null
  }
  return authorization.workflow
}

/** A workspace Plan chat is unavailable while Plan mode is off for its owner. */
export async function isChatModeAvailable(
  chat: { organizationId?: string | null; mode: ConversationMode },
  userId: string
): Promise<boolean> {
  return chat.organizationId || chat.mode !== 'plan' ? true : isPlanModeEnabled(userId)
}

async function authorizeCopilotChatRow<T extends CopilotChatAuthRow>(
  chat: T | undefined,
  chatId: string,
  userId: string,
  principal?: Principal,
  organizationAuthorization:
    | typeof authorizeOrganizationChat
    | typeof authorizeOrganizationChatCancellation = authorizeOrganizationChat
): Promise<T | null> {
  if (!chat) {
    logger.warn('Copilot chat not found or not owned by user', { chatId, userId })
    return null
  }

  if (chat.organizationId) {
    if (!principal || resolvePrincipalSubjectUserId(principal) !== userId) return null
    if (
      principal.kind === 'organization_delegated' &&
      (principal.serviceId !== 'copilot' || principal.resourceScope.chatId !== chat.id)
    )
      return null
    try {
      await organizationAuthorization.execute({
        principal,
        input: { organizationId: chat.organizationId, mode: chat.mode },
      })
    } catch (error) {
      const code = asOrchestrationError(error)?.code
      if (code === 'not_found' || code === 'forbidden') return null
      throw error
    }
  } else if (chat.workflowId) {
    if (!(await authorizeChatWorkflowRead(chatId, userId, chat.workflowId))) return null
  } else if (chat.workspaceId) {
    const access = await checkWorkspaceAccess(chat.workspaceId, userId)
    if (!access.exists || !access.hasAccess) {
      logger.warn('Copilot chat workspace not accessible to user', {
        chatId,
        userId,
        workspaceId: chat.workspaceId,
      })
      return null
    }
  }

  if (
    organizationAuthorization !== authorizeOrganizationChatCancellation &&
    !(await isChatModeAvailable(chat, userId))
  )
    return null

  return chat
}

/**
 * Verify a copilot chat exists, is owned by the user, and the user has access
 * to its workflow/workspace. Selects only the columns required for the
 * authorization check — use this for routes that only need ownership
 * verification before a mutation (rename, delete, update-messages).
 */
export function getAccessibleCopilotChatAuth(
  chatId: string,
  userId: string,
  options?: { principal?: Principal }
): Promise<CopilotChatAuthRow | null> {
  return loadAccessibleCopilotChatAuth(
    chatId,
    userId,
    options?.principal,
    authorizeOrganizationChat
  )
}

/** Resolves the same owned, live chat under the Stop operation's current membership policy. */
export function getAccessibleCopilotChatForCancellation(
  chatId: string,
  userId: string,
  options?: { principal?: Principal }
): Promise<CopilotChatAuthRow | null> {
  return loadAccessibleCopilotChatAuth(
    chatId,
    userId,
    options?.principal,
    authorizeOrganizationChatCancellation
  )
}

async function loadAccessibleCopilotChatAuth(
  chatId: string,
  userId: string,
  principal: Principal | undefined,
  organizationAuthorization:
    | typeof authorizeOrganizationChat
    | typeof authorizeOrganizationChatCancellation
): Promise<CopilotChatAuthRow | null> {
  const [chat] = await db
    .select(copilotChatAuthColumns)
    .from(copilotChats)
    .where(ownedLiveChatWhere(chatId, userId))
    .limit(1)

  return authorizeCopilotChatRow(chat, chatId, userId, principal, organizationAuthorization)
}

/**
 * Load a copilot chat's detail columns after authorization, without its
 * transcript. The transcript is unbounded — no per-chat message cap on write
 * and no pruning — so callers that only need the chat's scope and metadata
 * (such as `resolveOrCreateChat`) must not pay to materialize it.
 */
async function getAccessibleCopilotChatDetail(
  chatId: string,
  userId: string,
  principal?: Principal
): Promise<CopilotChatDetail | null> {
  const [chat] = await db
    .select(copilotChatDetailColumns)
    .from(copilotChats)
    .where(ownedLiveChatWhere(chatId, userId))
    .limit(1)

  return authorizeCopilotChatRow(chat, chatId, userId, principal)
}

/**
 * Load a copilot chat with its transcript (whole, or the `window` asked for) and resources after
 * authorization, omitting copilot-only TOAST-able fields (`previewYaml`, `config`) and unused
 * metadata (`model`, `pinned`, `lastSeenAt`). Messages arrive in the chat UI's projection, so
 * this serves the chat detail endpoint for mothership and workflow copilot chats alike.
 */
export async function getAccessibleCopilotChatWithMessages(
  chatId: string,
  userId: string,
  options?: {
    principal?: Principal
    window?: TranscriptWindow
  }
): Promise<(CopilotChatDetailRow & Omit<TranscriptPage, 'messages'>) | null> {
  const chat = await getAccessibleCopilotChatDetail(chatId, userId, options?.principal)
  if (!chat) return null

  if (!options?.window) {
    const messages = await loadCopilotChatMessages(chatId, { projection: 'display' })
    return { ...chat, messages, olderCursor: null, windowStartCursor: null }
  }
  const page = await loadCopilotChatTranscriptPage(chatId, options.window)
  return { ...chat, ...page }
}

/**
 * Up to {@link TRANSCRIPT_OLDER_PAGE_SIZE} messages of a chat before `position`, as stored for
 * the chat UI (`display_content` when present). The caller authorizes the read.
 */
export function loadCopilotChatMessagesBefore(
  chatId: string,
  position: TranscriptPosition
): Promise<TranscriptPage> {
  return loadCopilotChatTranscriptPage(chatId, { kind: 'before', position })
}

/**
 * The chat {@link getAccessibleCopilotChatWithMessages} loads, with each message reduced to
 * its role and text ({@link textMessageContent}) for a reader that quotes the transcript.
 */
export async function getAccessibleCopilotChatWithTextMessages(
  chatId: string,
  userId: string
): Promise<CopilotChatDetailRow | null> {
  const chat = await getAccessibleCopilotChatDetail(chatId, userId)
  if (!chat) return null

  const rows = await db
    .select({ content: textMessageContent(['role', 'content']) })
    .from(copilotMessages)
    .crossJoinLateral(detoastedMessageContent)
    .where(and(eq(copilotMessages.chatId, chatId), isNull(copilotMessages.deletedAt)))
    .orderBy(...TRANSCRIPT_ORDER)
  return { ...chat, messages: rows.map((row) => row.content) }
}

/**
 * Resolve or create a copilot chat session.
 * If chatId is provided, loads the existing chat. Otherwise creates a new one.
 * Supports both workflow-scoped and workspace-scoped chats.
 *
 * A resumed chat must match every scope the caller asserted — workflow,
 * workspace, and `type`. Any mismatch resolves to `chat: null`, exactly as an
 * unknown id does, so callers cannot distinguish the reasons a chat did not
 * resolve. `title` is stamped only on a newly created chat.
 */
export async function resolveOrCreateChat(params: {
  mode?: ConversationMode
  chatId?: string
  userId: string
  workflowId?: string
  workspaceId?: string
  organizationId?: string
  principal?: Principal
  model: string
  type?: 'mothership' | 'copilot'
  title?: string
}): Promise<ChatLoadResult> {
  const {
    chatId,
    userId,
    workflowId,
    workspaceId,
    organizationId,
    principal,
    model,
    mode,
    type,
    title,
  } = params

  if (organizationId) {
    if (workspaceId || workflowId || type === 'copilot') {
      throw new Error('Organization conversations cannot have workspace or workflow scope')
    }
    if (!principal || resolvePrincipalSubjectUserId(principal) !== userId) {
      throw new Error('Organization conversations require the authenticated principal')
    }
    await authorizeOrganizationChat.execute({ principal, input: { organizationId, mode } })
  }

  if (workspaceId) {
    await assertActiveWorkspaceAccess(workspaceId, userId)
  }

  if (chatId) {
    const chat = await getAccessibleCopilotChatDetail(chatId, userId, principal)

    if (chat) {
      if ((organizationId ?? null) !== (chat.organizationId ?? null)) {
        return { chatId, chat: null, isNew: false }
      }
      if (workflowId && chat.workflowId !== workflowId) {
        logger.warn('Copilot chat workflow mismatch', {
          chatId,
          userId,
          requestWorkflowId: workflowId,
          chatWorkflowId: chat.workflowId,
        })
        return { chatId, chat: null, isNew: false }
      }

      if (workspaceId && chat.workspaceId !== workspaceId) {
        logger.warn('Copilot chat workspace mismatch', {
          chatId,
          userId,
          requestWorkspaceId: workspaceId,
          chatWorkspaceId: chat.workspaceId,
        })
        return { chatId, chat: null, isNew: false }
      }

      if (type && chat.type !== type) {
        logger.warn('Copilot chat type mismatch', {
          chatId,
          userId,
          requestType: type,
          chatType: chat.type,
        })
        return { chatId, chat: null, isNew: false }
      }

      if (chat.workflowId) {
        const activeWorkflow = await getActiveWorkflowRecord(chat.workflowId)
        if (!activeWorkflow) {
          logger.warn('Copilot chat workflow no longer active', {
            chatId,
            userId,
            workflowId: chat.workflowId,
          })
          return { chatId, chat: null, isNew: false }
        }
      }
    }

    return { chatId, chat, isNew: false }
  }

  const now = new Date()
  const [newChat] = await db.transaction(async (tx) =>
    tx
      .insert(copilotChats)
      .values({
        memorySpaceId: await selectedMemorySpaceForNewChat(userId, organizationId, workspaceId, tx),
        userId,
        ...(workflowId ? { workflowId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(organizationId ? { organizationId } : {}),
        config: { conversationMode: mode ?? (organizationId ? 'assistant' : 'agent') },
        type: type ?? (organizationId ? 'mothership' : 'copilot'),
        title: title ?? null,
        model,
        lastSeenAt: now,
      })
      .returning(copilotChatDetailColumns)
  )

  if (!newChat) {
    logger.warn('Failed to create new copilot chat row', { userId, workflowId, workspaceId })
    return { chatId: '', chat: null, isNew: true }
  }

  return { chatId: newChat.id, chat: newChat, isNew: true }
}
