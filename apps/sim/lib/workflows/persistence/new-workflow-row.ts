import { workflow, workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { lockActiveWorkspace } from '@/lib/workspaces/active-workspace'

interface NewWorkflowRowInput {
  id: string
  userId: string
  workspaceId: string
  folderId: string | null
  name: string
  description: string | null
  sortOrder?: number
  variables?: (typeof workflow.$inferInsert)['variables']
  now?: Date
}

/**
 * The workspace's `forkSyncNewWorkflowsExcluded` policy: whether a workflow created now
 * starts outside fork sync.
 *
 * `false` for an archived or missing workspace: a wrongly-synced workflow is visible and
 * fixable in the Forks list, while a wrongly-excluded one silently stops syncing.
 */
export async function readForkSyncNewWorkflowsExcluded(
  executor: DbOrTx,
  workspaceId: string
): Promise<boolean> {
  const [row] = await executor
    .select({ excluded: workspace.forkSyncNewWorkflowsExcluded })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  return row?.excluded ?? false
}

/**
 * The insert row for a genuinely new workflow - created, duplicated, imported, or seeded as
 * a starter - so every such path takes the workspace's fork-sync policy rather than the
 * column default. A fork or promote copy is not new and is written by
 * `copyWorkflowStateIntoTarget` instead.
 */
export async function buildNewWorkflowRow(executor: DbTransaction, input: NewWorkflowRowInput) {
  const workspace = await lockActiveWorkspace(executor, input.workspaceId)
  const now = input.now ?? new Date()
  return {
    id: input.id,
    userId: input.userId,
    workspaceId: input.workspaceId,
    folderId: input.folderId,
    name: input.name,
    description: input.description,
    sortOrder: input.sortOrder ?? 0,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
    isDeployed: false,
    runCount: 0,
    variables: input.variables ?? {},
    forkSyncExcluded: workspace.forkSyncNewWorkflowsExcluded,
  } satisfies typeof workflow.$inferInsert
}

/** Inserts the row {@link buildNewWorkflowRow} builds. */
export async function insertNewWorkflowRow(tx: DbTransaction, input: NewWorkflowRowInput) {
  await tx.insert(workflow).values(await buildNewWorkflowRow(tx, input))
}
