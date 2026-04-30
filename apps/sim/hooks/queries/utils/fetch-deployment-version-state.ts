import { requestJson } from '@/lib/api/client/request'
import { getDeploymentVersionStateContract } from '@/lib/api/contracts/deployments'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Fetches the deployed state for a specific deployment version.
 */
export async function fetchDeploymentVersionState(
  workflowId: string,
  version: number,
  signal?: AbortSignal
): Promise<WorkflowState> {
  const data = await requestJson(getDeploymentVersionStateContract, {
    params: { id: workflowId, version },
    signal,
  })
  if (!data.deployedState) {
    throw new Error('No deployed state returned')
  }

  return data.deployedState
}
