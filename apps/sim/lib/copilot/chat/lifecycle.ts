import { db } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  authorizeWorkflowByWorkspacePermission,
  getActiveWorkflowRecord,
} from '@sim/workflow-authz'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { type PersistedMessage, stripToolResultOutput } from '@/lib/copilot/chat/persisted-message'
import {
  assertActiveWorkspaceAccess,
  checkWorkspaceAccess,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotChatLifecycle')

export interface ChatLoadResult {
  chatId: string
  chat: CopilotChatDetailRow | null
  conversationHistory: unknown[]
  isNew: boolean
}

/**
 * Minimal column set needed to perform workflow/workspace authorization for a
 * copilot chat. Heavy TOAST-able columns (messages, planArtifact, previewYaml,
 * config, resources) are intentionally excluded — callers that only need to
 * verify ownership should not pay the detoast cost for those fields.
 */
const copilotChatAuthColumns = {
  id: copilotChats.id,
  userId: copilotChats.userId,
  workflowId: copilotChats.workflowId,
  workspaceId: copilotChats.workspaceId,
  type: copilotChats.type,
} as const

/**
 * Column set for chat-detail callers that need chat metadata. The conversation
 * transcript is no longer selected from `copilot_chats.messages` (JSONB) —
 * reads now source it from the normalized `copilot_messages` table via
 * `loadCopilotChatMessages`, which avoids detoasting the large messages blob on
 * every load. The copilot-only TOAST-able fields (`previewYaml`,
 * `planArtifact`, `config`) and unused metadata (`model`, `pinned`,
 * `lastSeenAt`) remain excluded.
 */
const copilotChatDetailColumns = {
  ...copilotChatAuthColumns,
  title: copilotChats.title,
  conversationId: copilotChats.conversationId,
  resources: copilotChats.resources,
  createdAt: copilotChats.createdAt,
  updatedAt: copilotChats.updatedAt,
} as const

/**
 * Column set for the legacy copilot chat detail endpoint. Extends
 * `copilotChatDetailColumns` with `model`, `planArtifact`, and `config` — the
 * fields the legacy `transformChat` response shape includes. Still drops
 * `previewYaml` (JSONB), `pinned`, and `lastSeenAt`.
 */
const copilotChatLegacyDetailColumns = {
  ...copilotChatDetailColumns,
  model: copilotChats.model,
  planArtifact: copilotChats.planArtifact,
  config: copilotChats.config,
} as const

/**
 * Load a chat's transcript from the normalized `copilot_messages` table in
 * canonical order (`seq` first, then `created_at`/`id` as a deterministic
 * tiebreak; `NULLS LAST` so any not-yet-sequenced row sorts after sequenced
 * ones). Each row's `content` is the full message object — identical in shape
 * to a legacy JSONB array element — so the downstream normalize/transcript
 * pipeline is unchanged.
 */
export async function loadCopilotChatMessages(chatId: string): Promise<PersistedMessage[]> {
  const rows = await db
    .select({ content: copilotMessages.content })
    .from(copilotMessages)
    .where(and(eq(copilotMessages.chatId, chatId), isNull(copilotMessages.deletedAt)))
    .orderBy(
      sql`${copilotMessages.seq} asc nulls last`,
      asc(copilotMessages.createdAt),
      asc(copilotMessages.id)
    )
  // Also strip on read: rows written before the backfill still carry outputs.
  return rows.map((row) => stripToolResultOutput(row.content as PersistedMessage))
}

type CopilotChatAuthRow = Pick<
  typeof copilotChats.$inferSelect,
  'id' | 'userId' | 'workflowId' | 'workspaceId' | 'type'
>

export type CopilotChatDetailRow = Pick<
  typeof copilotChats.$inferSelect,
  | 'id'
  | 'userId'
  | 'workflowId'
  | 'workspaceId'
  | 'type'
  | 'title'
  | 'conversationId'
  | 'resources'
  | 'createdAt'
  | 'updatedAt'
> & {
  /** Transcript assembled from `copilot_messages` (no longer a chat-row column). */
  messages: unknown[]
}

export type CopilotChatLegacyDetailRow = CopilotChatDetailRow &
  Pick<typeof copilotChats.$inferSelect, 'model' | 'planArtifact' | 'config'>

async function authorizeCopilotChatRow<T extends CopilotChatAuthRow>(
  chat: T | undefined,
  chatId: string,
  userId: string
): Promise<T | null> {
  if (!chat) {
    logger.warn('Copilot chat not found or not owned by user', { chatId, userId })
    return null
  }

  if (chat.workflowId) {
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: chat.workflowId,
      userId,
      action: 'read',
    })
    if (!authorization.allowed || !authorization.workflow) {
      logger.warn('Copilot chat workflow not authorized for user', {
        chatId,
        userId,
        workflowId: chat.workflowId,
      })
      return null
    }
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

  return chat
}

