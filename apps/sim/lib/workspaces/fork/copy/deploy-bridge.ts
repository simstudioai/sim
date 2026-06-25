import { db, runOutsideTransactionContext } from '@sim/db'
import { workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import type { Variable, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkspaceForkDeployBridge')

export interface DeployedWorkflowSummary {
  id: string
  name: string
  description: string | null
  folderId: string | null
  sortOrder: number
}

/** Workflows in a workspace that are deployed and not archived - the only ones that fork/promote. */
export async function listDeployedWorkflows(
  executor: DbOrTx,
  workspaceId: string
): Promise<DeployedWorkflowSummary[]> {
  return executor
    .select({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      folderId: workflow.folderId,
      sortOrder: workflow.sortOrder,
    })
    .from(workflow)
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt)
      )
    )
}

/** The active deployment version number for a workflow, or null when it has none. */
export async function getActiveDeploymentVersionNumber(
  executor: DbOrTx,
  workflowId: string
): Promise<number | null> {
  const [row] = await executor
    .select({ version: workflowDeploymentVersion.version })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)
  return row?.version ?? null
}

/**
 * Read a workflow's active deployed state as a `WorkflowState`. Returns null ONLY
 * when the workflow genuinely has no active deployment (a legitimate skip); real
 * DB/migration errors propagate so the caller fails loudly instead of silently
 * dropping the workflow from the fork/promote. Block migrations (credential remap
 * to current ids) are applied so copied references reflect current resources.
 */
export async function readDeployedState(
  workflowId: string,
  workspaceId: string
): Promise<WorkflowState | null> {
  // This reads the (unchanged) SOURCE workspace on the global pool. Callers like
  // promote run it inside their transaction, so escape the tx context: the read
  // must not join the promote's transaction (and the tripwire forbids global-pool
  // queries inside a tx). Outside a transaction this is a no-op.
  return runOutsideTransactionContext(async () => {
    const version = await getActiveDeploymentVersionNumber(db, workflowId)
    if (version == null) {
      logger.warn('No active deployment for workflow during fork/promote', { workflowId })
      return null
    }
    const data = await loadDeployedWorkflowState(workflowId, workspaceId)
    return {
      blocks: data.blocks,
      edges: data.edges,
      loops: data.loops,
      parallels: data.parallels,
      variables: (data.variables ?? {}) as Record<string, Variable>,
    }
  })
}
