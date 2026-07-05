'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  ChipConfirmModal,
  Loader,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
  Tooltip,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getInputFormatExample as getInputFormatExampleUtil } from '@/lib/workflows/operations/deployment-utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { CreateApiKeyModal } from '@/app/workspace/[workspaceId]/settings/components/api-keys/components'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  releaseDeployAction,
  tryAcquireDeployAction,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/deploy-action-lock'
import { syncLocalDraftFromServer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/sync-local-draft'
import type { DeployReadiness } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-readiness'
import { runPreDeployChecks } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-predeploy-checks'
import { normalizeName, startsWithUuid } from '@/executor/constants'
import { useApiKeys } from '@/hooks/queries/api-keys'
import { useCanPublishCustomBlock } from '@/hooks/queries/custom-blocks'
import {
  invalidateDeploymentQueries,
  useActivateDeploymentVersion,
  useChatDeploymentInfo,
  useDeploymentInfo,
  useDeploymentVersions,
  useDeployWorkflow,
  useUndeployWorkflow,
} from '@/hooks/queries/deployments'
import { useWorkflowMcpServers } from '@/hooks/queries/workflow-mcp-servers'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useWorkspaceOwnerBilling, useWorkspaceSettings } from '@/hooks/queries/workspace'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  ApiDeploy,
  BlockDeploy,
  ChatDeploy,
  DeployUpgradeGate,
  type ExistingChat,
  GeneralDeploy,
  McpDeploy,
} from './components'
import { ApiInfoModal } from './components/general/components/api-info-modal'

const logger = createLogger('DeployModal')

/** Renders the upgrade prompt in place of a programmatic-deploy tab when gated. */
function GatedTabContent({
  gated,
  feature,
  children,
}: {
  gated: boolean
  feature: 'API' | 'MCP'
  children: ReactNode
}) {
  return gated ? <DeployUpgradeGate feature={feature} /> : <>{children}</>
}

interface DeployModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string | null
  isDeployed: boolean
  needsRedeployment: boolean
  deployedState?: WorkflowState | null
  isLoadingDeployedState: boolean
  deployReadiness: DeployReadiness
  isDeploymentSettling: boolean
}

interface WorkflowDeploymentInfoUI {
  isDeployed: boolean
  deployedAt?: string
  apiKey: string
  endpoint: string
  exampleCommand: string
  needsRedeployment: boolean
  isPublicApi: boolean
}

type TabView = 'general' | 'api' | 'chat' | 'mcp' | 'block'

const DEPLOY_MODAL_TABS = new Set<TabView>(['general', 'api', 'chat', 'mcp', 'block'])

function isDeployModalTab(value: unknown): value is TabView {
  return typeof value === 'string' && DEPLOY_MODAL_TABS.has(value as TabView)
}

