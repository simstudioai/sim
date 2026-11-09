'use client'

import { type ComponentProps, useEffect, useRef, useState } from 'react'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { InlineNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { toError } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { CreateApiKeyModal } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/create-api-key-modal/create-api-key-modal'
import { ApiInfoModal } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/api-tab/api-info-modal'
import { ApiTab } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/api-tab/api-tab'
import { ChatTab } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/chat-tab/chat-tab'
import { useChatDeploy } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/chat-tab/use-chat-deploy'
import { CompareVersions } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/compare-versions'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/deploy-modal/deploy-modal.module.css'
import { DeployStatus } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/deploy-modal/deploy-status'
import { CreateMcpServerModal } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/mcp-tab/create-mcp-server-modal'
import { McpTab } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/mcp-tab/mcp-tab'
import { useMcpTool } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/mcp-tab/use-mcp-tool'
import { VersionDescription } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/version-description/version-description'
import { Versions } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/versions/versions'
import {
  type ComparePair,
  type DeploymentViewState,
  type DeployReadiness,
  formatVersionLabel,
  invalidateDeploymentQueries,
  mergeSubblockState,
  normalizeName,
  releaseDeployAction,
  resolveComparePair,
  runPreDeployChecks,
  startsWithUuid,
  syncLocalDraftFromServer,
  tryAcquireDeployAction,
  useActivateDeploymentVersion,
  useApiKeys,
  useChatDeploymentInfo,
  useDeploymentInfo,
  useDeploymentVersions,
  useDeployWorkflow,
  useRevertToVersion,
  useSettingsNavigation,
  useUndeployWorkflow,
  useWorkflowMcpServers,
  useWorkspaceSettings,
} from '@/platform/lib/data/workflow-deploy'
import {
  createLogger,
  useDeploymentShape,
  usePermissionConfig,
  useUserPermissionsContext,
  useWorkflowMap,
  useWorkflowRegistry,
  useWorkflowStore,
} from '@/platform/lib/data/workflows'
import { toast } from '@/platform/shared/toast'

const logger = createLogger('DeployModal')

/** The dialog's tabs, in legacy order. */
export type DeployTab = 'general' | 'api' | 'mcp' | 'chat'

const DEPLOY_TABS: readonly DeployTab[] = ['general', 'api', 'mcp', 'chat']

/** Whether an `open-deploy-modal` event named one of the dialog's tabs. */
export function isDeployTab(value: unknown): value is DeployTab {
  return DEPLOY_TABS.some((tab) => tab === value)
}

type FooterStartAction = ComponentProps<typeof Modal>['footerStartAction']

interface DeployModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: DeployTab
  onTabChange: (tab: DeployTab) => void
  workspaceId: string
  workflowId: string | null
  /** The one derived deployment verdict, shared with the Deploy button. */
  deployment: DeploymentViewState
  deployReadiness: DeployReadiness
}

/**
 * The deployment dialog: General (deploy, update, undeploy and the versions), API, MCP and Chat,
 * each with its own footer actions. It mounts only while open, so closing resets every draft and
 * abandons an in-flight deploy's follow-ups, as legacy's close did.
 */
export function DeployModal(props: DeployModalProps) {
  if (!props.open || !props.workflowId) return null
  return (
    <DeployDialog
      open
      onOpenChange={props.onOpenChange}
      tab={props.tab}
      onTabChange={props.onTabChange}
      workspaceId={props.workspaceId}
      workflowId={props.workflowId}
      deployment={props.deployment}
      deployReadiness={props.deployReadiness}
    />
  )
}

interface VersionTarget {
  workflowId: string
  version: number
}

