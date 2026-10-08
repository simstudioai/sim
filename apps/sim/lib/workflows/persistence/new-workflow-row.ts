import { workflow } from '@sim/db/schema'
import type { DbTransaction } from '@/lib/db/types'
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
 * The insert row for a genuinely new workflow - created, duplicated, imported, or seeded as
 * a starter - so every such path takes the workspace's fork-sync policy rather than the
 * column default. A fork or promote copy is not new and is written by
 * `copyWorkflowStateIntoTarget` instead. Share-locks the workspace and refuses an archived one.
 */
export async function buildNewWorkflowRow(executor: DbTransaction, input: NewWorkflowRowInput) {
  const target = await lockActiveWorkspace(executor, input.workspaceId)
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
    forkSyncExcluded: target.forkSyncNewWorkflowsExcluded,
  } satisfies typeof workflow.$inferInsert
}

export async function insertNewWorkflowRow(tx: DbTransaction, input: NewWorkflowRowInput) {
  await tx.insert(workflow).values(await buildNewWorkflowRow(tx, input))
}
