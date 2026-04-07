import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useDeploymentInfo } from '@/hooks/queries/deployments'

export interface UseChildWorkflowReturn {
  childWorkflowId: string | undefined
  childIsDeployed: boolean | null
  childNeedsRedeploy: boolean
  isLoadingChildVersion: boolean
}

/**
 * Manages child workflow deployment status for workflow selector blocks.
 * Uses useDeploymentInfo which computes needsRedeployment server-side via
 * hasWorkflowChanged — the same comparison the deploy button uses — so the
 * badge stays aligned with the child workflow's Live/Update header.
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
    isWorkflowSelector ? (childWorkflowId ?? null) : null,
    { refetchOnMount: 'always' }
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