function DeployDialog({
  onOpenChange,
  tab,
  onTabChange,
  workspaceId,
  workflowId,
  deployment,
  deployReadiness,
}: DeployModalProps & { workflowId: string }) {
  const { status, isDeployed, deployedState, isAwaitingSnapshot, isSettling } = deployment
  const needsRedeployment = status === 'changed'
  const queryClient = useQueryClient()
  const { navigateToSettings } = useSettingsNavigation()
  const { chatEnabled } = useDeploymentShape()
  const userPermissions = useUserPermissionsContext()
  const { config: permissionConfig, isPublicApiDisabled } = usePermissionConfig()
  const { data: workflowMap = {} } = useWorkflowMap(workspaceId)
  const workflow = workflowMap[workflowId]

  const [deployError, setDeployError] = useState<string | null>(null)
  const [isFinalizingDeploy, setIsFinalizingDeploy] = useState(false)
  const [isActivatingVersion, setIsActivatingVersion] = useState(false)
  const [undeploying, setUndeploying] = useState(false)
  const [describing, setDescribing] = useState<number | null>(null)
  const [comparing, setComparing] = useState<ComparePair | null>(null)
  const [loadTarget, setLoadTarget] = useState<VersionTarget | null>(null)
  const [promoteTarget, setPromoteTarget] = useState<VersionTarget | null>(null)
  const [creatingKey, setCreatingKey] = useState(false)
  const [editingApiInfo, setEditingApiInfo] = useState(false)
  const [creatingServer, setCreatingServer] = useState(false)
  const [streamingOutputs, setStreamingOutputs] = useState<string[]>([])
  const deployActionId = useRef(0)
  const activateInFlight = useRef(false)

  const visibleTabs: { id: DeployTab; label: string }[] = [
    { id: 'general', label: 'General' },
    ...(permissionConfig.hideDeployApi ? [] : [{ id: 'api' as const, label: 'API' }]),
    ...(permissionConfig.hideDeployMcp ? [] : [{ id: 'mcp' as const, label: 'MCP' }]),
    ...(chatEnabled && !permissionConfig.hideDeployChatbot
      ? [{ id: 'chat' as const, label: 'Chat' }]
      : []),
  ]
  const current: DeployTab = visibleTabs.some((entry) => entry.id === tab) ? tab : 'general'

  const { data: apiKeys, isLoading: isLoadingKeys } = useApiKeys(workspaceId, 'combined')
  const { data: workspaceSettings, isLoading: isLoadingSettings } =
    useWorkspaceSettings(workspaceId)
  const allowPersonalApiKeys = workspaceSettings?.settings?.workspace?.allowPersonalApiKeys ?? true
  const canManageWorkspaceKeys = userPermissions.canAdmin
  const createKeyDisabled =
    isLoadingKeys || isLoadingSettings || (!allowPersonalApiKeys && !canManageWorkspaceKeys)

  const { data: deploymentInfo, isLoading: isLoadingDeploymentInfo } = useDeploymentInfo(workflowId)
  const { data: versionsData } = useDeploymentVersions(workflowId)
  const versions = versionsData?.versions ?? []
  const chatInfo = useChatDeploymentInfo(workflowId)
  const { data: mcpServers = [] } = useWorkflowMcpServers(workspaceId)

  const deployMutation = useDeployWorkflow()
  const undeployMutation = useUndeployWorkflow()
  const activateMutation = useActivateDeploymentVersion()
  const revertMutation = useRevertToVersion()

  const attemptStatus = deploymentInfo?.latestDeploymentAttempt?.status
  const attemptError =
    deploymentInfo?.latestDeploymentAttempt?.error?.message ??
    (attemptStatus === 'failed' ? 'Deployment preparation failed' : null)

  const isStillActive = (id: string) => useWorkflowRegistry.getState().activeWorkflowId === id

  const chat = useChatDeploy({
    workflowId,
    existingChat: chatInfo.existingChat ?? null,
    isLoadingChat: chatInfo.isLoading,
    refetchChat: chatInfo.refetch,
    onDeployed: () => void invalidateDeploymentQueries(queryClient, workflowId),
    onDeleted: () => onOpenChange(false),
  })
  const mcpTool = useMcpTool({
    workspaceId,
    workflowId,
    workflowName: workflow?.name || 'Workflow',
    workflowDescription: workflow?.description,
    deployedState,
    isLoadingDeployedState: isAwaitingSnapshot,
  })

  // An open abandons any deploy whose follow-ups were still in flight, and prunes streamed outputs
  // whose block is gone.
  useEffect(() => {
    const blocks = Object.values(useWorkflowStore.getState().blocks)
    setStreamingOutputs((outputs) =>
      outputs.filter((outputId) => {
        if (startsWithUuid(outputId)) {
          const underscore = outputId.indexOf('_')
          return (
            underscore !== -1 && blocks.some((block) => block.id === outputId.slice(0, underscore))
          )
        }
        const [blockName, ...path] = outputId.split('.')
        if (path.length === 0) return true
        return blocks.some(
          (block) => block.name && normalizeName(block.name) === blockName.toLowerCase()
        )
      })
    )
    return () => {
      deployActionId.current += 1
      releaseDeployAction(workflowId)
    }
  }, [workflowId])

  /** Post-activation warnings ride an `active` attempt, so the Live state alone would hide them. */
  const toastWarnings = (
    title: string,
    result: { latestDeploymentAttempt?: { status: string } | null; warnings?: string[] }
  ) => {
    if (result.latestDeploymentAttempt?.status !== 'active' || !result.warnings?.length) return
    toast.warning(title, { description: result.warnings.join(' ') })
  }

  const syncDraft = async () => {
    try {
      await syncLocalDraftFromServer(workflowId)
    } catch (error) {
      if (!isStillActive(workflowId)) return
      logger.warn('Workflow deployed, but local draft sync failed', {
        workflowId,
        error: toError(error).message,
      })
    }
  }

  /** Deploys or redeploys after the readiness wait; a redeploy runs the pre-deploy checks first. */
  const deploy = async (redeploy: boolean) => {
    if (!tryAcquireDeployAction(workflowId)) return
    const actionId = deployActionId.current + 1
    deployActionId.current = actionId
    setIsFinalizingDeploy(true)
    setDeployError(null)
    try {
      if (!(await deployReadiness.waitUntilReady())) {
        if (isStillActive(workflowId) && deployActionId.current === actionId)
          setDeployError(deployReadiness.tooltip)
        return
      }
      if (!isStillActive(workflowId) || deployActionId.current !== actionId) return
      if (redeploy) {
        const { blocks, edges, loops, parallels } = useWorkflowStore.getState()
        const check = runPreDeployChecks({
          blocks: mergeSubblockState(blocks, workflowId),
          edges,
          loops,
          parallels,
          workflowId,
        })
        if (!check.passed) {
          setDeployError(check.error || 'Pre-deploy validation failed')
          return
        }
      }
      const result = await deployMutation.mutateAsync({ workflowId })
      if (result.latestDeploymentAttempt?.status === 'active') await syncDraft()
      if (isStillActive(workflowId))
        toastWarnings(redeploy ? 'Workflow redeployed' : 'Workflow deployed', result)
    } catch (error) {
      if (deployActionId.current !== actionId || !isStillActive(workflowId)) return
      logger.error(redeploy ? 'Error redeploying workflow' : 'Error deploying workflow', {
        error,
      })
      setDeployError(
        toError(error).message ||
          (redeploy ? 'Failed to redeploy workflow' : 'Failed to deploy workflow')
      )
    } finally {
      releaseDeployAction(workflowId)
      if (deployActionId.current === actionId) setIsFinalizingDeploy(false)
    }
  }

  const promote = async (version: number) => {
    if (activateInFlight.current) return
    activateInFlight.current = true
    setIsActivatingVersion(true)
    setDeployError(null)
    try {
      const result = await activateMutation.mutateAsync({ workflowId, version })
      if (isStillActive(workflowId)) toastWarnings(`Promoted v${version} to live`, result)
    } catch (error) {
      if (!isStillActive(workflowId)) return
      logger.error('Error promoting version', { error })
      setDeployError(toError(error).message || `Failed to promote v${version} to live`)
    } finally {
      activateInFlight.current = false
      setIsActivatingVersion(false)
    }
  }

  const loadDeployment = async (target: VersionTarget) => {
    if (!(await deployReadiness.waitUntilReady())) {
      if (isStillActive(target.workflowId)) setDeployError(deployReadiness.tooltip)
      return
    }
    if (!isStillActive(target.workflowId)) return
    await revertMutation.mutateAsync({ workflowId: target.workflowId, version: target.version })
    onOpenChange(false)
  }

  const undeploy = async () => {
    if (!isStillActive(workflowId)) return
    try {
      const result = await undeployMutation.mutateAsync({ workflowId })
      if (!isStillActive(workflowId)) return
      onOpenChange(false)
      // Teardown left to background retries surfaces here, so closing the dialog hides nothing.
      if (result.warnings?.length)
        toast.warning('Workflow undeployed', { description: result.warnings.join(' ') })
    } catch (error) {
      logger.error('Error undeploying workflow', { error })
      throw new Error(`Failed to undeploy workflow: ${toError(error).message}`)
    }
  }

  const versionLabel = (version: number) => {
    const entry = versions.find((candidate) => candidate.version === version)
    return entry ? formatVersionLabel(entry.version, entry.name) : `v${version}`
  }

  const isSubmitting = deployMutation.isPending || isFinalizingDeploy
  const isUndeploying = undeployMutation.isPending
  const deployBlocked = deployReadiness.isBlocked || isSettling || isSubmitting || isUndeploying
  const blockedMessage =
    deployReadiness.isBlocked && !deployReadiness.isSyncing && !isSubmitting && !isUndeploying
      ? deployReadiness.tooltip
      : null
  const undeployAction: FooterStartAction = {
    label: isUndeploying ? 'Undeploying…' : 'Undeploy',
    variant: 'quiet',
    destructive: true,
    disabled: isUndeploying || isSubmitting,
    onClick: () => setUndeploying(true),
  }

  const footer = ((): {
    confirmLabel?: string
    confirmDisabled?: boolean
    start?: FooterStartAction
    onConfirm?: () => unknown
  } => {
    switch (current) {
      case 'general':
        if (!isDeployed)
          return {
            confirmLabel: isSubmitting ? 'Deploying…' : 'Deploy',
            confirmDisabled: deployBlocked,
            onConfirm: async () => {
              await deploy(false)
              return false
            },
          }
        if (needsRedeployment || isSettling)
          return {
            confirmLabel: isSubmitting ? 'Updating…' : 'Update',
            confirmDisabled: deployBlocked,
            start: undeployAction,
            onConfirm: async () => {
              await deploy(true)
              return false
            },
          }
        return { start: undeployAction }
      case 'api':
        return {
          confirmLabel: 'Generate API key',
          confirmDisabled: createKeyDisabled,
          start: {
            label: 'Edit API info',
            variant: 'quiet',
            onClick: () => setEditingApiInfo(true),
          },
          onConfirm: () => {
            setCreatingKey(true)
            return false
          },
        }
      case 'chat':
        return {
          confirmLabel: chat.actionLabel,
          confirmDisabled: chat.submitting || !chat.isValid,
          start: chat.chatExists
            ? {
                label: 'Delete',
                variant: 'quiet',
                destructive: true,
                disabled: chat.submitting,
                onClick: () => chat.setConfirmingDelete(true),
              }
            : undefined,
          onConfirm: () => {
            void chat.submit()
            return false
          },
        }
      case 'mcp':
        if (!isDeployed || mcpServers.length === 0) return {}
        return {
          confirmLabel: mcpTool.submitting ? 'Saving…' : 'Save tool',
          confirmDisabled: mcpTool.submitting || !mcpTool.canSave,
          start: {
            label: 'Manage',
            variant: 'quiet',
            onClick: () =>
              navigateToSettings({
                section: 'workflow-mcp-servers',
                mcpServerId: mcpTool.activeServerId ?? undefined,
              }),
          },
          onConfirm: async () => {
            await mcpTool.save()
            return false
          },
        }
    }
  })()

  return (
    <>
      <Modal
        open
        onOpenChange={(next) => {
          if (!next) onOpenChange(false)
        }}
        title='Workflow deployment'
        cancelLabel='Close'
        confirmLabel={footer.confirmLabel}
        confirmDisabled={footer.confirmDisabled}
        footerStartAction={footer.start}
        onConfirm={footer.onConfirm}
        submitOnEnter={current === 'chat' || current === 'mcp'}
      >
        <ContentTabs
          label='Deployment settings'
          current={current}
          onSelect={(next) => {
            if (isDeployTab(next)) onTabChange(next)
          }}
          actions={
            <DeployStatus
              isDeployed={isDeployed}
              needsRedeployment={needsRedeployment}
              attemptStatus={attemptStatus}
              attemptError={attemptError}
            />
          }
          items={visibleTabs.map((entry) => ({
            id: entry.id,
            label: entry.label,
            content: (
              <div className={styles.pane}>
                {entry.id === 'general' && (
                  <>
                    {deployError && <InlineNotice intent='danger' message={deployError} />}
                    {blockedMessage && <InlineNotice intent='warning' message={blockedMessage} />}
                    {versions.length > 0 ? (
                      <Versions
                        workflowId={workflowId}
                        versions={versions}
                        isPromotingVersion={isActivatingVersion || activateMutation.isPending}
                        onDescribe={setDescribing}
                        onCompare={(version) => setComparing(resolveComparePair(version, versions))}
                        onPromote={(version) => setPromoteTarget({ workflowId, version })}
                        onLoad={(version) => setLoadTarget({ workflowId, version })}
                      />
                    ) : (
                      versionsData && (
                        <p className={styles.empty} data-type='T060'>
                          No deployments yet
                        </p>
                      )
                    )}
                  </>
                )}
                {entry.id === 'api' && (
                  <ApiTab
                    workflowId={workflowId}
                    isDeployed={Boolean(deploymentInfo?.isDeployed)}
                    isLoading={isLoadingDeploymentInfo}
                    isPublicApi={isPublicApiDisabled ? false : Boolean(deploymentInfo?.isPublicApi)}
                    selectedOutputs={streamingOutputs}
                    onSelectedOutputsChange={setStreamingOutputs}
                  />
                )}
                {entry.id === 'mcp' && (
                  <McpTab
                    workspaceId={workspaceId}
                    workflowId={workflowId}
                    isDeployed={isDeployed}
                    isLoadingDeployedState={isAwaitingSnapshot}
                    hasDeployedState={deployedState !== null}
                    tool={mcpTool}
                    onCreateServer={() => setCreatingServer(true)}
                  />
                )}
                {entry.id === 'chat' && !chatInfo.isLoading && (
                  <ChatTab
                    workflowId={workflowId}
                    chat={chat}
                    canRevealPassword={userPermissions.canAdmin}
                  />
                )}
              </div>
            ),
          }))}
        />
      </Modal>

      <ConfirmDialog
        target={undeploying}
        onClose={() => setUndeploying(false)}
        title='Undeploy workflow?'
        description='This removes the API endpoint and makes it unavailable to external users.'
        confirmLabel='Undeploy'
        pendingLabel='Undeploying…'
        onConfirm={undeploy}
      />
      <ConfirmDialog
        target={loadTarget}
        onClose={() => setLoadTarget(null)}
        title='Load deployment?'
        description={(target) =>
          `Load ${versionLabel(target.version)}? This replaces your current workflow with the deployed version.`
        }
        confirmLabel='Load deployment'
        pendingLabel='Loading…'
        onConfirm={loadDeployment}
      />
      <ConfirmDialog
        target={promoteTarget}
        onClose={() => setPromoteTarget(null)}
        title='Promote to live?'
        description={(target) =>
          `Promote ${versionLabel(target.version)} to live? It becomes the active deployment and serves all API requests.`
        }
        confirmLabel='Promote to live'
        pendingLabel='Promoting…'
        safe
        onConfirm={(target) => {
          if (!isStillActive(target.workflowId)) return
          return promote(target.version)
        }}
      />
      <ConfirmDialog
        target={chat.confirmingPassword}
        onClose={() => chat.setConfirmingPassword(false)}
        title='Change deployment password?'
        description='Are you sure you want to change the password for this deployment?'
        confirmLabel='Change password and redeploy'
        pendingLabel='Updating…'
        safe
        onConfirm={() => {
          chat.setConfirmingPassword(false)
          return chat.submit(true)
        }}
      />
      <ConfirmDialog
        target={chat.confirmingDelete}
        onClose={() => chat.setConfirmingDelete(false)}
        title='Delete chat?'
        description={`This removes the chat at ${chat.liveUrl ?? 'its URL'} and makes it unavailable to everyone. This cannot be undone.`}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={chat.remove}
      />
      {describing !== null && (
        <VersionDescription
          key={describing}
          workflowId={workflowId}
          version={describing}
          versionLabel={versionLabel(describing)}
          currentDescription={versions.find((entry) => entry.version === describing)?.description}
          onClose={() => setDescribing(null)}
        />
      )}
      {comparing && (
        <CompareVersions
          key={JSON.stringify(comparing)}
          workflowId={workflowId}
          versions={versions}
          initial={comparing}
          onClose={() => setComparing(null)}
        />
      )}
      {creatingKey && (
        <CreateApiKeyModal
          workspaceId={workspaceId}
          existingKeyNames={[
            ...(apiKeys?.workspaceKeys ?? []),
            ...(apiKeys?.personalKeys ?? []),
          ].map((key) => key.name)}
          allowPersonalApiKeys={allowPersonalApiKeys}
          canManageWorkspaceKeys={canManageWorkspaceKeys}
          defaultKeyType={allowPersonalApiKeys ? 'personal' : 'workspace'}
          source='deploy_modal'
          onClose={() => setCreatingKey(false)}
        />
      )}
      {editingApiInfo && (
        <ApiInfoModal
          workspaceId={workspaceId}
          workflowId={workflowId}
          onClose={() => setEditingApiInfo(false)}
        />
      )}
      {creatingServer && (
        <CreateMcpServerModal
          workspaceId={workspaceId}
          canChangeVisibility={userPermissions.canAdmin}
          onClose={() => setCreatingServer(false)}
        />
      )}
    </>
  )
}
