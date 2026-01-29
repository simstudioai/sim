'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
} from '@/components/emcn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getInputFormatExample as getInputFormatExampleUtil } from '@/lib/workflows/operations/deployment-utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { CreateApiKeyModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/api-keys/components'
import { startsWithUuid } from '@/executor/constants'
import { useA2AAgentByWorkflow } from '@/hooks/queries/a2a/agents'
import { useApiKeys } from '@/hooks/queries/api-keys'
import {
  deploymentKeys,
  useActivateDeploymentVersion,
  useChatDeploymentInfo,
  useDeploymentInfo,
  useDeploymentVersions,
  useDeployWorkflow,
  useUndeployWorkflow,
} from '@/hooks/queries/deployments'
import { useTemplateByWorkflow } from '@/hooks/queries/templates'
import { useWorkflowMcpServers } from '@/hooks/queries/workflow-mcp-servers'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsModalStore } from '@/stores/modals/settings/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { A2aDeploy } from './components/a2a/a2a'
import { ApiDeploy } from './components/api/api'
import { ChatDeploy, type ExistingChat } from './components/chat/chat'
import { ApiInfoModal } from './components/general/components/api-info-modal'
import { GeneralDeploy } from './components/general/general'
import { McpDeploy } from './components/mcp/mcp'
import { TemplateDeploy } from './components/template/template'

const logger = createLogger('DeployModal')

interface DeployModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string | null
  isDeployed: boolean
  needsRedeployment: boolean
  deployedState: WorkflowState
  isLoadingDeployedState: boolean
  refetchDeployedState: () => Promise<void>
}

interface WorkflowDeploymentInfoUI {
  isDeployed: boolean
  deployedAt?: string
  apiKey: string
  endpoint: string
  exampleCommand: string
  needsRedeployment: boolean
}

type TabView = 'general' | 'api' | 'chat' | 'template' | 'mcp' | 'form' | 'a2a'

