import { useChangeDetection } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-change-detection'
import { useChangeDetectionCanary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-change-detection-canary'
import {
  type DeployButtonStatus,
  resolveDeployButtonStatus,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-button-status'
import type { DeployReadiness } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-readiness'
import { useDeployedWorkflowState, useDeploymentInfo } from '@/hooks/queries/deployments'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface DeploymentViewState {
  /** The single verdict every deploy surface renders from. */
  status: DeployButtonStatus
  isDeployed: boolean
  /** The active deployment's snapshot, or null while it is not in hand. */
  deployedState: WorkflowState | null
  /**
   * A snapshot is expected but has not arrived. Distinct from "there is no
   * snapshot": the difference is what separates a skeleton from telling the user
   * their workflow is not deployed.
   */
  isAwaitingSnapshot: boolean
  isSettling: boolean
  changeDetected: boolean
  changedFields: string[]
}

interface UseDeploymentViewStateProps {
  workflowId: string | null
  enabled: boolean
  deployReadiness: DeployReadiness
}

/**
 * Owns every derived answer the deploy surface renders — the chip's label, the
 * modal's preview, the modal's footer — so they cannot disagree.
 *
 * They used to. The chip resolved a status; the modal read raw `isDeployed` and
 * `needsRedeployment`; the General tab decided "not deployed" from the *absence
 * of a snapshot*. That last one is the defect that produced "Deploy your
 * workflow to see a preview" sitting directly above a row reading `v1 (live)`:
 * a missing snapshot is not evidence of anything, and rendering it as one made
 * the modal contradict itself.
 *
 * Which is the same failure this PR fixes one layer down — several derivations
 * of one fact, drifting — so it gets the same treatment: derive once, pass it
 * down, and give the surfaces no raw material to re-derive from.
 */
export function useDeploymentViewState({
  workflowId,
  enabled,
  deployReadiness,
}: UseDeploymentViewStateProps): DeploymentViewState {
  const { data: deploymentInfo } = useDeploymentInfo(workflowId, { enabled })
  /* Undefined covers both "still loading" and "the request failed". */
  const isDeploymentInfoResolved = deploymentInfo !== undefined
  const isDeployed = deploymentInfo?.isDeployed ?? false

  const snapshotEnabled = Boolean(workflowId) && isDeployed && enabled
  const { data: deployedStateData, isLoading: isLoadingDeployedState } = useDeployedWorkflowState(
    workflowId,
    { enabled: snapshotEnabled }
  )
  const deployedState = snapshotEnabled ? (deployedStateData ?? null) : null

  /*
   * `isLoading` (no snapshot yet), NOT `isFetching`. A background refetch — which
   * `refetchOnWindowFocus` fires on every focus — still has the cached snapshot
   * to compare against, so treating it as loading blanked the answer and pushed
   * an already-correct "Update" back through "Live" and out again.
   */
  const { changeDetected, changedFields, isChangeDetectionSettling } = useChangeDetection({
    workflowId,
    deployedState,
    isLoadingDeployedState,
  })

  const serverNeedsRedeployment = snapshotEnabled ? deploymentInfo?.needsRedeployment : undefined

  const status = resolveDeployButtonStatus({
    workflowId,
    isDeploymentInfoResolved,
    isDeployed,
    isAwaitingFirstDeployedState: isLoadingDeployedState,
    clientChangeDetected: changeDetected,
    hasDeployedState: deployedState !== null,
    serverNeedsRedeployment,
  })

  const isSettling = isChangeDetectionSettling || deployReadiness.isSyncing

  useChangeDetectionCanary({
    workflowId,
    clientChangeDetected: changeDetected,
    clientChangedFields: changedFields,
    serverNeedsRedeployment,
    isSettling: isSettling || deployedState === null,
    isSettled: deployReadiness.status === 'ready',
  })

  return {
    status,
    isDeployed,
    deployedState,
    /*
     * "We cannot show you the live workflow yet" covers both a snapshot in
     * flight and not knowing whether one exists. Neither is evidence the
     * workflow is undeployed, so neither may render as that claim.
     */
    isAwaitingSnapshot: status === 'unknown' || (snapshotEnabled && deployedState === null),
    isSettling,
    changeDetected,
    changedFields,
  }
}
