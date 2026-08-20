import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import {
  type CursorKey,
  type KeysetKey,
  type KeysetPage,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'

/**
 * Workspace-scoped chat-deployment reads.
 *
 * `chat` has no `workspaceId` column — scope is derived by joining the workflow
 * it deploys — so every predicate here goes through that join rather than
 * trusting a caller-supplied workspace.
 */

export type ChatDeploymentRow = typeof chat.$inferSelect
export type ChatDeploymentSortBy = 'identifier' | 'createdAt' | 'updatedAt'

const chatDeploymentId = textKey<ChatDeploymentRow>(chat.id, (row) => row.id)

/**
 * Keyset orderings for the public list's sortable fields, made total over the
 * contract enum by `satisfies`. Each ends in `id` so deployments sharing an
 * identifier prefix or a timestamp still come back in a stable order.
 */
const CHAT_DEPLOYMENT_SORTS = {
  identifier: [
    textKey<ChatDeploymentRow>(chat.identifier, (row) => row.identifier),
    chatDeploymentId,
  ],
  createdAt: [
    timestampKey<ChatDeploymentRow>(chat.createdAt, (row) => row.createdAt),
    chatDeploymentId,
  ],
  updatedAt: [
    timestampKey<ChatDeploymentRow>(chat.updatedAt, (row) => row.updatedAt),
    chatDeploymentId,
  ],
} satisfies Record<ChatDeploymentSortBy, readonly KeysetKey<ChatDeploymentRow>[]>

/** One keyset page of live chat deployments whose workflow lives in a workspace. */
export async function listWorkspaceChatDeployments(params: {
  workspaceId: string
  workflowId?: string
  isActive?: boolean
  sortBy?: ChatDeploymentSortBy
  sortOrder?: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}): Promise<KeysetPage<ChatDeploymentRow>> {
  const { sortBy = 'createdAt', sortOrder = 'desc', limit } = params
  const keys = CHAT_DEPLOYMENT_SORTS[sortBy]
  const resumeAfter = resumeKeyset(keys, params.cursorKeys, sortOrder)

  const rows = await db
    .select({ chat })
    .from(chat)
    .innerJoin(workflow, eq(chat.workflowId, workflow.id))
    .where(
      and(
        eq(workflow.workspaceId, params.workspaceId),
        isNull(workflow.archivedAt),
        isNull(chat.archivedAt),
        params.workflowId === undefined ? undefined : eq(chat.workflowId, params.workflowId),
        params.isActive === undefined ? undefined : eq(chat.isActive, params.isActive),
        resumeAfter
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))
    .limit(limit + 1)

  return keysetPage(
    keys,
    rows.map((row) => row.chat),
    limit
  )
}

/**
 * A live chat deployment together with the workspace derived from its workflow,
 * or null when neither the deployment nor its workflow is live.
 */
export async function getChatDeploymentWithWorkspace(
  chatDeploymentId: string
): Promise<{ chat: ChatDeploymentRow; workspaceId: string } | null> {
  const [row] = await db
    .select({ chat, workspaceId: workflow.workspaceId })
    .from(chat)
    .innerJoin(workflow, eq(chat.workflowId, workflow.id))
    .where(and(eq(chat.id, chatDeploymentId), isNull(chat.archivedAt)))
    .limit(1)

  if (!row?.workspaceId) return null
  return { chat: row.chat, workspaceId: row.workspaceId }
}

/** The live chat deployment of a workflow, or null when it has none. */
export async function getLiveChatDeploymentForWorkflow(
  workflowId: string
): Promise<ChatDeploymentRow | null> {
  const [row] = await db
    .select()
    .from(chat)
    .where(and(eq(chat.workflowId, workflowId), isNull(chat.archivedAt)))
    .limit(1)
  return row ?? null
}

/** The live deployment holding an identifier, or null when the identifier is free. */
export async function getChatDeploymentIdOwningIdentifier(
  identifier: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: chat.id })
    .from(chat)
    .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
    .limit(1)
  return row?.id ?? null
}

/** Applies a settled update to one chat deployment and returns the authoritative row. */
export async function updateChatDeploymentRow(
  chatDeploymentId: string,
  values: Partial<ChatDeploymentRow>
): Promise<ChatDeploymentRow | null> {
  const [row] = await db
    .update(chat)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(chat.id, chatDeploymentId), isNull(chat.archivedAt)))
    .returning()
  return row ?? null
}
