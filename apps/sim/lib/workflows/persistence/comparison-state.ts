import type { DbOrTx } from '@sim/workflow-persistence/types'
import { materializeDeploymentState } from '@/lib/workflows/persistence/utils'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Materializes an immutable version for comparison without caching live credential mappings. */
export async function materializeWorkflowComparisonState(
  workflowId: string,
  version: { id: string; state: unknown },
  workspaceId: string,
  executor?: DbOrTx
): Promise<WorkflowState> {
  const data = await materializeDeploymentState(workflowId, version, workspaceId, executor, {
    cache: false,
  })
  return {
    blocks: data.blocks,
    edges: data.edges,
    loops: data.loops,
    parallels: data.parallels,
    variables: parseWorkflowVariables(data.variables) ?? {},
    lastSaved: 0,
  }
}
