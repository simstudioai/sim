import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  authorizeWorkflowByWorkspacePermission,
  getActiveWorkflowRecord,
} from '@sim/platform-authz/workflow'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { type ConversationMode, conversationModeSelection } from '@/lib/mothership/chat/intent'
import {
  authorizeOrganizationChat,
  authorizeOrganizationChatCancellation,
} from '@/lib/mothership/chat/organization-chats'
import {
  type PersistedMessage,
  stripToolResultOutput,
} from '@/lib/mothership/chat/persisted-message'
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
  createdAt: copilotChats.createdAt,
  updatedAt: copilotChats.updatedAt,
} as const

/**
 * Column set for the legacy copilot chat detail endpoint. Extends
 * `copilotChatDetailColumns` with `model` and `config` — the
 * fields the legacy `transformChat` response shape includes. Still drops
 * `previewYaml` (JSONB), `pinned`, and `lastSeenAt`.
 */
const copilotChatLegacyDetailColumns = {
  ...copilotChatDetailColumns,
  model: copilotChats.model,
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

/**
 * MCP server ids tagged (`/name`) on a chat's live messages, in first-tagged
 * transcript order. Reads only the `mcp` entries of each message's `contexts`
 * instead of materializing the whole transcript, and skips soft-deleted
 * messages so a removed turn no longer enables its servers.
 */
export async function loadChatMcpServerIds(chatId: string): Promise<string[]> {
  const rows = await db
    .select({ serverId: sql<string>`mcp_context.value ->> 'serverId'` })
    .from(copilotMessages)
    .crossJoinLateral(
      sql`jsonb_array_elements(
        case when jsonb_typeof(${copilotMessages.content} -> 'contexts') = 'array'
          then ${copilotMessages.content} -> 'contexts'
          else '[]'::jsonb
        end
      ) with ordinality as mcp_context(value, ordinal)`
    )
    .where(
      and(
        eq(copilotMessages.chatId, chatId),
        isNull(copilotMessages.deletedAt),
        sql`mcp_context.value ->> 'kind' = 'mcp'`,
        sql`jsonb_typeof(mcp_context.value -> 'serverId') = 'string'`,
        sql`mcp_context.value ->> 'serverId' <> ''`
      )
    )
    .orderBy(
      sql`${copilotMessages.seq} asc nulls last`,
      asc(copilotMessages.createdAt),
      asc(copilotMessages.id),
      sql`mcp_context.ordinal`
    )
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

export type CopilotChatDetail = Pick<
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
> & { mode: ConversationMode }

export type CopilotChatDetailRow = CopilotChatDetail & {
  /** Transcript assembled from `copilot_messages` (no longer a chat-row column). */
  messages: unknown[]
}

export type CopilotChatLegacyDetailRow = CopilotChatDetailRow &
  Pick<typeof copilotChats.$inferSelect, 'model' | 'config'>

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
        input: { organizationId: chat.organizationId },
      })
    } catch (error) {
      const code = asOrchestrationError(error)?.code
      if (code === 'not_found' || code === 'forbidden') return null
      throw error
    }
  } else if (chat.workflowId) {
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
 * Load a copilot chat row for the legacy chat detail endpoint, including the
 * transcript plus `model` and `config`. Drops `previewYaml`
 * (JSONB), `pinned`, and `lastSeenAt` — none of which the endpoint returns.
 */
export async function getAccessibleCopilotChat(
  chatId: string,
  userId: string,
  options?: { principal?: Principal }
): Promise<CopilotChatLegacyDetailRow | null> {
  const [chat] = await db
    .select(copilotChatLegacyDetailColumns)
    .from(copilotChats)
    .where(ownedLiveChatWhere(chatId, userId))
    .limit(1)

  const authorized = await authorizeCopilotChatRow(chat, chatId, userId, options?.principal)
  if (!authorized) return null

  const messages = await loadCopilotChatMessages(chatId)
  return { ...authorized, messages }
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
 * Load a copilot chat with the conversation transcript and resources after
 * authorization, omitting copilot-only TOAST-able fields (`previewYaml`,
 * `config`) and unused metadata (`model`, `pinned`, `lastSeenAt`). Use this for
 * the mothership chat detail endpoint — every column read here is consumed
 * downstream, and dropping the others avoids per-request detoast overhead.
 */
export async function getAccessibleCopilotChatWithMessages(
  chatId: string,
  userId: string,
  options?: { principal?: Principal }
): Promise<CopilotChatDetailRow | null> {
  const chat = await getAccessibleCopilotChatDetail(chatId, userId, options?.principal)
  if (!chat) return null

  const messages = await loadCopilotChatMessages(chatId)
  return { ...chat, messages }
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
  const [newChat] = await db
    .insert(copilotChats)
    .values({
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

  if (!newChat) {
    logger.warn('Failed to create new copilot chat row', { userId, workflowId, workspaceId })
    return { chatId: '', chat: null, isNew: true }
  }

  return { chatId: newChat.id, chat: newChat, isNew: true }
}