export function DeployModal({
  open,
  onOpenChange,
  workflowId,
  isDeployed: isDeployedProp,
  needsRedeployment,
  deployedState,
  isLoadingDeployedState,
  deployReadiness,
  isDeploymentSettling,
}: DeployModalProps) {
  const queryClient = useQueryClient()
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const { navigateToSettings } = useSettingsNavigation()
  const isDeployed = isDeployedProp
  const { data: workflowMap = {} } = useWorkflowMap(workspaceId)
  const workflowMetadata = workflowId ? workflowMap[workflowId] : undefined
  const workflowWorkspaceId = workflowMetadata?.workspaceId ?? null
  const [activeTab, setActiveTab] = useState<TabView>('general')
  const [chatSubmitting, setChatSubmitting] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [deployWarnings, setDeployWarnings] = useState<string[]>([])
  const [isFinalizingDeploy, setIsFinalizingDeploy] = useState(false)
  const [isActivatingVersion, setIsActivatingVersion] = useState(false)
  const [isChatFormValid, setIsChatFormValid] = useState(false)
  const [selectedStreamingOutputs, setSelectedStreamingOutputs] = useState<string[]>([])

  const [undeployTargetWorkflowId, setUndeployTargetWorkflowId] = useState<string | null>(null)
  const [mcpToolSubmitting, setMcpToolSubmitting] = useState(false)
  const [mcpToolCanSave, setMcpToolCanSave] = useState(false)
  const [mcpToolSaveDisabledReason, setMcpToolSaveDisabledReason] = useState<string | null>(null)
  const [mcpActiveServerId, setMcpActiveServerId] = useState<string | null>(null)

  const [blockSubmitting, setBlockSubmitting] = useState(false)
  const [blockCanSave, setBlockCanSave] = useState(false)
  const [blockExists, setBlockExists] = useState(false)

  const [chatSuccess, setChatSuccess] = useState(false)
  const chatSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deployActionIdRef = useRef(0)
  const activateVersionInFlightRef = useRef(false)

  const [isCreateKeyModalOpen, setIsCreateKeyModalOpen] = useState(false)
  const [isApiInfoModalOpen, setIsApiInfoModalOpen] = useState(false)
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canAdmin
  const { config: permissionConfig, isPublicApiDisabled } = usePermissionConfig()
  // Gate on the WORKSPACE owner's plan (billed account, rolled up), not the
  // viewer's individual plan, so a free member of a paid workspace isn't shown
  // the upgrade wall. Keyed on the URL `workspaceId` (available on mount). Uses
  // `isPaid` — the same check the server gate runs (any paid plan in an entitled
  // status, incl. `past_due`) — rather than `hasUsablePaidAccess`, which would
  // reject `past_due`/billing-blocked owners the API still allows. While loading
  // the data is undefined → gate stays closed (no flash); only a resolved,
  // non-paid owner gates.
  const { data: ownerBilling } = useWorkspaceOwnerBilling(workspaceId ?? undefined)
  const gateProgrammaticDeploy = isBillingEnabled && !!ownerBilling && !ownerBilling.isPaid
  const { data: apiKeysData, isLoading: isLoadingKeys } = useApiKeys(workflowWorkspaceId || '')
  const { data: workspaceSettingsData, isLoading: isLoadingSettings } = useWorkspaceSettings(
    workflowWorkspaceId || ''
  )
  const apiKeyWorkspaceKeys = apiKeysData?.workspaceKeys || []
  const apiKeyPersonalKeys = apiKeysData?.personalKeys || []
  const allowPersonalApiKeys =
    workspaceSettingsData?.settings?.workspace?.allowPersonalApiKeys ?? true
  const defaultKeyType = allowPersonalApiKeys ? 'personal' : 'workspace'
  const isApiKeysLoading = isLoadingKeys || isLoadingSettings
  const createButtonDisabled =
    isApiKeysLoading || (!allowPersonalApiKeys && !canManageWorkspaceKeys)

  const {
    data: deploymentInfoData,
    isLoading: isLoadingDeploymentInfo,
    refetch: refetchDeploymentInfo,
  } = useDeploymentInfo(workflowId, { enabled: open && isDeployed })

  const { data: versionsData, isLoading: versionsLoading } = useDeploymentVersions(workflowId, {
    enabled: open,
  })

  const {
    isLoading: isLoadingChat,
    chatExists,
    existingChat,
    refetch: refetchChatInfo,
  } = useChatDeploymentInfo(workflowId, { enabled: open })

  const { data: mcpServers = [] } = useWorkflowMcpServers(workflowWorkspaceId || '')
  const hasMcpServers = mcpServers.length > 0

  const { data: canPublishBlock = false } = useCanPublishCustomBlock(workspaceId)

  const deployMutation = useDeployWorkflow()
  const undeployMutation = useUndeployWorkflow()
  const activateVersionMutation = useActivateDeploymentVersion()

  const versions = versionsData?.versions ?? []

  const isWorkflowStillActive = (targetWorkflowId: string) => {
    return useWorkflowRegistry.getState().activeWorkflowId === targetWorkflowId
  }

  const syncDraftAfterDeploy = async (): Promise<string | null> => {
    if (!workflowId) return null

    try {
      const syncedActiveWorkflow = await syncLocalDraftFromServer(workflowId)
      if (!syncedActiveWorkflow && isWorkflowStillActive(workflowId)) {
        return 'Deployment succeeded, but local sync is still catching up. Refresh if the status looks stale.'
      }
      return null
    } catch (error) {
      if (!isWorkflowStillActive(workflowId)) return null
      logger.warn('Workflow deployed, but local draft sync failed', {
        workflowId,
        error: toError(error).message,
      })
      return 'Deployment succeeded, but local sync failed. Refresh if the status looks stale.'
    }
  }

  useEffect(() => {
    deployActionIdRef.current += 1
    setIsFinalizingDeploy(false)
    setUndeployTargetWorkflowId(null)
  }, [workflowId])

  const getApiKeyLabel = (value?: string | null) => {
    if (value && value.trim().length > 0) {
      return value
    }
    return workflowWorkspaceId ? 'Workspace API keys' : 'Personal API keys'
  }

  const getApiHeaderPlaceholder = () =>
    workflowWorkspaceId ? 'YOUR_WORKSPACE_API_KEY' : 'YOUR_PERSONAL_API_KEY'

  const getInputFormatExample = (includeStreaming = false) => {
    return getInputFormatExampleUtil(includeStreaming, selectedStreamingOutputs)
  }

  const deploymentInfo: WorkflowDeploymentInfoUI | null = (() => {
    if (!deploymentInfoData?.isDeployed || !workflowId) {
      return null
    }

    const endpoint = `${getBaseUrl()}/api/workflows/${workflowId}/execute`
    const inputFormatExample = getInputFormatExample(selectedStreamingOutputs.length > 0)
    const placeholderKey = getApiHeaderPlaceholder()

    return {
      isDeployed: deploymentInfoData.isDeployed,
      deployedAt: deploymentInfoData.deployedAt ?? undefined,
      apiKey: getApiKeyLabel(deploymentInfoData.apiKey),
      endpoint,
      exampleCommand: `curl -X POST -H "X-API-Key: ${placeholderKey}" -H "Content-Type: application/json"${inputFormatExample} ${endpoint}`,
      needsRedeployment: deploymentInfoData.needsRedeployment,
      isPublicApi: isPublicApiDisabled ? false : (deploymentInfoData.isPublicApi ?? false),
    }
  })()

  const selectedStreamingOutputsRef = useRef(selectedStreamingOutputs)
  selectedStreamingOutputsRef.current = selectedStreamingOutputs

  useEffect(() => {
    if (open && workflowId) {
      setActiveTab('general')
      setDeployError(null)
      setDeployWarnings([])
      setChatSuccess(false)

      const currentOutputs = selectedStreamingOutputsRef.current
      if (currentOutputs.length > 0) {
        const blocks = Object.values(useWorkflowStore.getState().blocks)
        const validOutputs = currentOutputs.filter((outputId) => {
          if (startsWithUuid(outputId)) {
            const underscoreIndex = outputId.indexOf('_')
            if (underscoreIndex === -1) return false
            const blockId = outputId.substring(0, underscoreIndex)
            return blocks.some((b) => b.id === blockId)
          }
          const parts = outputId.split('.')
          if (parts.length >= 2) {
            const blockName = parts[0]
            return blocks.some((b) => b.name && normalizeName(b.name) === blockName.toLowerCase())
          }
          return true
        })
        if (validOutputs.length !== currentOutputs.length) {
          setSelectedStreamingOutputs(validOutputs)
        }
      }
    }
    return () => {
      if (chatSuccessTimeoutRef.current) {
        clearTimeout(chatSuccessTimeoutRef.current)
      }
    }
  }, [open, workflowId])

  useEffect(() => {
    const handleOpenDeployModal = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: unknown }>
      onOpenChange(true)
      if (isDeployModalTab(customEvent.detail?.tab)) {
        setActiveTab(customEvent.detail.tab)
      }
    }

    window.addEventListener('open-deploy-modal', handleOpenDeployModal)

    return () => {
      window.removeEventListener('open-deploy-modal', handleOpenDeployModal)
    }
  }, [onOpenChange])

  const onDeploy = async () => {
    if (!workflowId) return
    if (!tryAcquireDeployAction(workflowId)) return

    const actionId = deployActionIdRef.current + 1
    deployActionIdRef.current = actionId
    setIsFinalizingDeploy(true)
    setDeployError(null)
    setDeployWarnings([])

    try {
      if (!(await deployReadiness.waitUntilReady())) {
        if (!isWorkflowStillActive(workflowId) || deployActionIdRef.current !== actionId) return
        setDeployError(deployReadiness.tooltip)
        return
      }
      if (!isWorkflowStillActive(workflowId) || deployActionIdRef.current !== actionId) return

      try {
        const result = await deployMutation.mutateAsync({ workflowId })
        const syncWarning = await syncDraftAfterDeploy()
        if (!isWorkflowStillActive(workflowId) || deployActionIdRef.current !== actionId) return
        setDeployWarnings([...(result.warnings || []), ...(syncWarning ? [syncWarning] : [])])
      } finally {
        if (deployActionIdRef.current === actionId) {
          setIsFinalizingDeploy(false)
        }
      }
    } catch (error: unknown) {
      if (deployActionIdRef.current !== actionId) return
      if (!isWorkflowStillActive(workflowId)) return
      logger.error('Error deploying workflow:', { error })
      const errorMessage = toError(error).message || 'Failed to deploy workflow'
      setDeployError(errorMessage)
    } finally {
      releaseDeployAction(workflowId)
      if (deployActionIdRef.current === actionId) {
        setIsFinalizingDeploy(false)
      }
    }
  }

  const handlePromoteToLive = async (version: number) => {
    if (!workflowId) return
    if (activateVersionInFlightRef.current) return

    activateVersionInFlightRef.current = true
    setIsActivatingVersion(true)
    setDeployWarnings([])

    try {
      const result = await activateVersionMutation.mutateAsync({ workflowId, version })
      if (!isWorkflowStillActive(workflowId)) return
      if (result.warnings && result.warnings.length > 0) {
        setDeployWarnings(result.warnings)
      }
    } catch (error) {
      if (!isWorkflowStillActive(workflowId)) return
      logger.error('Error promoting version:', { error })
      throw error
    } finally {
      activateVersionInFlightRef.current = false
      setIsActivatingVersion(false)
    }
  }

  const handleUndeploy = async () => {
    if (!undeployTargetWorkflowId) return
    const targetWorkflowId = undeployTargetWorkflowId
    if (workflowId !== targetWorkflowId || !isWorkflowStillActive(targetWorkflowId)) {
      setUndeployTargetWorkflowId(null)
      return
    }

    setDeployWarnings([])

    try {
      const result = await undeployMutation.mutateAsync({ workflowId: targetWorkflowId })
      if (!isWorkflowStillActive(targetWorkflowId)) return
      setUndeployTargetWorkflowId(null)
      if (result.warnings && result.warnings.length > 0) {
        setDeployWarnings(result.warnings)
        return
      }
      onOpenChange(false)
    } catch (error: unknown) {
      if (!isWorkflowStillActive(targetWorkflowId)) return
      logger.error('Error undeploying workflow:', { error })
    }
  }

  const handleRedeploy = async () => {
    if (!workflowId) return
    if (!tryAcquireDeployAction(workflowId)) return

    const actionId = deployActionIdRef.current + 1
    deployActionIdRef.current = actionId
    setIsFinalizingDeploy(true)
    setDeployError(null)
    setDeployWarnings([])

    try {
      if (!(await deployReadiness.waitUntilReady())) {
        if (!isWorkflowStillActive(workflowId) || deployActionIdRef.current !== actionId) return
        setDeployError(deployReadiness.tooltip)
        return
      }
      if (!isWorkflowStillActive(workflowId) || deployActionIdRef.current !== actionId) return

      const { blocks, edges, loops, parallels } = useWorkflowStore.getState()
      const liveBlocks = mergeSubblockState(blocks, workflowId)
      const checkResult = runPreDeployChecks({
        blocks: liveBlocks,
        edges,
        loops,
        parallels,
        workflowId,
      })
      if (!checkResult.passed) {
        setDeployError(checkResult.error || 'Pre-deploy validation failed')
        return
      }

      try {
        const result = await deployMutation.mutateAsync({ workflowId })
        const syncWarning = await syncDraftAfterDeploy()
        if (!isWorkflowStillActive(workflowId) || deployActionIdRef.current !== actionId) return
        setDeployWarnings([...(result.warnings || []), ...(syncWarning ? [syncWarning] : [])])
      } finally {
        if (deployActionIdRef.current === actionId) {
          setIsFinalizingDeploy(false)
        }
      }
    } catch (error: unknown) {
      if (deployActionIdRef.current !== actionId) return
      if (!isWorkflowStillActive(workflowId)) return
      logger.error('Error redeploying workflow:', { error })
      const errorMessage = toError(error).message || 'Failed to redeploy workflow'
      setDeployError(errorMessage)
    } finally {
      releaseDeployAction(workflowId)
      if (deployActionIdRef.current === actionId) {
        setIsFinalizingDeploy(false)
      }
    }
  }

  const handleCloseModal = () => {
    deployActionIdRef.current += 1
    setIsFinalizingDeploy(false)
    if (workflowId) releaseDeployAction(workflowId)
    setChatSubmitting(false)
    setDeployError(null)
    setDeployWarnings([])
    onOpenChange(false)
  }

  const handleChatDeployed = async () => {
    if (!workflowId) return

    invalidateDeploymentQueries(queryClient, workflowId)

    if (chatSuccessTimeoutRef.current) {
      clearTimeout(chatSuccessTimeoutRef.current)
    }
    setChatSuccess(true)
    chatSuccessTimeoutRef.current = setTimeout(() => setChatSuccess(false), 2000)
  }

  const handleRefetchChat = async () => {
    await refetchChatInfo()
  }

  const handleChatFormSubmit = () => {
    const form = document.getElementById('chat-deploy-form') as HTMLFormElement
    form?.requestSubmit()
  }

  const handleChatDelete = () => {
    const form = document.getElementById('chat-deploy-form') as HTMLFormElement
    if (form) {
      const deleteButton = form.querySelector('[data-delete-trigger]') as HTMLButtonElement
      if (deleteButton) {
        deleteButton.click()
      }
    }
  }

  const handleMcpToolFormSubmit = () => {
    const form = document.getElementById('mcp-deploy-form') as HTMLFormElement
    form?.requestSubmit()
  }

  const handleBlockFormSubmit = () => {
    const form = document.getElementById('block-deploy-form') as HTMLFormElement
    form?.requestSubmit()
  }

  const handleBlockUnpublish = () => {
    const form = document.getElementById('block-deploy-form') as HTMLFormElement
    const trigger = form?.querySelector('[data-unpublish-trigger]') as HTMLButtonElement | null
    trigger?.click()
  }

  const isSubmitting = deployMutation.isPending || isFinalizingDeploy
  const isUndeploying = undeployMutation.isPending

  return (
    <>
      <Modal open={open} onOpenChange={handleCloseModal}>
        <ModalContent size='lg' className='h-[76vh]'>
          <ModalHeader>Workflow Deployment</ModalHeader>

          <ModalTabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as TabView)}
            className='flex min-h-0 flex-1 flex-col'
          >
            <ModalTabsList activeValue={activeTab}>
              <ModalTabsTrigger value='general'>General</ModalTabsTrigger>
              {!permissionConfig.hideDeployApi && (
                <ModalTabsTrigger value='api'>API</ModalTabsTrigger>
              )}
              {!permissionConfig.hideDeployMcp && (
                <ModalTabsTrigger value='mcp'>MCP</ModalTabsTrigger>
              )}
              {!permissionConfig.hideDeployChatbot && (
                <ModalTabsTrigger value='chat'>Chat</ModalTabsTrigger>
              )}
              {canPublishBlock && <ModalTabsTrigger value='block'>Block</ModalTabsTrigger>}
            </ModalTabsList>

            <ModalBody className='min-h-0 flex-1'>
              <ModalDescription className='sr-only'>
                Configure and manage workflow deployment settings including API, MCP, and chat
                options.
              </ModalDescription>
              {(deployError || deployWarnings.length > 0) && (
                <div className='mb-3 flex flex-col gap-2'>
                  {deployError && (
                    <Badge variant='red' size='lg' dot className='max-w-full truncate'>
                      {deployError}
                    </Badge>
                  )}
                  {deployWarnings.map((warning) => (
                    <Badge
                      key={warning}
                      variant='amber'
                      size='lg'
                      dot
                      className='max-w-full truncate'
                    >
                      {warning}
                    </Badge>
                  ))}
                </div>
              )}
              <ModalTabsContent value='general'>
                <GeneralDeploy
                  workflowId={workflowId}
                  deployedState={deployedState}
                  isLoadingDeployedState={isLoadingDeployedState}
                  versions={versions}
                  versionsLoading={versionsLoading}
                  isPromotingVersion={isActivatingVersion || activateVersionMutation.isPending}
                  deployReadiness={deployReadiness}
                  onPromoteToLive={handlePromoteToLive}
                  onLoadDeploymentComplete={handleCloseModal}
                  onLoadDeploymentBlocked={setDeployError}
                />
              </ModalTabsContent>

              <ModalTabsContent value='api' className='h-full'>
                <GatedTabContent gated={gateProgrammaticDeploy} feature='API'>
                  <ApiDeploy
                    workflowId={workflowId}
                    deploymentInfo={deploymentInfo}
                    isLoading={isLoadingDeploymentInfo}
                    needsRedeployment={needsRedeployment}
                    getInputFormatExample={getInputFormatExample}
                    selectedStreamingOutputs={selectedStreamingOutputs}
                    onSelectedStreamingOutputsChange={setSelectedStreamingOutputs}
                  />
                </GatedTabContent>
              </ModalTabsContent>

              <ModalTabsContent value='chat'>
                <ChatDeploy
                  workflowId={workflowId || ''}
                  deploymentInfo={deploymentInfo}
                  existingChat={existingChat as ExistingChat | null}
                  isLoadingChat={isLoadingChat}
                  onRefetchChat={handleRefetchChat}
                  chatSubmitting={chatSubmitting}
                  setChatSubmitting={setChatSubmitting}
                  onValidationChange={setIsChatFormValid}
                  onDeploymentComplete={handleCloseModal}
                  onDeployed={handleChatDeployed}
                  onVersionActivated={() => {}}
                />
              </ModalTabsContent>

              <ModalTabsContent value='mcp' className='h-full'>
                <GatedTabContent gated={gateProgrammaticDeploy} feature='MCP'>
                  {workflowId && (
                    <McpDeploy
                      workflowId={workflowId}
                      workflowName={workflowMetadata?.name || 'Workflow'}
                      workflowDescription={workflowMetadata?.description}
                      isDeployed={isDeployed}
                      deployedState={deployedState}
                      isLoadingDeployedState={isLoadingDeployedState}
                      onSubmittingChange={setMcpToolSubmitting}
                      onCanSaveChange={setMcpToolCanSave}
                      onSaveDisabledReasonChange={setMcpToolSaveDisabledReason}
                      onActiveServerChange={setMcpActiveServerId}
                    />
                  )}
                </GatedTabContent>
              </ModalTabsContent>

              {canPublishBlock && (
                <ModalTabsContent value='block'>
                  <BlockDeploy
                    workflowId={workflowId}
                    workspaceId={workspaceId}
                    isDeployed={isDeployed}
                    canAdmin={userPermissions.canAdmin}
                    onSubmittingChange={setBlockSubmitting}
                    onCanSaveChange={setBlockCanSave}
                    onExistingChange={setBlockExists}
                  />
                </ModalTabsContent>
              )}
            </ModalBody>
          </ModalTabs>

          {activeTab === 'general' && (
            <GeneralFooter
              isDeployed={isDeployed}
              needsRedeployment={needsRedeployment}
              isSubmitting={isSubmitting}
              isUndeploying={isUndeploying}
              deployReadiness={deployReadiness}
              isDeploymentSettling={isDeploymentSettling}
              onDeploy={onDeploy}
              onRedeploy={handleRedeploy}
              onUndeploy={() => {
                if (workflowId) setUndeployTargetWorkflowId(workflowId)
              }}
            />
          )}
          {activeTab === 'api' && !gateProgrammaticDeploy && (
            <ModalFooter className='items-center justify-between'>
              <div />
              <div className='flex items-center gap-2'>
                <Button variant='default' onClick={() => setIsApiInfoModalOpen(true)}>
                  Edit API Info
                </Button>
                <Button
                  variant='tertiary'
                  onClick={() => setIsCreateKeyModalOpen(true)}
                  disabled={createButtonDisabled}
                >
                  Generate API Key
                </Button>
              </div>
            </ModalFooter>
          )}
          {activeTab === 'chat' && (
            <ModalFooter className='items-center justify-between'>
              <div />
              <div className='flex items-center gap-2'>
                {chatExists && (
                  <Button
                    type='button'
                    variant='default'
                    onClick={handleChatDelete}
                    disabled={chatSubmitting}
                  >
                    Delete
                  </Button>
                )}
                <Button
                  type='button'
                  variant='tertiary'
                  onClick={handleChatFormSubmit}
                  disabled={chatSubmitting || !isChatFormValid}
                >
                  {chatSuccess
                    ? chatExists
                      ? 'Updated'
                      : 'Launched'
                    : chatSubmitting
                      ? chatExists
                        ? 'Updating...'
                        : 'Launching...'
                      : chatExists
                        ? 'Update'
                        : 'Launch Chat'}
                </Button>
              </div>
            </ModalFooter>
          )}
          {activeTab === 'block' && (
            <ModalFooter className='items-center justify-between'>
              <div />
              <div className='flex items-center gap-2'>
                {blockExists && (
                  <Button
                    type='button'
                    variant='default'
                    onClick={handleBlockUnpublish}
                    disabled={blockSubmitting}
                  >
                    Unpublish
                  </Button>
                )}
                <Button
                  type='button'
                  variant='tertiary'
                  onClick={handleBlockFormSubmit}
                  disabled={blockSubmitting || !blockCanSave}
                >
                  {blockSubmitting
                    ? blockExists
                      ? 'Updating...'
                      : 'Publishing...'
                    : blockExists
                      ? 'Update'
                      : 'Publish'}
                </Button>
              </div>
            </ModalFooter>
          )}
          {activeTab === 'mcp' && !gateProgrammaticDeploy && isDeployed && hasMcpServers && (
            <ModalFooter className='items-center justify-between'>
              <div />
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  variant='default'
                  onClick={() =>
                    navigateToSettings({
                      section: 'workflow-mcp-servers',
                      mcpServerId: mcpActiveServerId ?? undefined,
                    })
                  }
                >
                  Manage
                </Button>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span>
                      <Button
                        type='button'
                        variant='tertiary'
                        onClick={handleMcpToolFormSubmit}
                        disabled={mcpToolSubmitting || !mcpToolCanSave}
                      >
                        {mcpToolSubmitting ? 'Saving...' : 'Save Tool'}
                      </Button>
                    </span>
                  </Tooltip.Trigger>
                  {mcpToolSaveDisabledReason && (
                    <Tooltip.Content>{mcpToolSaveDisabledReason}</Tooltip.Content>
                  )}
                </Tooltip.Root>
              </div>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      <ChipConfirmModal
        open={Boolean(undeployTargetWorkflowId)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setUndeployTargetWorkflowId(null)
        }}
        srTitle='Undeploy API'
        title='Undeploy API'
        text={[
          'Are you sure you want to undeploy this workflow? ',
          {
            text: 'This will remove the API endpoint and make it unavailable to external users.',
            error: true,
          },
        ]}
        confirm={{
          label: 'Undeploy',
          onClick: handleUndeploy,
          pending: isUndeploying,
          pendingLabel: 'Undeploying...',
        }}
      />

      <CreateApiKeyModal
        open={isCreateKeyModalOpen}
        onOpenChange={setIsCreateKeyModalOpen}
        workspaceId={workflowWorkspaceId || ''}
        existingKeyNames={[...apiKeyWorkspaceKeys, ...apiKeyPersonalKeys].map((k) => k.name)}
        allowPersonalApiKeys={allowPersonalApiKeys}
        canManageWorkspaceKeys={canManageWorkspaceKeys}
        defaultKeyType={defaultKeyType}
        source='deploy_modal'
      />

      {workflowId && (
        <ApiInfoModal
          open={isApiInfoModalOpen}
          onOpenChange={setIsApiInfoModalOpen}
          workflowId={workflowId}
        />
      )}
    </>
  )
}