/**
 * Verify a copilot chat exists, is owned by the user, and the user has access
 * to its workflow/workspace. Selects only the columns required for the
 * authorization check — use this for routes that only need ownership
 * verification before a mutation (rename, delete, update-messages).
 */
export async function getAccessibleCopilotChatAuth(
  chatId: string,
  userId: string
): Promise<CopilotChatAuthRow | null> {
  const [chat] = await db
    .select(copilotChatAuthColumns)
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
    .limit(1)

  return authorizeCopilotChatRow(chat, chatId, userId)
}

/**
 * Load a copilot chat row for the legacy chat detail endpoint, including the
 * transcript plus `model`, `planArtifact`, and `config`. Drops `previewYaml`
 * (JSONB), `pinned`, and `lastSeenAt` — none of which the endpoint returns.
 */
export async function getAccessibleCopilotChat(
  chatId: string,
  userId: string
): Promise<CopilotChatLegacyDetailRow | null> {
  const [chat] = await db
    .select(copilotChatLegacyDetailColumns)
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
    .limit(1)

  const authorized = await authorizeCopilotChatRow(chat, chatId, userId)
  if (!authorized) return null

  const messages = await loadCopilotChatMessages(chatId)
  return { ...authorized, messages }
}

/**
 * Load a copilot chat with the conversation transcript and resources after
 * authorization, omitting copilot-only TOAST-able fields (`previewYaml`,
 * `planArtifact`, `config`) and unused metadata (`model`, `pinned`,
 * `lastSeenAt`). Use this for the mothership chat detail endpoint and the
 * shared `resolveOrCreateChat` path — every column read here is consumed
 * downstream, and dropping the others avoids per-request detoast overhead.
 */
export async function getAccessibleCopilotChatWithMessages(
  chatId: string,
  userId: string
): Promise<CopilotChatDetailRow | null> {
  const [chat] = await db
    .select(copilotChatDetailColumns)
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
    .limit(1)

  const authorized = await authorizeCopilotChatRow(chat, chatId, userId)
  if (!authorized) return null

  const messages = await loadCopilotChatMessages(chatId)
  return { ...authorized, messages }
}

/**
 * Resolve or create a copilot chat session.
 * If chatId is provided, loads the existing chat. Otherwise creates a new one.
 * Supports both workflow-scoped and workspace-scoped chats.
 */
export async function resolveOrCreateChat(params: {
  chatId?: string
  userId: string
  workflowId?: string
  workspaceId?: string
  model: string
  type?: 'mothership' | 'copilot'
}): Promise<ChatLoadResult> {
  const { chatId, userId, workflowId, workspaceId, model, type } = params

  if (workspaceId) {
    await assertActiveWorkspaceAccess(workspaceId, userId)
  }

  if (chatId) {
    const chat = await getAccessibleCopilotChatWithMessages(chatId, userId)

    if (chat) {
      if (workflowId && chat.workflowId !== workflowId) {
        logger.warn('Copilot chat workflow mismatch', {
          chatId,
          userId,
          requestWorkflowId: workflowId,
          chatWorkflowId: chat.workflowId,
        })
        return { chatId, chat: null, conversationHistory: [], isNew: false }
      }

      if (workspaceId && chat.workspaceId !== workspaceId) {
        logger.warn('Copilot chat workspace mismatch', {
          chatId,
          userId,
          requestWorkspaceId: workspaceId,
          chatWorkspaceId: chat.workspaceId,
        })
        return { chatId, chat: null, conversationHistory: [], isNew: false }
      }

      if (chat.workflowId) {
        const activeWorkflow = await getActiveWorkflowRecord(chat.workflowId)
        if (!activeWorkflow) {
          logger.warn('Copilot chat workflow no longer active', {
            chatId,
            userId,
            workflowId: chat.workflowId,
          })
          return { chatId, chat: null, conversationHistory: [], isNew: false }
        }
      }
    }

    return {
      chatId,
      chat: chat ?? null,
      conversationHistory: chat && Array.isArray(chat.messages) ? chat.messages : [],
      isNew: false,
    }
  }

  const now = new Date()
  const [newChat] = await db
    .insert(copilotChats)
    .values({
      userId,
      ...(workflowId ? { workflowId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      type: type ?? 'copilot',
      title: null,
      model,
      lastSeenAt: now,
    })
    .returning(copilotChatDetailColumns)

  if (!newChat) {
    logger.warn('Failed to create new copilot chat row', { userId, workflowId, workspaceId })
    return {
      chatId: '',
      chat: null,
      conversationHistory: [],
      isNew: true,
    }
  }

  return {
    chatId: newChat.id,
    chat: { ...newChat, messages: [] },
    conversationHistory: [],
    isNew: true,
  }
}
