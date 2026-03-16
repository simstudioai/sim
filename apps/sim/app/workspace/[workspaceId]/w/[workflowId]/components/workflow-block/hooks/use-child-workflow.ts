import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useDeploymentInfo } from '@/hooks/queries/deployments'

/**
 * Return type for the useChildWorkflow hook
 */
export interface UseChildWorkflowReturn {
  /** The ID of the child workflow if configured */
  childWorkflowId: string | undefined
  /** Whether the child workflow is deployed */
  childIsDeployed: boolean | null
  /** Whether the child workflow needs redeployment due to changes */
  childNeedsRedeploy: boolean
  /** Whether the child deployment info is loading */
  isLoadingChildVersion: boolean
}

/**
 * Custom hook for managing child workflow information for workflow selector blocks.
 * Uses the shared useDeploymentInfo query — the same source of truth as the
 * editor header's Deploy button — for consistent deployment status detection.
 *
 * @param blockId - The ID of the block
 * @param blockType - The type of the block
 * @param isPreview - Whether the block is in preview mode
 * @param previewSubBlockValues - The subblock values in preview mode
 * @returns Child workflow configuration and deployment status
 */
export function useChildWorkflow(
  blockId: string,
  blockType: string,
  isPreview: boolean,
  previewSubBlockValues?: WorkflowBlockProps['subBlockValues']
): UseChildWorkflowReturn {
  const isWorkflowSelector = blockType === 'workflow' || blockType === 'workflow_input'

  const [workflowIdFromStore] = useSubBlockValue<string>(blockId, 'workflowId')

  let childWorkflowId: string | undefined

  if (!isPreview) {
    const val = workflowIdFromStore
    if (typeof val === 'string' && val.trim().length > 0) {
      childWorkflowId = val
    }
  } else if (isPreview && previewSubBlockValues?.workflowId?.value) {
    const val = previewSubBlockValues.workflowId.value
    if (typeof val === 'string' && val.trim().length > 0) {
      childWorkflowId = val
    }
  }

  const { data, isPending } = useDeploymentInfo(
    isWorkflowSelector ? (childWorkflowId ?? null) : null
  )

  const childIsDeployed = data?.isDeployed ?? null
  const childNeedsRedeploy = data?.needsRedeployment ?? false
  const isLoadingChildVersion = isPending

  return {
    childWorkflowId,
    childIsDeployed,
    childNeedsRedeploy,
    isLoadingChildVersion,
  }
}