export function DeployModal({
  open,
  onOpenChange,
  workflowId,
  isDeployed: isDeployedProp,
  needsRedeployment,
  deployedState,
  isLoadingDeployedState,
  refetchDeployedState,
}: DeployModalProps) {
  const queryClient = useQueryClient()
  const openSettingsModal = useSettingsModalStore((state) => state.openModal)
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(workflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed ?? isDeployedProp
  const workflowMetadata = useWorkflowRegistry((state) =>
    workflowId ? state.workflows[workflowId] : undefined
  )
  const workflowWorkspaceId = workflowMetadata?.workspaceId ?? null
  const [activeTab, setActiveTab] = useState<TabView>('general')
  const [chatSubmitting, setChatSubmitting] = useState(false)
  const [apiDeployError, setApiDeployError] = useState<string | null>(null)
  const [apiDeployWarnings, setApiDeployWarnings] = useState<string[]>([])
  const [isChatFormValid, setIsChatFormValid] = useState(false)
  const [selectedStreamingOutputs, setSelectedStreamingOutputs] = useState<string[]>([])

  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const [templateFormValid, setTemplateFormValid] = useState(false)
  const [templateSubmitting, setTemplateSubmitting] = useState(false)
  const [mcpToolSubmitting, setMcpToolSubmitting] = useState(false)
  const [mcpToolCanSave, setMcpToolCanSave] = useState(false)
  const [a2aSubmitting, setA2aSubmitting] = useState(false)
  const [a2aCanSave, setA2aCanSave] = useState(false)
  const [a2aNeedsRepublish, setA2aNeedsRepublish] = useState(false)
  const [showA2aDeleteConfirm, setShowA2aDeleteConfirm] = useState(false)

  const [chatSuccess, setChatSuccess] = useState(false)

  const [isCreateKeyModalOpen, setIsCreateKeyModalOpen] = useState(false)
  const [isApiInfoModalOpen, setIsApiInfoModalOpen] = useState(false)
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canAdmin
  const { config: permissionConfig } = usePermissionConfig()
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

  const { data: existingA2aAgent } = useA2AAgentByWorkflow(
    workflowWorkspaceId || '',
    workflowId || ''
  )
  const hasA2aAgent = !!existingA2aAgent
  const isA2aPublished = existingA2aAgent?.isPublished ?? false

  const { data: existingTemplate } = useTemplateByWorkflow(workflowId || '', {
    enabled: !!workflowId,
  })
  const hasExistingTemplate = !!existingTemplate
  const templateStatus = existingTemplate
    ? {
        status: existingTemplate.status as 'pending' | 'approved' | 'rejected' | null,
        views: existingTemplate.views,
        stars: existingTemplate.stars,
      }
    : null

  const deployMutation = useDeployWorkflow()
  const undeployMutation = useUndeployWorkflow()
  const activateVersionMutation = useActivateDeploymentVersion()

  const versions = versionsData?.versions ?? []

  const getApiKeyLabel = useCallback(
    (value?: string | null) => {
      if (value && value.trim().length > 0) {
        return value
      }
      return workflowWorkspaceId ? 'Workspace API keys' : 'Personal API keys'
    },
    [workflowWorkspaceId]
  )

  const getApiHeaderPlaceholder = useCallback(
    () => (workflowWorkspaceId ? 'YOUR_WORKSPACE_API_KEY' : 'YOUR_PERSONAL_API_KEY'),
    [workflowWorkspaceId]
  )

  const getInputFormatExample = useCallback(
    (includeStreaming = false) => {
      return getInputFormatExampleUtil(includeStreaming, selectedStreamingOutputs)
    },
    [selectedStreamingOutputs]
  )

  const deploymentInfo: WorkflowDeploymentInfoUI | null = useMemo(() => {
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
    }
  }, [
    deploymentInfoData,
    workflowId,
    selectedStreamingOutputs,
    getInputFormatExample,
    getApiHeaderPlaceholder,
    getApiKeyLabel,
  ])

  useEffect(() => {
    if (open && workflowId) {
      setActiveTab('general')
      setApiDeployError(null)
      setApiDeployWarnings([])
    }
  }, [open, workflowId])

  useEffect(() => {
    if (!open || selectedStreamingOutputs.length === 0) return

    const blocks = Object.values(useWorkflowStore.getState().blocks)

    const validOutputs = selectedStreamingOutputs.filter((outputId) => {
      if (startsWithUuid(outputId)) {
        const underscoreIndex = outputId.indexOf('_')
        if (underscoreIndex === -1) return false

        const blockId = outputId.substring(0, underscoreIndex)
        const block = blocks.find((b) => b.id === blockId)
        return !!block
      }

      const parts = outputId.split('.')
      if (parts.length >= 2) {
        const blockName = parts[0]
        const block = blocks.find(
          (b) => b.name?.toLowerCase().replace(/\s+/g, '') === blockName.toLowerCase()
        )
        return !!block
      }

      return true
    })

    if (validOutputs.length !== selectedStreamingOutputs.length) {
      setSelectedStreamingOutputs(validOutputs)
    }
  }, [open, selectedStreamingOutputs, setSelectedStreamingOutputs])

  useEffect(() => {
    const handleOpenDeployModal = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: TabView }>
      onOpenChange(true)
      if (customEvent.detail?.tab) {
        setActiveTab(customEvent.detail.tab)
      }
    }

    window.addEventListener('open-deploy-modal', handleOpenDeployModal)

    return () => {
      window.removeEventListener('open-deploy-modal', handleOpenDeployModal)
    }
  }, [onOpenChange])

  const onDeploy = useCallback(async () => {
    if (!workflowId) return

    setApiDeployError(null)
    setApiDeployWarnings([])

    try {
      const result = await deployMutation.mutateAsync({ workflowId, deployChatEnabled: false })
      if (result.warnings && result.warnings.length > 0) {
        setApiDeployWarnings(result.warnings)
      }
      await refetchDeployedState()
    } catch (error: unknown) {
      logger.error('Error deploying workflow:', { error })
      const errorMessage = error instanceof Error ? error.message : 'Failed to deploy workflow'
      setApiDeployError(errorMessage)
    }
  }, [workflowId, deployMutation, refetchDeployedState])

  const handlePromoteToLive = useCallback(
    async (version: number) => {
      if (!workflowId) return

      setApiDeployWarnings([])

      try {
        const result = await activateVersionMutation.mutateAsync({ workflowId, version })
        if (result.warnings && result.warnings.length > 0) {
          setApiDeployWarnings(result.warnings)
        }
        await refetchDeployedState()
      } catch (error) {
        logger.error('Error promoting version:', { error })
        throw error
      }
    },
    [workflowId, activateVersionMutation, refetchDeployedState]
  )

  const handleUndeploy = useCallback(async () => {
    if (!workflowId) return

    try {
      await undeployMutation.mutateAsync({ workflowId })
      setShowUndeployConfirm(false)
      onOpenChange(false)
    } catch (error: unknown) {
      logger.error('Error undeploying workflow:', { error })
    }
  }, [workflowId, undeployMutation, onOpenChange])

  const handleRedeploy = useCallback(async () => {
    if (!workflowId) return

    setApiDeployError(null)
    setApiDeployWarnings([])

    try {
      const result = await deployMutation.mutateAsync({ workflowId, deployChatEnabled: false })
      if (result.warnings && result.warnings.length > 0) {
        setApiDeployWarnings(result.warnings)
      }
      await refetchDeployedState()
    } catch (error: unknown) {
      logger.error('Error redeploying workflow:', { error })
      const errorMessage = error instanceof Error ? error.message : 'Failed to redeploy workflow'
      setApiDeployError(errorMessage)
    }
  }, [workflowId, deployMutation, refetchDeployedState])

  const handleCloseModal = useCallback(() => {
    setChatSubmitting(false)
    setApiDeployError(null)
    setApiDeployWarnings([])
    onOpenChange(false)
  }, [onOpenChange])

  const handleChatDeployed = useCallback(async () => {
    if (!workflowId) return

    queryClient.invalidateQueries({ queryKey: deploymentKeys.info(workflowId) })
    queryClient.invalidateQueries({ queryKey: deploymentKeys.versions(workflowId) })
    queryClient.invalidateQueries({ queryKey: deploymentKeys.chatStatus(workflowId) })

    await refetchDeployedState()
    useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, false)

    setChatSuccess(true)
    setTimeout(() => setChatSuccess(false), 2000)
  }, [workflowId, queryClient, refetchDeployedState])

  const handleRefetchChat = useCallback(async () => {
    await refetchChatInfo()
  }, [refetchChatInfo])

  const handleChatFormSubmit = useCallback(() => {
    const form = document.getElementById('chat-deploy-form') as HTMLFormElement
    if (form) {
      const updateTrigger = form.querySelector('[data-update-trigger]') as HTMLButtonElement
      if (updateTrigger) {
        updateTrigger.click()
      } else {
        form.requestSubmit()
      }
    }
  }, [])

  const handleChatDelete = useCallback(() => {
    const form = document.getElementById('chat-deploy-form') as HTMLFormElement
    if (form) {
      const deleteButton = form.querySelector('[data-delete-trigger]') as HTMLButtonElement
      if (deleteButton) {
        deleteButton.click()
      }
    }
  }, [])

  const handleTemplateFormSubmit = useCallback(() => {
    const form = document.getElementById('template-deploy-form') as HTMLFormElement
    form?.requestSubmit()
  }, [])

  const handleMcpToolFormSubmit = useCallback(() => {
    const form = document.getElementById('mcp-deploy-form') as HTMLFormElement
    form?.requestSubmit()
  }, [])

  const handleA2aPublish = useCallback(() => {
    const form = document.getElementById('a2a-deploy-form')
    const publishTrigger = form?.querySelector('[data-a2a-publish-trigger]') as HTMLButtonElement
    publishTrigger?.click()
  }, [])

  const handleA2aUnpublish = useCallback(() => {
    const form = document.getElementById('a2a-deploy-form')
    const unpublishTrigger = form?.querySelector(
      '[data-a2a-unpublish-trigger]'
    ) as HTMLButtonElement
    unpublishTrigger?.click()
  }, [])

  const handleA2aPublishNew = useCallback(() => {
    const form = document.getElementById('a2a-deploy-form')
    const publishNewTrigger = form?.querySelector(
      '[data-a2a-publish-new-trigger]'
    ) as HTMLButtonElement
    publishNewTrigger?.click()
  }, [])

  const handleA2aUpdateRepublish = useCallback(() => {
    const form = document.getElementById('a2a-deploy-form')
    const updateRepublishTrigger = form?.querySelector(
      '[data-a2a-update-republish-trigger]'
    ) as HTMLButtonElement
    updateRepublishTrigger?.click()
  }, [])

  const handleA2aDelete = useCallback(() => {
    const form = document.getElementById('a2a-deploy-form')
    const deleteTrigger = form?.querySelector('[data-a2a-delete-trigger]') as HTMLButtonElement
    deleteTrigger?.click()
    setShowA2aDeleteConfirm(false)
  }, [])

  const handleTemplateDelete = useCallback(() => {
    const form = document.getElementById('template-deploy-form')
    const deleteTrigger = form?.querySelector('[data-template-delete-trigger]') as HTMLButtonElement
    deleteTrigger?.click()
  }, [])

  const isSubmitting = deployMutation.isPending
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
              {!permissionConfig.hideDeployA2a && (
                <ModalTabsTrigger value='a2a'>A2A</ModalTabsTrigger>
              )}
              {!permissionConfig.hideDeployChatbot && (
                <ModalTabsTrigger value='chat'>Chat</ModalTabsTrigger>
              )}
              {/* <ModalTabsTrigger value='form'>Form</ModalTabsTrigger> */}
              {!permissionConfig.hideDeployTemplate && (
                <ModalTabsTrigger value='template'>Template</ModalTabsTrigger>
              )}
            </ModalTabsList>

            <ModalBody className='min-h-0 flex-1'>
              {apiDeployError && (
                <div className='mb-3 rounded-[4px] border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm'>
                  <div className='font-semibold'>Deployment Error</div>
                  <div>{apiDeployError}</div>
                </div>
              )}
              {apiDeployWarnings.length > 0 && (
                <div className='mb-3 rounded-[4px] border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 text-sm dark:text-amber-400'>
                  <div className='font-semibold'>Deployment Warning</div>
                  {apiDeployWarnings.map((warning, index) => (
                    <div key={index}>{warning}</div>
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
                  onPromoteToLive={handlePromoteToLive}
                  onLoadDeploymentComplete={handleCloseModal}
                />
              </ModalTabsContent>

              <ModalTabsContent value='api'>
                <ApiDeploy
                  workflowId={workflowId}
                  deploymentInfo={deploymentInfo}
                  isLoading={isLoadingDeploymentInfo}
                  needsRedeployment={needsRedeployment}
                  apiDeployError={apiDeployError}
                  getInputFormatExample={getInputFormatExample}
                  selectedStreamingOutputs={selectedStreamingOutputs}
                  onSelectedStreamingOutputsChange={setSelectedStreamingOutputs}
                />
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

              <ModalTabsContent value='template'>
                {workflowId && (
                  <TemplateDeploy
                    workflowId={workflowId}
                    onDeploymentComplete={handleCloseModal}
                    onValidationChange={setTemplateFormValid}
                    onSubmittingChange={setTemplateSubmitting}
                  />
                )}
              </ModalTabsContent>

              {/* <ModalTabsContent value='form'>
                {workflowId && (
                  <FormDeploy
                    workflowId={workflowId}
                    onDeploymentComplete={handleCloseModal}
                    onValidationChange={setIsFormValid}
                    onSubmittingChange={setFormSubmitting}
                    onExistingFormChange={setFormExists}
                    formSubmitting={formSubmitting}
                    setFormSubmitting={setFormSubmitting}
                    onDeployed={handleFormDeployed}
                  />
                )}
              </ModalTabsContent> */}

              <ModalTabsContent value='mcp' className='h-full'>
                {workflowId && (
                  <McpDeploy
                    workflowId={workflowId}
                    workflowName={workflowMetadata?.name || 'Workflow'}
                    workflowDescription={workflowMetadata?.description}
                    isDeployed={isDeployed}
                    onSubmittingChange={setMcpToolSubmitting}
                    onCanSaveChange={setMcpToolCanSave}
                  />
                )}
              </ModalTabsContent>

              <ModalTabsContent value='a2a' className='h-full'>
                {workflowId && (
                  <A2aDeploy
                    workflowId={workflowId}
                    workflowName={workflowMetadata?.name || 'Workflow'}
                    workflowDescription={workflowMetadata?.description}
                    isDeployed={isDeployed}
                    workflowNeedsRedeployment={needsRedeployment}
                    onSubmittingChange={setA2aSubmitting}
                    onCanSaveChange={setA2aCanSave}
                    onNeedsRepublishChange={setA2aNeedsRepublish}
                    onDeployWorkflow={onDeploy}
                  />
                )}
              </ModalTabsContent>
            </ModalBody>
          </ModalTabs>

          {activeTab === 'general' && (
            <GeneralFooter
              isDeployed={isDeployed}
              needsRedeployment={needsRedeployment}
              isSubmitting={isSubmitting}
              isUndeploying={isUndeploying}
              onDeploy={onDeploy}
              onRedeploy={handleRedeploy}
              onUndeploy={() => setShowUndeployConfirm(true)}
            />
          )}
          {activeTab === 'api' && (
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
          {activeTab === 'mcp' && isDeployed && hasMcpServers && (
            <ModalFooter className='items-center justify-between'>
              <div />
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  variant='default'
                  onClick={() => openSettingsModal({ section: 'workflow-mcp-servers' })}
                >
                  Manage
                </Button>
                <Button
                  type='button'
                  variant='tertiary'
                  onClick={handleMcpToolFormSubmit}
                  disabled={mcpToolSubmitting || !mcpToolCanSave}
                >
                  {mcpToolSubmitting ? 'Saving...' : 'Save Tool'}
                </Button>
              </div>
            </ModalFooter>
          )}
          {activeTab === 'template' && (
            <ModalFooter className='items-center justify-between'>
              {hasExistingTemplate && templateStatus ? (
                <TemplateStatusBadge
                  status={templateStatus.status}
                  views={templateStatus.views}
                  stars={templateStatus.stars}
                />
              ) : (
                <div />
              )}
              <div className='flex items-center gap-2'>
                {hasExistingTemplate && (
                  <Button
                    type='button'
                    variant='destructive'
                    onClick={handleTemplateDelete}
                    disabled={templateSubmitting}
                  >
                    Delete
                  </Button>
                )}
                <Button
                  type='button'
                  variant='tertiary'
                  onClick={handleTemplateFormSubmit}
                  disabled={templateSubmitting || !templateFormValid}
                >
                  {templateSubmitting
                    ? hasExistingTemplate
                      ? 'Updating...'
                      : 'Publishing...'
                    : hasExistingTemplate
                      ? 'Update Template'
                      : 'Publish Template'}
                </Button>
              </div>
            </ModalFooter>
          )}
          {/* {activeTab === 'form' && (
            <ModalFooter className='items-center justify-between'>
              <div />
              <div className='flex items-center gap-2'>
                {formExists && (
                  <Button
                    type='button'
                    variant='destructive'
                    onClick={handleFormDelete}
                    disabled={formSubmitting}
                  >
                    Delete
                  </Button>
                )}
                <Button
                  type='button'
                  variant='tertiary'
                  onClick={handleFormFormSubmit}
                  disabled={formSubmitting || !isFormValid}
                >
                  {formSuccess
                    ? formExists
                      ? 'Updated'
                      : 'Launched'
                    : formSubmitting
                      ? formExists
                        ? 'Updating...'
                        : 'Launching...'
                      : formExists
                        ? 'Update'
                        : 'Launch Form'}
                </Button>
              </div>
            </ModalFooter>
          )} */}
          {activeTab === 'a2a' && (
            <ModalFooter className='items-center justify-between'>
              {/* Status badge on left */}
              {hasA2aAgent ? (
                isA2aPublished ? (
                  <Badge variant={a2aNeedsRepublish ? 'amber' : 'green'} size='lg' dot>
                    {a2aNeedsRepublish ? 'Update deployment' : 'Live'}
                  </Badge>
                ) : (
                  <Badge variant='red' size='lg' dot>
                    Unpublished
                  </Badge>
                )
              ) : (
                <div />
              )}
              <div className='flex items-center gap-2'>
                {/* No agent exists: Show "Publish Agent" button */}
                {!hasA2aAgent && (
                  <Button
                    type='button'
                    variant='tertiary'
                    onClick={handleA2aPublishNew}
                    disabled={a2aSubmitting || !a2aCanSave}
                  >
                    {a2aSubmitting ? 'Publishing...' : 'Publish Agent'}
                  </Button>
                )}

                {/* Agent exists and published: Show Unpublish and Update */}
                {hasA2aAgent && isA2aPublished && (
                  <>
                    <Button
                      type='button'
                      variant='default'
                      onClick={handleA2aUnpublish}
                      disabled={a2aSubmitting}
                    >
                      Unpublish
                    </Button>
                    <Button
                      type='button'
                      variant='tertiary'
                      onClick={handleA2aUpdateRepublish}
                      disabled={a2aSubmitting || !a2aCanSave || !a2aNeedsRepublish}
                    >
                      {a2aSubmitting ? 'Updating...' : 'Update'}
                    </Button>
                  </>
                )}

                {/* Agent exists but unpublished: Show Delete and Publish */}
                {hasA2aAgent && !isA2aPublished && (
                  <>
                    <Button
                      type='button'
                      variant='default'
                      onClick={() => setShowA2aDeleteConfirm(true)}
                      disabled={a2aSubmitting}
                    >
                      Delete
                    </Button>
                    <Button
                      type='button'
                      variant='tertiary'
                      onClick={handleA2aPublish}
                      disabled={a2aSubmitting || !a2aCanSave}
                    >
                      {a2aSubmitting ? 'Publishing...' : 'Publish'}
                    </Button>
                  </>
                )}
              </div>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      <Modal open={showUndeployConfirm} onOpenChange={setShowUndeployConfirm}>
        <ModalContent size='sm'>
          <ModalHeader>Undeploy API</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to undeploy this workflow?{' '}
              <span className='text-[var(--text-error)]'>
                This will remove the API endpoint and make it unavailable to external users.
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setShowUndeployConfirm(false)}
              disabled={isUndeploying}
            >
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleUndeploy} disabled={isUndeploying}>
              {isUndeploying ? 'Undeploying...' : 'Undeploy'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showA2aDeleteConfirm} onOpenChange={setShowA2aDeleteConfirm}>
        <ModalContent size='sm'>
          <ModalHeader>Delete A2A Agent</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {existingA2aAgent?.name || 'this agent'}
              </span>
              ?{' '}
              <span className='text-[var(--text-error)]'>
                This will permanently remove the agent configuration.
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setShowA2aDeleteConfirm(false)}
              disabled={a2aSubmitting}
            >
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleA2aDelete} disabled={a2aSubmitting}>
              {a2aSubmitting ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <CreateApiKeyModal
        open={isCreateKeyModalOpen}
        onOpenChange={setIsCreateKeyModalOpen}
        workspaceId={workflowWorkspaceId || ''}
        existingKeyNames={[...apiKeyWorkspaceKeys, ...apiKeyPersonalKeys].map((k) => k.name)}
        allowPersonalApiKeys={allowPersonalApiKeys}
        canManageWorkspaceKeys={canManageWorkspaceKeys}
        defaultKeyType={defaultKeyType}
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

interface TemplateStatusBadgeProps {
  status: 'pending' | 'approved' | 'rejected' | null
  views?: number
  stars?: number
}

function TemplateStatusBadge({ status, views, stars }: TemplateStatusBadgeProps) {
  const isPending = status === 'pending'
  const label = isPending ? 'Under review' : 'Live'

  const statsText =
    status === 'approved' && views !== undefined && views > 0
      ? `${views} views${stars !== undefined && stars > 0 ? ` • ${stars} stars` : ''}`
      : null

  return (
    <Badge variant={isPending ? 'amber' : 'green'} size='lg' dot>
      {label}
      {statsText && <span>• {statsText}</span>}
    </Badge>
  )
}

interface GeneralFooterProps {
  isDeployed?: boolean
  needsRedeployment: boolean
  isSubmitting: boolean
  isUndeploying: boolean
  onDeploy: () => Promise<void>
  onRedeploy: () => Promise<void>
  onUndeploy: () => void
}

function GeneralFooter({
  isDeployed,
  needsRedeployment,
  isSubmitting,
  isUndeploying,
  onDeploy,
  onRedeploy,
  onUndeploy,
}: GeneralFooterProps) {
  if (!isDeployed) {
    return (
      <ModalFooter className='items-center justify-between'>
        <div />
        <div className='flex items-center gap-2'>
          <Button variant='tertiary' onClick={onDeploy} disabled={isSubmitting}>
            {isSubmitting ? 'Deploying...' : 'Deploy'}
          </Button>
        </div>
      </ModalFooter>
    )
  }

  return (
    <ModalFooter className='items-center justify-between'>
      <StatusBadge isWarning={needsRedeployment} />
      <div className='flex items-center gap-2'>
        <Button
          variant='default'
          onClick={onUndeploy}
          disabled={isUndeploying || isSubmitting}
          className='px-[7px] py-[5px]'
        >
          {isUndeploying ? 'Undeploying...' : 'Undeploy'}
        </Button>
        {needsRedeployment && (
          <Button variant='tertiary' onClick={onRedeploy} disabled={isSubmitting || isUndeploying}>
            {isSubmitting ? 'Updating...' : 'Update'}
          </Button>
        )}
      </div>
    </ModalFooter>
  )
}
