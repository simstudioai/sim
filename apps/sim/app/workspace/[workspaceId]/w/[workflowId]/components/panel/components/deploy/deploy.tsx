'use client'

import { type MouseEvent, useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { DeployPopover } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/deploy-modal'
import {
  useDeployment,
  useDeploymentViewState,
  useDeployReadiness,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { apiKeysQueryOptions } from '@/hooks/queries/api-keys'
import { workflowMcpServersQueryOptions } from '@/hooks/queries/workflow-mcp-servers'
import { workspaceSettingsQueryOptions } from '@/hooks/queries/workspace'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface DeployProps {
  activeWorkflowId: string | null
  userPermissions: WorkspaceUserPermissions
  disabled?: boolean
}

export function Deploy({ activeWorkflowId, userPermissions, disabled = false }: DeployProps) {
  const queryClient = useQueryClient()
  const params = useParams()
  const workspaceId = params.workspaceId as string | undefined
  const [isDeployPopoverOpen, setIsDeployPopoverOpen] = useState(false)
  const hydrationPhase = useWorkflowRegistry((state) => state.hydration.phase)
  const isRegistryLoading = hydrationPhase === 'idle' || hydrationPhase === 'state-loading'
  const { hasBlocks } = useCurrentWorkflow()

  const deployReadiness = useDeployReadiness(activeWorkflowId)

  /*
   * One derivation for the chip, the modal preview and the modal footer. They
   * previously each read their own mix of raw flags, which is how the preview
   * could say "Deploy your workflow to see a preview" while the version list
   * beneath it said `v1 (live)`.
   */
  const deployment = useDeploymentViewState({
    workflowId: activeWorkflowId,
    enabled: !isRegistryLoading,
    deployReadiness,
  })
  const { status: buttonStatus, isDeployed, deployedState } = deployment
  const isDeploymentSettling = deployment.isSettling

  const { isDeploying, handleDeployClick } = useDeployment({
    workflowId: activeWorkflowId,
    isDeployed,
    deployReadiness,
  })

  const isEmpty = !hasBlocks()
  const canDeploy = userPermissions.canAdmin
  const isDisabled =
    disabled ||
    isDeploying ||
    !canDeploy ||
    isEmpty ||
    /*
     * A click is interpreted against `isDeployed`: deployed opens the modal,
     * undeployed deploys. While that is unknown the click has no defined
     * meaning, and guessing "undeployed" would turn a failed info read into an
     * unintended new version.
     */
    buttonStatus === 'unknown' ||
    (!isDeployed && deployReadiness.isBlocked && !deployReadiness.isSyncing)

  const onDeployClick = async (event?: MouseEvent<HTMLButtonElement>) => {
    if (isRegistryLoading || isDisabled || !activeWorkflowId) return

    if (isDeployed || isDeploymentSettling) {
      if (!event) setIsDeployPopoverOpen(true)
      return
    }

    event?.preventDefault()
    const result = await handleDeployClick()
    if (result.shouldOpenModal) {
      setIsDeployPopoverOpen(true)
    }
  }

  useRegisterGlobalCommands(() => [
    {
      id: 'deploy-workflow',
      handler: () => {
        /* The palette can't render a disabled state for this action yet, so a
           gated invocation reports the same reason the button's tooltip shows. */
        if (isRegistryLoading || isDisabled) {
          toast({ message: isRegistryLoading ? 'Workflow is still loading' : getTooltipText() })
          return
        }
        void onDeployClick()
      },
    },
  ])

  const getTooltipText = () => {
    if (isEmpty) {
      return 'Cannot deploy an empty workflow'
    }
    if (!canDeploy) {
      return 'Admin permissions required'
    }
    if (disabled) {
      return 'Workflow is locked'
    }
    if (isDeploying) {
      return 'Deploying...'
    }
    if (isDeploymentSettling) {
      return 'Syncing deployment state...'
    }
    if (deployReadiness.isBlocked && !isDeployed) {
      return deployReadiness.tooltip
    }
    if (buttonStatus === 'changed') {
      return 'Update deployment'
    }
    if (buttonStatus === 'live') {
      return 'Active deployment'
    }
    return 'Deploy workflow'
  }

  const getButtonLabel = () => {
    /*
     * The label carries the busy state, matching every sibling control on this
     * surface (`{isUndeploying ? 'Undeploying...' : 'Undeploy'}` in the modal
     * footer) and the vocabulary `deployReadiness` already speaks. This chip was
     * the one button that announced nothing and merely went disabled.
     *
     * Scoped to the deploy action, which is bounded by the mutation. The
     * readiness states are deliberately NOT surfaced here: `saving` fires on
     * every settled keystroke, so rendering it would reintroduce exactly the
     * label churn this state machine exists to remove. Those stay in the
     * tooltip, where they explain why the button is disabled.
     */
    if (isDeploying) {
      return 'Deploying...'
    }

    switch (buttonStatus) {
      case 'changed':
        return 'Update'
      case 'live':
        return 'Live'
      /*
       * Only reachable before we know the workflow is deployed, so "Deploy" is
       * the answer rather than a guess we would have to take back.
       */
      default:
        return 'Deploy'
    }
  }

  const prefetchDeployModal = () => {
    if (!workspaceId || isRegistryLoading || isDisabled) return
    void Promise.all([
      queryClient.prefetchQuery(apiKeysQueryOptions(workspaceId, 'combined')),
      queryClient.prefetchQuery(workspaceSettingsQueryOptions(workspaceId)),
      queryClient.prefetchQuery(workflowMcpServersQueryOptions(workspaceId)),
    ])
  }

  return (
    <DeployPopover
      open={isDeployPopoverOpen}
      onOpenChange={setIsDeployPopoverOpen}
      workflowId={activeWorkflowId}
      isDeployed={isDeployed}
      needsRedeployment={deployment.changeDetected}
      deployedState={deployedState}
      isLoadingDeployedState={deployment.isAwaitingSnapshot}
      deployReadiness={deployReadiness}
      isDeploymentSettling={isDeploymentSettling}
      trigger={
        <Chip
          variant='border'
          onClick={onDeployClick}
          onMouseEnter={prefetchDeployModal}
          onFocus={prefetchDeployModal}
          disabled={isRegistryLoading || isDisabled}
          title={getTooltipText()}
        >
          {getButtonLabel()}
        </Chip>
      }
    />
  )
}
