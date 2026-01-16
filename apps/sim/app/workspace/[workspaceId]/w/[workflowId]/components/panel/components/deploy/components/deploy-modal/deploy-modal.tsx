'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
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
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { CreateApiKeyModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/api-keys/components'
import { startsWithUuid } from '@/executor/constants'
import { useApiKeys } from '@/hooks/queries/api-keys'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import { useSettingsModalStore } from '@/stores/modals/settings/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { A2aDeploy } from './components/a2a/a2a'
import { ApiDeploy } from './components/api/api'
import { ChatDeploy, type ExistingChat } from './components/chat/chat'
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

interface WorkflowDeploymentInfo {
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
  const openSettingsModal = useSettingsModalStore((state) => state.openModal)
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(workflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed ?? isDeployedProp
  const setDeploymentStatus = useWorkflowRegistry((state) => state.setDeploymentStatus)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUndeploying, setIsUndeploying] = useState(false)
  const [deploymentInfo, setDeploymentInfo] = useState<WorkflowDeploymentInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const workflowMetadata = useWorkflowRegistry((state) =>
    workflowId ? state.workflows[workflowId] : undefined
  )
  const workflowWorkspaceId = workflowMetadata?.workspaceId ?? null
  const [activeTab, setActiveTab] = useState<TabView>('general')
  const [chatSubmitting, setChatSubmitting] = useState(false)
  const [apiDeployError, setApiDeployError] = useState<string | null>(null)
  const [chatExists, setChatExists] = useState(false)
  const [isChatFormValid, setIsChatFormValid] = useState(false)
  const [selectedStreamingOutputs, setSelectedStreamingOutputs] = useState<string[]>([])

  const [versions, setVersions] = useState<WorkflowDeploymentVersionResponse[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)
  const [templateFormValid, setTemplateFormValid] = useState(false)
  const [templateSubmitting, setTemplateSubmitting] = useState(false)
  const [mcpToolSubmitting, setMcpToolSubmitting] = useState(false)
  const [mcpToolCanSave, setMcpToolCanSave] = useState(false)
  const [hasMcpServers, setHasMcpServers] = useState(false)
  const [a2aSubmitting, setA2aSubmitting] = useState(false)
  const [a2aCanSave, setA2aCanSave] = useState(false)
  const [hasA2aAgent, setHasA2aAgent] = useState(false)
  const [isA2aPublished, setIsA2aPublished] = useState(false)
  const [a2aNeedsRepublish, setA2aNeedsRepublish] = useState(false)
  const [showA2aDeleteConfirm, setShowA2aDeleteConfirm] = useState(false)
  const [hasExistingTemplate, setHasExistingTemplate] = useState(false)
  const [templateStatus, setTemplateStatus] = useState<{
    status: 'pending' | 'approved' | 'rejected' | null
    views?: number
    stars?: number
  } | null>(null)

  const [existingChat, setExistingChat] = useState<ExistingChat | null>(null)
  const [isLoadingChat, setIsLoadingChat] = useState(false)

  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formExists, setFormExists] = useState(false)
  const [isFormValid, setIsFormValid] = useState(false)

  const [chatSuccess, setChatSuccess] = useState(false)
  const [formSuccess, setFormSuccess] = useState(false)

  const [isCreateKeyModalOpen, setIsCreateKeyModalOpen] = useState(false)
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canAdmin
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

  const fetchChatDeploymentInfo = useCallback(async () => {
    if (!workflowId) return

    try {
      setIsLoadingChat(true)
      const response = await fetch(`/api/workflows/${workflowId}/chat/status`)

      if (response.ok) {
        const data = await response.json()
        if (data.isDeployed && data.deployment) {
          const detailResponse = await fetch(`/api/chat/manage/${data.deployment.id}`)
          if (detailResponse.ok) {
            const chatDetail = await detailResponse.json()
            setExistingChat(chatDetail)
            setChatExists(true)
          } else {
            setExistingChat(null)
            setChatExists(false)
          }
        } else {
          setExistingChat(null)
          setChatExists(false)
        }
      } else {
        setExistingChat(null)
        setChatExists(false)
      }
    } catch (error) {
      logger.error('Error fetching chat deployment info:', { error })
      setExistingChat(null)
      setChatExists(false)
    } finally {
      setIsLoadingChat(false)
    }
  }, [workflowId])

  useEffect(() => {
    if (open && workflowId) {
      setActiveTab('general')
      fetchChatDeploymentInfo()
    }
  }, [open, workflowId, fetchChatDeploymentInfo])

  useEffect(() => {
    async function fetchDeploymentInfo() {
      if (!open || !workflowId || !isDeployed) {
        setDeploymentInfo(null)
        setIsLoading(false)
        return
      }

      if (deploymentInfo?.isDeployed && !needsRedeployment) {
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)

        const response = await fetch(`/api/workflows/${workflowId}/deploy`)

        if (!response.ok) {
          throw new Error('Failed to fetch deployment information')
        }

        const data = await response.json()
        const endpoint = `${getBaseUrl()}/api/workflows/${workflowId}/execute`
        const inputFormatExample = getInputFormatExample(selectedStreamingOutputs.length > 0)
        const placeholderKey = workflowWorkspaceId ? 'YOUR_WORKSPACE_API_KEY' : 'YOUR_API_KEY'

        setDeploymentInfo({
          isDeployed: data.isDeployed,
          deployedAt: data.deployedAt,
          apiKey: data.apiKey || placeholderKey,
          endpoint,
          exampleCommand: `curl -X POST -H "X-API-Key: ${placeholderKey}" -H "Content-Type: application/json"${inputFormatExample} ${endpoint}`,
          needsRedeployment,
        })
      } catch (error) {
        logger.error('Error fetching deployment info:', { error })
      } finally {
        setIsLoading(false)
      }
    }

    fetchDeploymentInfo()
  }, [open, workflowId, isDeployed, needsRedeployment, deploymentInfo?.isDeployed])

  const onDeploy = async () => {
    setApiDeployError(null)

    try {
      setIsSubmitting(true)

      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deployChatEnabled: false,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to deploy workflow')
      }

      const responseData = await response.json()

      const isDeployedStatus = responseData.isDeployed ?? false
      const deployedAtTime = responseData.deployedAt ? new Date(responseData.deployedAt) : undefined
      const apiKeyLabel = getApiKeyLabel(responseData.apiKey)

      setDeploymentStatus(workflowId, isDeployedStatus, deployedAtTime, apiKeyLabel)

      if (workflowId) {
        useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, false)
      }

      await refetchDeployedState()
      await fetchVersions()

      const deploymentInfoResponse = await fetch(`/api/workflows/${workflowId}/deploy`)
      if (deploymentInfoResponse.ok) {
        const deploymentData = await deploymentInfoResponse.json()
        const apiEndpoint = `${getBaseUrl()}/api/workflows/${workflowId}/execute`
        const inputFormatExample = getInputFormatExample(selectedStreamingOutputs.length > 0)
        const placeholderKey = getApiHeaderPlaceholder()

        setDeploymentInfo({
          isDeployed: deploymentData.isDeployed,
          deployedAt: deploymentData.deployedAt,
          apiKey: getApiKeyLabel(deploymentData.apiKey),
          endpoint: apiEndpoint,
          exampleCommand: `curl -X POST -H "X-API-Key: ${placeholderKey}" -H "Content-Type: application/json"${inputFormatExample} ${apiEndpoint}`,
          needsRedeployment: false,
        })
      }

      setApiDeployError(null)
    } catch (error: unknown) {
      logger.error('Error deploying workflow:', { error })
      const errorMessage = error instanceof Error ? error.message : 'Failed to deploy workflow'
      setApiDeployError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  const fetchVersions = useCallback(async () => {
    if (!workflowId) return
    try {
      const res = await fetch(`/api/workflows/${workflowId}/deployments`)
      if (res.ok) {
        const data = await res.json()
        setVersions(Array.isArray(data.versions) ? data.versions : [])
      } else {
        setVersions([])
      }
    } catch {
      setVersions([])
    }
  }, [workflowId])

  useEffect(() => {
    if (open && workflowId) {
      setVersionsLoading(true)
      fetchVersions().finally(() => setVersionsLoading(false))
    }
  }, [open, workflowId, fetchVersions])

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

  const handlePromoteToLive = useCallback(
    async (version: number) => {
      if (!workflowId) return

      const previousVersions = [...versions]
      setVersions((prev) =>
        prev.map((v) => ({
          ...v,
          isActive: v.version === version,
        }))
      )

      try {
        const response = await fetch(
          `/api/workflows/${workflowId}/deployments/${version}/activate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to promote version')
        }

        const responseData = await response.json()

        const deployedAtTime = responseData.deployedAt
          ? new Date(responseData.deployedAt)
          : undefined
        const apiKeyLabel = getApiKeyLabel(responseData.apiKey)

        setDeploymentStatus(workflowId, true, deployedAtTime, apiKeyLabel)

        refetchDeployedState()
        fetchVersions()

        const deploymentInfoResponse = await fetch(`/api/workflows/${workflowId}/deploy`)
        if (deploymentInfoResponse.ok) {
          const deploymentData = await deploymentInfoResponse.json()
          const apiEndpoint = `${getBaseUrl()}/api/workflows/${workflowId}/execute`
          const inputFormatExample = getInputFormatExample(selectedStreamingOutputs.length > 0)
          const placeholderKey = getApiHeaderPlaceholder()

          setDeploymentInfo({
            isDeployed: deploymentData.isDeployed,
            deployedAt: deploymentData.deployedAt,
            apiKey: getApiKeyLabel(deploymentData.apiKey),
            endpoint: apiEndpoint,
            exampleCommand: `curl -X POST -H "X-API-Key: ${placeholderKey}" -H "Content-Type: application/json"${inputFormatExample} ${apiEndpoint}`,
            needsRedeployment: false,
          })
        }
      } catch (error) {
        setVersions(previousVersions)
        throw error
      }
    },
    [workflowId, versions, refetchDeployedState, fetchVersions, selectedStreamingOutputs]
  )

  const handleUndeploy = async () => {
    try {
      setIsUndeploying(true)

      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to undeploy workflow')
      }

      setDeploymentStatus(workflowId, false)
      setChatExists(false)
      setShowUndeployConfirm(false)
      onOpenChange(false)
    } catch (error: unknown) {
      logger.error('Error undeploying workflow:', { error })
    } finally {
      setIsUndeploying(false)
    }
  }

  const handleRedeploy = async () => {
    try {
      setIsSubmitting(true)

      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deployChatEnabled: false,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to redeploy workflow')
      }

      const { isDeployed: newDeployStatus, deployedAt, apiKey } = await response.json()

      setDeploymentStatus(
        workflowId,
        newDeployStatus,
        deployedAt ? new Date(deployedAt) : undefined,
        getApiKeyLabel(apiKey)
      )

      if (workflowId) {
        useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, false)
      }

      await refetchDeployedState()
      await fetchVersions()

      setDeploymentInfo((prev) => (prev ? { ...prev, needsRedeployment: false } : prev))
    } catch (error: unknown) {
      logger.error('Error redeploying workflow:', { error })
      const errorMessage = error instanceof Error ? error.message : 'Failed to redeploy workflow'
      setApiDeployError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCloseModal = () => {
    setIsSubmitting(false)
    setChatSubmitting(false)
    onOpenChange(false)
  }

  const handleChatDeployed = async () => {
    await handlePostDeploymentUpdate()
    setChatSuccess(true)
    setTimeout(() => setChatSuccess(false), 2000)
  }

  const handleFormDeployed = async () => {
    await handlePostDeploymentUpdate()
    setFormSuccess(true)
    setTimeout(() => setFormSuccess(false), 2000)
  }

  const handlePostDeploymentUpdate = async () => {
    if (!workflowId) return

    setDeploymentStatus(workflowId, true, new Date(), getApiKeyLabel())

    const deploymentInfoResponse = await fetch(`/api/workflows/${workflowId}/deploy`)
    if (deploymentInfoResponse.ok) {
      const deploymentData = await deploymentInfoResponse.json()
      const apiEndpoint = `${getBaseUrl()}/api/workflows/${workflowId}/execute`
      const inputFormatExample = getInputFormatExample(selectedStreamingOutputs.length > 0)

      const placeholderKey = getApiHeaderPlaceholder()

      setDeploymentInfo({
        isDeployed: deploymentData.isDeployed,
        deployedAt: deploymentData.deployedAt,
        apiKey: getApiKeyLabel(deploymentData.apiKey),
        endpoint: apiEndpoint,
        exampleCommand: `curl -X POST -H "X-API-Key: ${placeholderKey}" -H "Content-Type: application/json"${inputFormatExample} ${apiEndpoint}`,
        needsRedeployment: false,
      })
    }

    await refetchDeployedState()
    await fetchVersions()
    useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, false)
  }

  const handleChatFormSubmit = () => {
    const form = document.getElementById('chat-deploy-form') as HTMLFormElement
    if (form) {
      const updateTrigger = form.querySelector('[data-update-trigger]') as HTMLButtonElement
      if (updateTrigger) {
        updateTrigger.click()
      } else {
        form.requestSubmit()
      }
    }
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

  const handleTemplateFormSubmit = useCallback(() => {
    const form = document.getElementById('template-deploy-form') as HTMLFormElement
    form?.requestSubmit()
  }, [])

  const handleMcpToolFormSubmit = useCallback(() => {
    const form = document.getElementById('mcp-deploy-form') as HTMLFormElement
    form?.requestSubmit()
  }, [])

  const handleA2aFormSubmit = useCallback(() => {
    const form = document.getElementById('a2a-deploy-form') as HTMLFormElement
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

  const handleFormFormSubmit = useCallback(() => {
    const form = document.getElementById('form-deploy-form') as HTMLFormElement
    form?.requestSubmit()
  }, [])

  const handleFormDelete = useCallback(() => {
    const form = document.getElementById('form-deploy-form')
    const deleteTrigger = form?.querySelector('[data-delete-trigger]') as HTMLButtonElement
    deleteTrigger?.click()
  }, [])

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
              <ModalTabsTrigger value='api'>API</ModalTabsTrigger>
              <ModalTabsTrigger value='mcp'>MCP</ModalTabsTrigger>
              <ModalTabsTrigger value='a2a'>A2A</ModalTabsTrigger>
              <ModalTabsTrigger value='chat'>Chat</ModalTabsTrigger>
              {/* <ModalTabsTrigger value='form'>Form</ModalTabsTrigger> */}
              <ModalTabsTrigger value='template'>Template</ModalTabsTrigger>
            </ModalTabsList>

            <ModalBody className='min-h-0 flex-1'>
              <ModalTabsContent value='general'>
                <GeneralDeploy
                  workflowId={workflowId}
                  deployedState={deployedState}
                  isLoadingDeployedState={isLoadingDeployedState}
                  versions={versions}
                  versionsLoading={versionsLoading}
                  onPromoteToLive={handlePromoteToLive}
                  onLoadDeploymentComplete={handleCloseModal}
                  fetchVersions={fetchVersions}
                />
              </ModalTabsContent>

              <ModalTabsContent value='api'>
                <ApiDeploy
                  workflowId={workflowId}
                  deploymentInfo={deploymentInfo}
                  isLoading={isLoading}
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
                  existingChat={existingChat}
                  isLoadingChat={isLoadingChat}
                  onRefetchChat={fetchChatDeploymentInfo}
                  onChatExistsChange={setChatExists}
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
                    onExistingTemplateChange={setHasExistingTemplate}
                    onTemplateStatusChange={setTemplateStatus}
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
                    onHasServersChange={setHasMcpServers}
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
                    onAgentExistsChange={setHasA2aAgent}
                    onPublishedChange={setIsA2aPublished}
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
                  {mcpToolSubmitting ? 'Saving...' : 'Save Tool Schema'}
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
              Are you sure you want to delete this agent?{' '}
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
