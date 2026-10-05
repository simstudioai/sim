import { workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'

/** Transactional resource creation holds this row through insertion so archival cannot overtake it. */
export async function lockActiveWorkspace(executor: DbOrTx, workspaceId: string) {
  const [record] = await executor
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
