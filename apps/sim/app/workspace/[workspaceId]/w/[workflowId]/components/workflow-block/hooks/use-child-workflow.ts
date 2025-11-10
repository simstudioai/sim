import { useSubBlockValue } from '../../panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WorkflowBlockProps } from '../types'
import { useChildDeployment } from './use-child-deployment'

/**
 * Return type for the useChildWorkflow hook
 */
export interface UseChildWorkflowReturn {
  /** The ID of the child workflow if configured */
  childWorkflowId: string | undefined
  /** The active version of the child workflow */
  childActiveVersion: number | null
  /** Whether the child workflow is deployed */
  childIsDeployed: boolean | null
  /** Whether the child workflow needs redeployment due to changes */
  childNeedsRedeploy: boolean
  /** Whether the child version information is loading */
  isLoadingChildVersion: boolean
  /** Function to manually refetch deployment status */
  refetchDeployment: () => void
}

/**
 * Custom hook for managing child workflow information for workflow selector blocks
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

  const {
    activeVersion: childActiveVersion,
    isDeployed: childIsDeployed,
    needsRedeploy: childNeedsRedeploy,
    isLoading: isLoadingChildVersion,
    refetch: refetchDeployment,
  } = useChildDeployment(isWorkflowSelector ? childWorkflowId : undefined)

  return {
    childWorkflowId,
    childActiveVersion,
    childIsDeployed,
    childNeedsRedeploy,
    isLoadingChildVersion,
    refetchDeployment,
  }
}
