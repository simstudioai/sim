import { workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'

/**
 * Transactional resource creation and restore hold this row through the write so
 * archival cannot overtake it.
 */
export async function lockActiveWorkspace(tx: DbTransaction, workspaceId: string) {
  const [record] = await tx
    .select({
      archivedAt: workspace.archivedAt,
      forkSyncNewWorkflowsExcluded: workspace.forkSyncNewWorkflowsExcluded,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .for('share')
    .limit(1)
  if (!record || record.archivedAt) throw new OrchestrationError('not_found', 'Workspace not found')
  return record
}
