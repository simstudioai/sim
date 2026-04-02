import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface DeploymentVersionStateResponse {
  deployedState: WorkflowState
}

/**
 * Fetches the deployed state for a specific deployment version.
 */
export async function fetchDeploymentVersionState(
  workflowId: string,
  version: number,
  signal?: AbortSignal
): Promise<WorkflowState> {
  const response = await fetch(`/api/workflows/${workflowId}/deployments/${version}`, { signal })

  if (!response.ok) {
    throw new Error(`Failed to fetch deployment version: ${response.statusText}`)
  }

  const data: DeploymentVersionStateResponse = await response.json()
  if (!data.deployedState) {
    throw new Error('No deployed state returned')
  }

  return data.deployedState
}
