'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast/sink'
import { usePageCommands } from '@/app/(product)/_components/command-menu/page-commands'
import {
  DeployModal,
  type DeployTab,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/deploy/deploy-modal/deploy-modal'
import {
  apiKeysQueryOptions,
  useDeployment,
  useDeploymentViewState,
  useDeployReadiness,
  workflowMcpServersQueryOptions,
  workspaceSettingsQueryOptions,
} from '@/platform/lib/data/workflow-deploy'
import {
  isWorkflowEffectivelyLocked,
  useCurrentWorkflow,
  useFolderMap,
  useUserPermissionsContext,
  useWorkflowMap,
  useWorkflowRegistry,
} from '@/platform/lib/data/workflows'

interface DeployButtonProps {
  workspaceId: string
  workflowId: string
}

/**
 * The legacy editor's Deploy control: Deploy, Update or Live from one derived deployment verdict.
 * An undeployed workflow deploys on click (after the readiness wait and pre-deploy checks); a
 * deployed one opens the deployment modal. Search's "Deploy workflow" runs the same click.
 */
export function DeployButton({ workspaceId, workflowId }: DeployButtonProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<DeployTab>('general')
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const hydrationPhase = useWorkflowRegistry((state) => state.hydration.phase)
  const isRegistryLoading = hydrationPhase === 'idle' || hydrationPhase === 'state-loading'
  const { hasBlocks } = useCurrentWorkflow()
  const userPermissions = useUserPermissionsContext()
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const locked = isWorkflowEffectivelyLocked(workflows[workflowId] ?? null, folders)

  const deployReadiness = useDeployReadiness(activeWorkflowId)
  const deployment = useDeploymentViewState({
    workflowId: activeWorkflowId,
    enabled: !isRegistryLoading,
    deployReadiness,
  })
  const { status, isDeployed, isSettling } = deployment
  const { isDeploying, handleDeployClick } = useDeployment({
    workflowId: activeWorkflowId,
    isDeployed,
    deployReadiness,
  })

  const isEmpty = !hasBlocks()
  const canDeploy = userPermissions.canAdmin
  // A click means "open" when deployed and "deploy" when not, so an unknown status has no meaning.
  const isDisabled =
    locked ||
    isDeploying ||
    !canDeploy ||
    isEmpty ||
    status === 'unknown' ||
    (!isDeployed && deployReadiness.isBlocked && !deployReadiness.isSyncing)

  const reason = isEmpty
    ? 'Cannot deploy an empty workflow'
    : !canDeploy
      ? 'Admin permissions required'
      : locked
        ? 'Workflow is locked'
        : isDeploying
          ? 'Deploying…'
          : deployReadiness.isBlocked && !isDeployed
            ? deployReadiness.tooltip
            : 'Deployment status is still loading'

  const deploy = async () => {
    if (isRegistryLoading || isDisabled || !activeWorkflowId) return
    if (isSettling) {
      setOpen(true)
      return
    }
    const result = await handleDeployClick()
    if (result.shouldOpenModal) setOpen(true)
  }

  usePageCommands(
    canDeploy
      ? [
          {
            id: 'deploy-workflow',
            label: 'Deploy workflow',
            run: () => {
              if (isRegistryLoading || isDisabled) {
                toast({ message: isRegistryLoading ? 'Workflow is still loading' : reason })
                return
              }
              void deploy()
            },
          },
        ]
      : []
  )

  const prefetch = () => {
    if (isRegistryLoading || isDisabled) return
    void Promise.all([
      queryClient.prefetchQuery(apiKeysQueryOptions(workspaceId, 'combined')),
      queryClient.prefetchQuery(workspaceSettingsQueryOptions(workspaceId)),
      queryClient.prefetchQuery(workflowMcpServersQueryOptions(workspaceId)),
    ])
  }

  const label = isDeploying
    ? 'Deploying…'
    : status === 'changed'
      ? 'Update'
      : status === 'live'
        ? 'Live'
        : 'Deploy'

  return (
    <>
      <Button
        size='compact'
        render={<button type='button' onPointerEnter={prefetch} onFocus={prefetch} />}
        disabled={isRegistryLoading || isDisabled}
        disabledReason={isRegistryLoading ? 'Workflow is still loading' : reason}
        onClick={() => void deploy()}
      >
        {label}
      </Button>
      <DeployModal
        key={activeWorkflowId ?? 'no-workflow'}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setTab('general')
        }}
        tab={tab}
        onTabChange={setTab}
        workspaceId={workspaceId}
        workflowId={activeWorkflowId}
        deployment={deployment}
        deployReadiness={deployReadiness}
      />
    </>
  )
}
