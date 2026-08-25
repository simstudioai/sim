import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'
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

export interface ChatDeploymentWithWorkflowStatus {
  chat: ChatDeploymentRow
  isWorkflowDeployed: boolean
}

const chatDeploymentId = textKey<ChatDeploymentWithWorkflowStatus>(chat.id, (row) => row.chat.id)

/**
 * Keyset orderings for the public list's sortable fields, made total over the
 * contract enum by `satisfies`. Each ends in `id` so deployments sharing an
 * identifier prefix or a timestamp still come back in a stable order.
 */
const CHAT_DEPLOYMENT_SORTS = {
  identifier: [
    textKey<ChatDeploymentWithWorkflowStatus>(chat.identifier, (row) => row.chat.identifier),
    chatDeploymentId,
  ],
  createdAt: [
    timestampKey<ChatDeploymentWithWorkflowStatus>(chat.createdAt, (row) => row.chat.createdAt),
    chatDeploymentId,
  ],
  updatedAt: [
    timestampKey<ChatDeploymentWithWorkflowStatus>(chat.updatedAt, (row) => row.chat.updatedAt),
    chatDeploymentId,
  ],
} satisfies Record<ChatDeploymentSortBy, readonly KeysetKey<ChatDeploymentWithWorkflowStatus>[]>

function effectiveChatActiveFilter(isActive: boolean | undefined) {
  if (isActive === undefined) return undefined
  return isActive
    ? and(eq(chat.isActive, true), eq(workflow.isDeployed, true))
    : or(eq(chat.isActive, false), eq(workflow.isDeployed, false))
}

/** One keyset page of live chat deployments whose workflow lives in a workspace. */
export async function listWorkspaceChatDeployments(params: {
  workspaceId: string
  workflowId?: string
  isActive?: boolean
  sortBy?: ChatDeploymentSortBy
  sortOrder?: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}): Promise<KeysetPage<ChatDeploymentWithWorkflowStatus>> {
  const { sortBy = 'createdAt', sortOrder = 'desc', limit } = params
  const keys = CHAT_DEPLOYMENT_SORTS[sortBy]
  const resumeAfter = resumeKeyset(keys, params.cursorKeys, sortOrder)

  const rows = await db
    .select({ chat, isWorkflowDeployed: workflow.isDeployed })
    .from(chat)
    .innerJoin(workflow, eq(chat.workflowId, workflow.id))
    .where(
      and(
        eq(workflow.workspaceId, params.workspaceId),
        isNull(workflow.archivedAt),
        isNull(chat.archivedAt),
        params.workflowId === undefined ? undefined : eq(chat.workflowId, params.workflowId),
        effectiveChatActiveFilter(params.isActive),
        resumeAfter
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))
    .limit(limit + 1)

  return keysetPage(keys, rows, limit)
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

/**
 * The live chat deployment of a workflow, or null when it has none.
 *
 * `.limit(1)` is the only thing expressing the 1:1 invariant between a workflow
 * and its chat. It is a projection of that invariant, not an enforcement of it:
 * there is no unique constraint on `chat(workflow_id)`, so this read is one half
 * of a check-then-act and the guarantees split in two.
 *
 * **Guaranteed.** Two concurrent writers claiming the same `identifier` cannot
 * both win: the partial unique index `identifier_idx ON chat (identifier) WHERE
 * archived_at IS NULL` rejects the loser, and
 * {@link chatIdentifierUniquenessConflict} classifies that rejection as the same
 * `409` the pre-check reports.
 *
 * **Not guaranteed.** Two concurrent writers publishing the *same workflow*
 * under *different* identifiers both read `null` here and both insert. Nothing
 * rejects the second, so the workflow ends up with two live chat rows and every
 * subsequent read of it silently resolves to whichever one this `.limit(1)`
 * happens to return. The window is narrow — it spans this read to the insert in
 * `performChatDeploy` — but it is real, and it is not closable in application
 * code: the insert is not transactional and is shared with the internal editor
 * and the Copilot deploy tool, so a lock taken here would not span it.
 *
 * The fix is a partial unique index, `chat(workflow_id) WHERE archived_at IS
 * NULL`, which makes the loser a `23505` this domain can classify exactly as it
 * already classifies the identifier collision. It ships as its own migration,
 * behind a preflight count of workflows already carrying more than one live
 * chat row, because the constraint cannot be created while a duplicate exists.
 */
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
