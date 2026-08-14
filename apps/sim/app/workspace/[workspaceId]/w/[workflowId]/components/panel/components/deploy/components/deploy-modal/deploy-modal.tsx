'use client'

import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipTag,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Loader,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  ScrollEdgeFade,
  Tooltip,
  toast,
} from '@sim/emcn'
import { ArrowLeft, MoreHorizontal, Trash } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import type { DeploymentOperationSummary } from '@/lib/api/contracts/deployments'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getInputFormatExample as getInputFormatExampleUtil } from '@/lib/workflows/operations/deployment-utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { CreateApiKeyModal } from '@/app/workspace/[workspaceId]/settings/components/api-keys/components'
import {
  ApiDeploy,
  ChatDeploy,
  type ExistingChat,
  GeneralDeploy,
  McpDeploy,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components'
import { ApiInfoModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/components/api-info-modal'
import { formatVersionLabel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/format-version-label'
import type {
  DeploymentAccessMethod,
  DeploymentAccessView,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/general'
import {
  releaseDeployAction,
  tryAcquireDeployAction,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/deploy-action-lock'
import type { DeployReadiness } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-readiness'
import { runPreDeployChecks } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-predeploy-checks'
import { normalizeName, startsWithUuid } from '@/executor/constants'
import { useApiKeys } from '@/hooks/queries/api-keys'
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
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { syncLocalDraftFromServer } from '@/stores/workflows/sync-local-draft'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeployPopover')

interface DeployPopoverProps {
  trigger: ReactElement
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

type DeployView = 'general' | DeploymentAccessView

const DEPLOY_POPOVER_TABS = new Set<DeployView>(['general', 'api', 'chat', 'mcp'])

function isDeployPopoverTab(value: unknown): value is DeployView {
  return typeof value === 'string' && DEPLOY_POPOVER_TABS.has(value as DeployView)
}

export function DeployPopover({
  trigger,
  open,
  onOpenChange,
  workflowId,
  isDeployed: isDeployedProp,
  needsRedeployment,
  deployedState,
  isLoadingDeployedState,
  deployReadiness,
  isDeploymentSettling,
}: DeployPopoverProps) {
  const queryClient = useQueryClient()
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const { navigateToSettings } = useSettingsNavigation()
  const isDeployed = isDeployedProp
  const { data: workflowMap = {} } = useWorkflowMap(workspaceId)
  const workflowMetadata = workflowId ? workflowMap[workflowId] : undefined
  const workflowWorkspaceId = workflowMetadata?.workspaceId ?? null
  const [activeTab, setActiveTab] = useState<DeployView>('general')
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [chatSubmitting, setChatSubmitting] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [isFinalizingDeploy, setIsFinalizingDeploy] = useState(false)
  const [isActivatingVersion, setIsActivatingVersion] = useState(false)
  const [isChatFormValid, setIsChatFormValid] = useState(false)
  const [selectedStreamingOutputs, setSelectedStreamingOutputs] = useState<string[]>([])

  const [undeployTargetWorkflowId, setUndeployTargetWorkflowId] = useState<string | null>(null)
  const [mcpToolSubmitting, setMcpToolSubmitting] = useState(false)
  const [mcpToolCanSave, setMcpToolCanSave] = useState(false)
  const [mcpToolSaveDisabledReason, setMcpToolSaveDisabledReason] = useState<string | null>(null)
  const [mcpActiveServerId, setMcpActiveServerId] = useState<string | null>(null)

  const [chatSuccess, setChatSuccess] = useState(false)
  const chatSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deployActionIdRef = useRef(0)
  const activateVersionInFlightRef = useRef(false)
  const deployScrollAreaRef = useRef<HTMLDivElement>(null)
  const deployPopoverContentRef = useRef<HTMLDivElement>(null)
  const [showBottomFade, setShowBottomFade] = useState(false)

  const [isCreateKeyModalOpen, setIsCreateKeyModalOpen] = useState(false)
  const [isApiInfoModalOpen, setIsApiInfoModalOpen] = useState(false)
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canAdmin
  const { config: permissionConfig, isPublicApiDisabled } = usePermissionConfig()
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
  } = useDeploymentInfo(workflowId, { enabled: open })

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

  const deployMutation = useDeployWorkflow()
  const undeployMutation = useUndeployWorkflow()
  const activateVersionMutation = useActivateDeploymentVersion()

  const versions = versionsData?.versions ?? []
  const selectedVersionInfo = versions.find((version) => version.version === selectedVersion)
  const accessMethods: DeploymentAccessMethod[] = [
    ...(!permissionConfig.hideDeployApi
      ? [
          {
            id: 'api' as const,
            label: 'API',
            description: 'Run this workflow from your application',
            status: isDeployed ? 'Ready' : 'Deploy first',
          },
        ]
      : []),
    ...(!permissionConfig.hideDeployMcp
      ? [
          {
            id: 'mcp' as const,
            label: 'MCP',
            description: 'Expose this workflow as a tool',
            status: hasMcpServers ? 'Connected' : 'Set up',
          },
        ]
      : []),
    ...(!permissionConfig.hideDeployChatbot
      ? [
          {
            id: 'chat' as const,
            label: 'Chat',
            description: 'Launch a hosted chat experience',
            status: chatExists ? 'Live' : 'Set up',
          },
        ]
      : []),
  ]
  const deploymentAttemptStatus = deploymentInfoData?.latestDeploymentAttempt?.status
  const attemptErrorMessage =
    deploymentInfoData?.latestDeploymentAttempt?.error?.message ??
    (deploymentAttemptStatus === 'failed' ? 'Deployment preparation failed' : null)

  const updateBottomFade = useCallback(() => {
    const scrollArea = deployScrollAreaRef.current
    if (!scrollArea) return

    setShowBottomFade(scrollArea.scrollTop + scrollArea.clientHeight < scrollArea.scrollHeight - 1)
  }, [])

  useEffect(() => {
    const scrollArea = deployScrollAreaRef.current
    if (!scrollArea || !open) return

    updateBottomFade()

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateBottomFade)
    resizeObserver?.observe(scrollArea)

    const mutationObserver =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(updateBottomFade)
    mutationObserver?.observe(scrollArea, { childList: true, subtree: true })

    return () => {
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [open, updateBottomFade])

  const isWorkflowStillActive = (targetWorkflowId: string) => {
    return useWorkflowRegistry.getState().activeWorkflowId === targetWorkflowId
  }

  const syncDraftAfterDeploy = async (): Promise<void> => {
    if (!workflowId) return

    try {
      await syncLocalDraftFromServer(workflowId)
    } catch (error) {
      if (!isWorkflowStillActive(workflowId)) return
      logger.warn('Workflow deployed, but local draft sync failed', {
        workflowId,
        error: toError(error).message,
      })
    }
  }

  /**
   * Post-activation warnings (dead-lettered or still-queued side effects)
   * arrive with an `active` attempt, so the Live badge gives no signal —
   * surface them as a toast. Pending/failed attempts are excluded: the
   * status badge already covers those.
   */
  const toastPostActivationWarnings = (
    title: string,
    result: { latestDeploymentAttempt?: { status: string } | null; warnings?: string[] }
  ) => {
    if (result.latestDeploymentAttempt?.status !== 'active') return
    if (!result.warnings?.length) return
    toast.warning(title, { description: result.warnings.join(' ') })
  }

  useEffect(() => {
    deployActionIdRef.current += 1
    setIsFinalizingDeploy(false)
    setUndeployTargetWorkflowId(null)
    setSelectedVersion(null)
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
      setSelectedVersion(null)
      setDeployError(null)
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
    const handleOpenDeployPopover = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: unknown }>
      onOpenChange(true)
      setSelectedVersion(null)
      if (isDeployPopoverTab(customEvent.detail?.tab)) {
        setActiveTab(customEvent.detail.tab)
      } else {
        setActiveTab('general')
      }
    }

    window.addEventListener('open-deploy-modal', handleOpenDeployPopover)

    return () => {
      window.removeEventListener('open-deploy-modal', handleOpenDeployPopover)
    }
  }, [onOpenChange])

  const onDeploy = async () => {
    if (!workflowId) return
    if (!tryAcquireDeployAction(workflowId)) return

    const actionId = deployActionIdRef.current + 1
    deployActionIdRef.current = actionId
    setIsFinalizingDeploy(true)
    setDeployError(null)

    try {
      if (!(await deployReadiness.waitUntilReady())) {
        if (!isWorkflowStillActive(workflowId) || deployActionIdRef.current !== actionId) return
        setDeployError(deployReadiness.tooltip)
        return
      }
      if (!isWorkflowStillActive(workflowId) || deployActionIdRef.current !== actionId) return

      try {
        const result = await deployMutation.mutateAsync({ workflowId })
        if (result.latestDeploymentAttempt?.status === 'active') {
          await syncDraftAfterDeploy()
        }
        if (isWorkflowStillActive(workflowId)) {
          toastPostActivationWarnings('Workflow deployed', result)
        }
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
    setDeployError(null)

    try {
      const result = await activateVersionMutation.mutateAsync({ workflowId, version })
      if (isWorkflowStillActive(workflowId)) {
        toastPostActivationWarnings(`Promoted v${version} to live`, result)
      }
    } catch (error) {
      if (!isWorkflowStillActive(workflowId)) return
      logger.error('Error promoting version:', { error })
      setDeployError(toError(error).message || `Failed to promote v${version} to live`)
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

    try {
      const result = await undeployMutation.mutateAsync({ workflowId: targetWorkflowId })
      if (!isWorkflowStillActive(targetWorkflowId)) return
      setUndeployTargetWorkflowId(null)
      onOpenChange(false)
      /**
       * Partial cleanup warnings (e.g. external subscription teardown left to
       * background retries) surface as a toast so closing the modal does not
       * silently swallow them.
       */
      if (result.warnings?.length) {
        toast.warning('Workflow undeployed', { description: result.warnings.join(' ') })
      }
    } catch (error: unknown) {
      if (!isWorkflowStillActive(targetWorkflowId)) return
      logger.error('Error undeploying workflow:', { error })
      toast.error('Failed to undeploy workflow', { description: toError(error).message })
    }
  }

  const handleRedeploy = async () => {
    if (!workflowId) return
    if (!tryAcquireDeployAction(workflowId)) return

    const actionId = deployActionIdRef.current + 1
    deployActionIdRef.current = actionId
    setIsFinalizingDeploy(true)
    setDeployError(null)

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
        if (result.latestDeploymentAttempt?.status === 'active') {
          await syncDraftAfterDeploy()
        }
        if (isWorkflowStillActive(workflowId)) {
          toastPostActivationWarnings('Workflow redeployed', result)
        }
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

  const handleClosePopover = useCallback(() => {
    deployActionIdRef.current += 1
    setIsFinalizingDeploy(false)
    if (workflowId) releaseDeployAction(workflowId)
    setChatSubmitting(false)
    setDeployError(null)
    setSelectedVersion(null)
    onOpenChange(false)
  }, [onOpenChange, workflowId])

  useEffect(() => {
    if (!open) return

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (deployPopoverContentRef.current?.contains(target)) return
      if (
        target.closest(
          '[data-deploy-popover-trigger], [data-panel-resize-handle], [data-native-surface-overlay]'
        )
      ) {
        return
      }

      handleClosePopover()
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown, true)
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  }, [handleClosePopover, open])

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

  const isSubmitting = deployMutation.isPending || isFinalizingDeploy
  const isUndeploying = undeployMutation.isPending
  const hasVisibleAttemptStatus =
    deploymentAttemptStatus === 'preparing' ||
    deploymentAttemptStatus === 'activating' ||
    deploymentAttemptStatus === 'failed'

  const handlePanelOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    handleClosePopover()
  }

  const isOverview = activeTab === 'general' && selectedVersionInfo === undefined
  const headerTitle = selectedVersionInfo
    ? formatVersionLabel(selectedVersionInfo.version, selectedVersionInfo.name)
    : activeTab === 'api'
      ? 'API access'
      : activeTab === 'mcp'
        ? 'MCP access'
        : activeTab === 'chat'
          ? 'Chat deployment'
          : isDeployed
            ? 'Production deployment'
            : 'Deploy workflow'
  const handleBackToOverview = () => {
    if (selectedVersionInfo) {
      setSelectedVersion(null)
      return
    }
    setActiveTab('general')
  }

  return (
    <Popover open={open} onOpenChange={handlePanelOpenChange}>
      <PopoverTrigger asChild data-deploy-popover-trigger=''>
        {trigger}
      </PopoverTrigger>
      <PopoverAnchor asChild>
        <span
          aria-hidden='true'
          className='-bottom-2 pointer-events-none absolute right-2 size-0'
        />
      </PopoverAnchor>
      <PopoverContent
        ref={deployPopoverContentRef}
        align='end'
        side='bottom'
        sideOffset={0}
        updatePositionStrategy='always'
        collisionPadding={12}
        maxHeight={620}
        minWidth={440}
        appearance='dropdown'
        className='z-[calc(var(--z-modal)-1)] w-[440px] overflow-hidden p-0'
        aria-label='Deploy workflow'
        onInteractOutside={(event) => {
          const target = event.target
          if (target instanceof Element && target.closest('[data-panel-resize-handle]')) {
            event.preventDefault()
          }
        }}
      >
        <div className='relative flex max-h-[min(620px,calc(100vh-80px))] flex-col overflow-hidden'>
          <div className='p-3'>
            <div className='flex items-center justify-between gap-3'>
              <div className='flex min-w-0 items-center gap-2'>
                {!isOverview && (
                  <Chip
                    type='button'
                    leftIcon={ArrowLeft}
                    className='shrink-0'
                    onClick={handleBackToOverview}
                    aria-label='Back to deployment overview'
                  />
                )}
                <h2 className='truncate font-medium text-[var(--text-primary)] text-sm'>
                  {headerTitle}
                </h2>
              </div>
              {isOverview && (
                <div className='flex shrink-0 items-center gap-1'>
                  {!isDeployed && !hasVisibleAttemptStatus ? (
                    <ChipTag variant='gray'>Not deployed</ChipTag>
                  ) : (
                    <StatusBadge
                      isDeployed={isDeployed}
                      needsRedeployment={needsRedeployment}
                      attemptStatus={deploymentAttemptStatus}
                      attemptErrorMessage={attemptErrorMessage}
                    />
                  )}
                  {isDeployed && (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Chip
                          type='button'
                          leftIcon={MoreHorizontal}
                          aria-label='Deployment actions'
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' sideOffset={4}>
                        <DropdownMenuItem
                          onSelect={() => workflowId && setUndeployTargetWorkflowId(workflowId)}
                        >
                          <Trash />
                          Undeploy workflow…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className='relative min-h-0 flex-1 overflow-hidden'>
            <div
              ref={deployScrollAreaRef}
              className={cn('h-full overflow-y-auto px-3 pb-3', isOverview ? 'pt-0' : 'pt-3')}
              onScroll={updateBottomFade}
            >
              <p className='sr-only'>
                Configure and manage workflow deployment settings including API, MCP, and chat
                options.
              </p>
              {deployError && !isOverview && (
                <div className='mb-3' role='alert'>
                  <ChipTag variant='red' className='max-w-full truncate'>
                    {deployError}
                  </ChipTag>
                </div>
              )}

              {activeTab === 'general' && (
                <GeneralDeploy
                  key={workflowId ?? 'no-workflow'}
                  workflowId={workflowId}
                  versions={versions}
                  versionsLoading={versionsLoading}
                  isPromotingVersion={isActivatingVersion || activateVersionMutation.isPending}
                  deployReadiness={deployReadiness}
                  accessMethods={accessMethods}
                  selectedVersion={selectedVersion}
                  onSelectVersion={setSelectedVersion}
                  onOpenAccessMethod={(view) => {
                    setSelectedVersion(null)
                    setActiveTab(view)
                  }}
                  onPromoteToLive={handlePromoteToLive}
                  onLoadDeploymentComplete={handleClosePopover}
                  onLoadDeploymentBlocked={setDeployError}
                />
              )}

              {activeTab === 'api' && (
                <ApiDeploy
                  workflowId={workflowId}
                  deploymentInfo={deploymentInfo}
                  isLoading={isLoadingDeploymentInfo}
                  needsRedeployment={needsRedeployment}
                  getInputFormatExample={getInputFormatExample}
                  selectedStreamingOutputs={selectedStreamingOutputs}
                  onSelectedStreamingOutputsChange={setSelectedStreamingOutputs}
                />
              )}

              {activeTab === 'chat' && (
                <ChatDeploy
                  workflowId={workflowId || ''}
                  deploymentInfo={deploymentInfo}
                  existingChat={existingChat as ExistingChat | null}
                  isLoadingChat={isLoadingChat}
                  onRefetchChat={handleRefetchChat}
                  chatSubmitting={chatSubmitting}
                  setChatSubmitting={setChatSubmitting}
                  canRevealPassword={userPermissions.canAdmin}
                  onValidationChange={setIsChatFormValid}
                  onDeploymentComplete={handleClosePopover}
                  onDeployed={handleChatDeployed}
                  onVersionActivated={() => {}}
                />
              )}

              {activeTab === 'mcp' && workflowId && (
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
            </div>

            <ScrollEdgeFade position='bottom' variant='panel' visible={showBottomFade} />
          </div>

          {activeTab === 'general' && selectedVersionInfo === undefined && (
            <GeneralFooter
              isDeployed={isDeployed}
              needsRedeployment={needsRedeployment}
              isSubmitting={isSubmitting}
              deployReadiness={deployReadiness}
              isDeploymentSettling={isDeploymentSettling}
              errorMessage={deployError}
              onDeploy={onDeploy}
              onRedeploy={handleRedeploy}
            />
          )}
          {activeTab === 'api' && (
            <div className='flex items-center justify-between gap-2 px-3 py-3'>
              <div />
              <div className='flex items-center gap-2'>
                <Chip variant='border' onClick={() => setIsApiInfoModalOpen(true)}>
                  Edit API Info
                </Chip>
                <Chip
                  variant='primary'
                  onClick={() => setIsCreateKeyModalOpen(true)}
                  disabled={createButtonDisabled}
                >
                  Generate API Key
                </Chip>
              </div>
            </div>
          )}
          {activeTab === 'chat' && (
            <div className='flex items-center justify-between gap-2 px-3 py-3'>
              <div />
              <div className='flex items-center gap-2'>
                {chatExists && (
                  <Chip
                    type='button'
                    variant='border'
                    onClick={handleChatDelete}
                    disabled={chatSubmitting}
                  >
                    Delete
                  </Chip>
                )}
                <Chip
                  type='button'
                  variant='primary'
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
                </Chip>
              </div>
            </div>
          )}
          {activeTab === 'mcp' && isDeployed && hasMcpServers && (
            <div className='flex items-center justify-between gap-2 px-3 py-3'>
              <div />
              <div className='flex items-center gap-2'>
                <Chip
                  type='button'
                  variant='border'
                  onClick={() =>
                    navigateToSettings({
                      section: 'workflow-mcp-servers',
                      mcpServerId: mcpActiveServerId ?? undefined,
                    })
                  }
                >
                  Manage
                </Chip>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span>
                      <Chip
                        type='button'
                        variant='primary'
                        onClick={handleMcpToolFormSubmit}
                        disabled={mcpToolSubmitting || !mcpToolCanSave}
                      >
                        {mcpToolSubmitting ? 'Saving...' : 'Save Tool'}
                      </Chip>
                    </span>
                  </Tooltip.Trigger>
                  {mcpToolSaveDisabledReason && (
                    <Tooltip.Content>{mcpToolSaveDisabledReason}</Tooltip.Content>
                  )}
                </Tooltip.Root>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>

      <ChipConfirmModal
        open={Boolean(undeployTargetWorkflowId)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setUndeployTargetWorkflowId(null)
        }}
        srTitle='Undeploy workflow'
        title='Undeploy workflow'
        text={[
          'Are you sure you want to undeploy this workflow? ',
          {
            text: 'This removes the live endpoint and disconnects deployed access methods.',
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
    </Popover>
  )
}

type DeploymentAttemptStatus = DeploymentOperationSummary['status']

interface StatusBadgeProps {
  isDeployed: boolean
  needsRedeployment: boolean
  attemptStatus?: DeploymentAttemptStatus
  attemptErrorMessage?: string | null
}

/**
 * Lifecycle-aware deployment status badge. Pending attempts render amber
 * (labelled Retrying once an attempt has recorded a transient error), failed
 * attempts render red with the failure reason in a tooltip, and a settled
 * live deployment falls back to the Live/Update states.
 */
function StatusBadge({
  isDeployed,
  needsRedeployment,
  attemptStatus,
  attemptErrorMessage,
}: StatusBadgeProps) {
  if (attemptStatus === 'preparing' || attemptStatus === 'activating') {
    const isRetrying = Boolean(attemptErrorMessage)
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <ChipTag variant='amber' className='cursor-default'>
            {isRetrying ? 'Retrying' : 'Pending'}
          </ChipTag>
        </Tooltip.Trigger>
        <Tooltip.Content side='top' className='max-w-[320px]'>
          {isRetrying && <p className='text-caption'>{attemptErrorMessage}</p>}
          <p className='text-caption'>
            {isRetrying
              ? isDeployed
                ? 'Retrying automatically. The current version stays live until cutover completes.'
                : 'Retrying automatically. The workflow goes live once activation completes.'
              : isDeployed
                ? 'A new version is being prepared. The current version stays live until cutover completes.'
                : 'Triggers and schedules are being registered. The workflow goes live once activation completes.'}
          </p>
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }

  if (attemptStatus === 'failed') {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <ChipTag variant='red' className='cursor-default'>
            Failed
          </ChipTag>
        </Tooltip.Trigger>
        <Tooltip.Content side='top' className='max-w-[320px]'>
          <p className='text-caption'>{attemptErrorMessage || 'Deployment preparation failed.'}</p>
          <p className='text-caption'>
            {isDeployed
              ? 'The previously deployed version is still live.'
              : 'The workflow remains undeployed.'}
          </p>
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }

  if (!isDeployed) return null

  if (!needsRedeployment) {
    return <ChipTag variant='gray'>Live</ChipTag>
  }

  return <ChipTag variant='amber'>Update deployment</ChipTag>
}

interface GeneralFooterProps {
  isDeployed?: boolean
  needsRedeployment: boolean
  isSubmitting: boolean
  deployReadiness: DeployReadiness
  isDeploymentSettling: boolean
  errorMessage?: string | null
  onDeploy: () => Promise<void>
  onRedeploy: () => Promise<void>
}

function GeneralFooter({
  isDeployed,
  needsRedeployment,
  isSubmitting,
  deployReadiness,
  isDeploymentSettling,
  errorMessage,
  onDeploy,
  onRedeploy,
}: GeneralFooterProps) {
  const isDeployBlocked = deployReadiness.isBlocked || isDeploymentSettling || isSubmitting
  const blockedMessage =
    deployReadiness.isBlocked && !deployReadiness.isSyncing && !isSubmitting
      ? deployReadiness.tooltip
      : null
  const footerMessage = errorMessage || blockedMessage
  const deployActionLoading = isSubmitting || isDeploymentSettling
  const isUpToDate = Boolean(isDeployed && !needsRedeployment && !isDeploymentSettling)
  const actionLabel = deployActionLoading
    ? isDeployed
      ? 'Updating deployment…'
      : 'Deploying workflow…'
    : !isDeployed
      ? 'Deploy workflow'
      : needsRedeployment
        ? 'Update deployment'
        : 'Up to date'

  return (
    <div className='absolute inset-x-0 bottom-0 isolate z-20 flex flex-col items-stretch gap-1 px-3 py-3 [--scroll-edge-fade-surface:var(--popover-surface)]'>
      <ScrollEdgeFade
        position='bottom'
        variant='action'
        className={cn('z-0 transform-gpu', footerMessage ? 'h-[calc(100%+1rem)]' : 'h-full')}
        visible
      />
      {footerMessage && (
        <ChipTag
          variant='red'
          className='relative z-10 w-full min-w-0'
          role='alert'
          title={footerMessage}
        >
          <span className='min-w-0 truncate'>{footerMessage}</span>
        </ChipTag>
      )}
      <Chip
        variant='primary'
        fullWidth
        className='relative z-10 justify-center [&>span]:flex-none'
        leftAdornment={
          deployActionLoading ? <Loader className='size-[14px] shrink-0' animate /> : undefined
        }
        onClick={isDeployed ? onRedeploy : onDeploy}
        disabled={isDeployBlocked || isUpToDate}
      >
        {actionLabel}
      </Chip>
    </div>
  )
}