interface StatusBadgeProps {
  isWarning: boolean
}

function StatusBadge({ isWarning }: StatusBadgeProps) {
  const label = isWarning ? 'Update deployment' : 'Live'
  return (
    <Badge variant={isWarning ? 'amber' : 'green'} size='lg' dot>
      {label}
    </Badge>
  )
}

interface GeneralFooterProps {
  isDeployed?: boolean
  needsRedeployment: boolean
  isSubmitting: boolean
  isUndeploying: boolean
  deployReadiness: DeployReadiness
  isDeploymentSettling: boolean
  onDeploy: () => Promise<void>
  onRedeploy: () => Promise<void>
  onUndeploy: () => void
}

function GeneralFooter({
  isDeployed,
  needsRedeployment,
  isSubmitting,
  isUndeploying,
  deployReadiness,
  isDeploymentSettling,
  onDeploy,
  onRedeploy,
  onUndeploy,
}: GeneralFooterProps) {
  const isDeployBlocked =
    deployReadiness.isBlocked || isDeploymentSettling || isSubmitting || isUndeploying
  const blockedMessage =
    deployReadiness.isBlocked && !deployReadiness.isSyncing && !isSubmitting && !isUndeploying
      ? deployReadiness.tooltip
      : null
  const deployActionLoading = isSubmitting || isDeploymentSettling

  if (!isDeployed) {
    return (
      <ModalFooter className='items-center justify-between'>
        <div className='max-w-[260px] text-[var(--text-muted)] text-xs'>{blockedMessage}</div>
        <div className='flex items-center gap-2'>
          <Button variant='tertiary' onClick={onDeploy} disabled={isDeployBlocked}>
            {deployActionLoading && <Loader className='mr-1.5 size-3.5' animate />}
            Deploy
          </Button>
        </div>
      </ModalFooter>
    )
  }

  return (
    <ModalFooter className='items-center justify-between'>
      <div className='flex min-w-0 flex-col gap-1'>
        <StatusBadge isWarning={needsRedeployment} />
        {blockedMessage && (
          <div className='max-w-[300px] text-[var(--text-muted)] text-xs'>{blockedMessage}</div>
        )}
      </div>
      <div className='flex items-center gap-2'>
        <Button variant='default' onClick={onUndeploy} disabled={isUndeploying || isSubmitting}>
          {isUndeploying ? 'Undeploying...' : 'Undeploy'}
        </Button>
        {(needsRedeployment || isDeploymentSettling) && (
          <Button variant='tertiary' onClick={onRedeploy} disabled={isDeployBlocked}>
            {deployActionLoading && <Loader className='mr-1.5 size-3.5' animate />}
            Update
          </Button>
        )}
      </div>
    </ModalFooter>
  )
}
