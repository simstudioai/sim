'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, MoreVertical, X } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/db-helpers'
import { resolveStartCandidates, StartBlockPath } from '@/lib/workflows/triggers'
import {
  DeploymentInfo,
  TemplateDeploy,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components'
import { ChatDeploy } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/chat-deploy'
import { DeployedWorkflowModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deployment-controls/components/deployed-workflow-modal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeployModal')
interface DeployModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string | null
  needsRedeployment: boolean
  setNeedsRedeployment: (value: boolean) => void
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

type TabView = 'api' | 'versions' | 'chat' | 'template'

export function DeployModal({
  open,
  onOpenChange,
  workflowId,
  needsRedeployment,
  setNeedsRedeployment,
  deployedState,
  isLoadingDeployedState,
  refetchDeployedState,
}: DeployModalProps) {
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(workflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed || false
  const setDeploymentStatus = useWorkflowRegistry((state) => state.setDeploymentStatus)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUndeploying, setIsUndeploying] = useState(false)
  const [deploymentInfo, setDeploymentInfo] = useState<WorkflowDeploymentInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const workflowMetadata = useWorkflowRegistry((state) =>
    workflowId ? state.workflows[workflowId] : undefined
  )
  const workflowWorkspaceId = workflowMetadata?.workspaceId ?? null
  const [activeTab, setActiveTab] = useState<TabView>('api')
  const [chatSubmitting, setChatSubmitting] = useState(false)
  const [apiDeployError, setApiDeployError] = useState<string | null>(null)
  const [chatExists, setChatExists] = useState(false)
  const [isChatFormValid, setIsChatFormValid] = useState(false)
  const [selectedStreamingOutputs, setSelectedStreamingOutputs] = useState<string[]>([])

  const [versions, setVersions] = useState<WorkflowDeploymentVersionResponse[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [activatingVersion, setActivatingVersion] = useState<number | null>(null)
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewDeployedState, setPreviewDeployedState] = useState<WorkflowState | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 5
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const [versionToActivate, setVersionToActivate] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingVersion !== null && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingVersion])

  const getApiKeyLabel = (value?: string | null) => {
    if (value && value.trim().length > 0) {
      return value
    }
    return workflowWorkspaceId ? 'Workspace API keys' : 'Personal API keys'
  }

  const getApiHeaderPlaceholder = () =>
    workflowWorkspaceId ? 'YOUR_WORKSPACE_API_KEY' : 'YOUR_PERSONAL_API_KEY'

  const getInputFormatExample = (includeStreaming = false) => {
    let inputFormatExample = ''
    try {
      const blocks = Object.values(useWorkflowStore.getState().blocks)
      const candidates = resolveStartCandidates(useWorkflowStore.getState().blocks, {
        execution: 'api',
      })

      const targetCandidate =
        candidates.find((candidate) => candidate.path === StartBlockPath.UNIFIED) ||
        candidates.find((candidate) => candidate.path === StartBlockPath.SPLIT_API) ||
        candidates.find((candidate) => candidate.path === StartBlockPath.SPLIT_INPUT) ||
        candidates.find((candidate) => candidate.path === StartBlockPath.LEGACY_STARTER)

      const targetBlock = targetCandidate?.block

      if (targetBlock) {
        const inputFormat = useSubBlockStore.getState().getValue(targetBlock.id, 'inputFormat')

        const exampleData: Record<string, any> = {}

        if (inputFormat && Array.isArray(inputFormat) && inputFormat.length > 0) {
          inputFormat.forEach((field: any) => {
            if (field.name) {
              switch (field.type) {
                case 'string':
                  exampleData[field.name] = 'example'
                  break
                case 'number':
                  exampleData[field.name] = 42
                  break
                case 'boolean':
                  exampleData[field.name] = true
                  break
                case 'object':
                  exampleData[field.name] = { key: 'value' }
                  break
                case 'array':
                  exampleData[field.name] = [1, 2, 3]
                  break
                case 'files':
                  exampleData[field.name] = [
                    {
                      data: 'data:application/pdf;base64,...',
                      type: 'file',
                      name: 'document.pdf',
                      mime: 'application/pdf',
                    },
                  ]
                  break
              }
            }
          })
        }

        // Add streaming parameters if enabled and outputs are selected
        if (includeStreaming && selectedStreamingOutputs.length > 0) {
          exampleData.stream = true
          // Convert blockId_attribute format to blockName.attribute format for display
          const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

          const convertedOutputs = selectedStreamingOutputs
            .map((outputId) => {
              // If it starts with a UUID, convert to blockName.attribute format
              if (UUID_REGEX.test(outputId)) {
                const underscoreIndex = outputId.indexOf('_')
                if (underscoreIndex === -1) return null

                const blockId = outputId.substring(0, underscoreIndex)
                const attribute = outputId.substring(underscoreIndex + 1)

                // Find the block by ID and get its name
                const block = blocks.find((b) => b.id === blockId)
                if (block?.name) {
                  // Normalize block name: lowercase and remove spaces
                  const normalizedBlockName = block.name.toLowerCase().replace(/\s+/g, '')
                  return `${normalizedBlockName}.${attribute}`
                }
                // Block not found (deleted), return null to filter out
                return null
              }

              // Already in blockName.attribute format, verify the block exists
              const parts = outputId.split('.')
              if (parts.length >= 2) {
                const blockName = parts[0]
                // Check if a block with this name exists
                const block = blocks.find(
                  (b) => b.name?.toLowerCase().replace(/\s+/g, '') === blockName.toLowerCase()
                )
                if (!block) {
                  // Block not found (deleted), return null to filter out
                  return null
                }
              }

              return outputId
            })
            .filter((output): output is string => output !== null)

          exampleData.selectedOutputs = convertedOutputs
        }

        if (Object.keys(exampleData).length > 0) {
          inputFormatExample = ` -d '${JSON.stringify(exampleData)}'`
        }
      }
    } catch (error) {
      logger.error('Error generating input format example:', error)
    }

    return inputFormatExample
  }

  const fetchChatDeploymentInfo = async () => {
    if (!open || !workflowId) return

    try {
      setIsLoading(true)
      const response = await fetch(`/api/workflows/${workflowId}/chat/status`)

      if (response.ok) {
        const data = await response.json()
        if (data.isDeployed && data.deployment) {
          setChatExists(true)
        } else {
          setChatExists(false)
        }
      } else {
        setChatExists(false)
      }
    } catch (error) {
      logger.error('Error fetching chat deployment info:', { error })
      setChatExists(false)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setIsLoading(true)
      fetchChatDeploymentInfo()
      setActiveTab('api')
      setVersionToActivate(null)
    } else {
      setVersionToActivate(null)
    }
  }, [open, workflowId])

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
        const endpoint = `${getEnv('NEXT_PUBLIC_APP_URL')}/api/workflows/${workflowId}/execute`
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

      let deployEndpoint = `/api/workflows/${workflowId}/deploy`
      if (versionToActivate !== null) {
        deployEndpoint = `/api/workflows/${workflowId}/deployments/${versionToActivate}/activate`
      }

      const response = await fetch(deployEndpoint, {
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

      const isActivating = versionToActivate !== null
      const isDeployedStatus = isActivating ? true : (responseData.isDeployed ?? false)
      const deployedAtTime = responseData.deployedAt ? new Date(responseData.deployedAt) : undefined
      const apiKeyLabel = getApiKeyLabel(responseData.apiKey)

      setDeploymentStatus(workflowId, isDeployedStatus, deployedAtTime, apiKeyLabel)

      const isActivatingVersion = versionToActivate !== null
      setNeedsRedeployment(isActivatingVersion)
      if (workflowId) {
        useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, isActivatingVersion)
      }

      await refetchDeployedState()
      await fetchVersions()

      const deploymentInfoResponse = await fetch(`/api/workflows/${workflowId}/deploy`)
      if (deploymentInfoResponse.ok) {
        const deploymentData = await deploymentInfoResponse.json()
        const apiEndpoint = `${getEnv('NEXT_PUBLIC_APP_URL')}/api/workflows/${workflowId}/execute`
        const inputFormatExample = getInputFormatExample(selectedStreamingOutputs.length > 0)
        const placeholderKey = getApiHeaderPlaceholder()

        setDeploymentInfo({
          isDeployed: deploymentData.isDeployed,
          deployedAt: deploymentData.deployedAt,
          apiKey: getApiKeyLabel(deploymentData.apiKey),
          endpoint: apiEndpoint,
          exampleCommand: `curl -X POST -H "X-API-Key: ${placeholderKey}" -H "Content-Type: application/json"${inputFormatExample} ${apiEndpoint}`,
          needsRedeployment: isActivatingVersion,
        })
      }

      setVersionToActivate(null)
      setApiDeployError(null)

      // Templates connected to this workflow are automatically updated with the new state
      // The deployWorkflow function handles updating template states in db-helpers.ts
    } catch (error: unknown) {
      logger.error('Error deploying workflow:', { error })
      const errorMessage = error instanceof Error ? error.message : 'Failed to deploy workflow'
      setApiDeployError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  const fetchVersions = async () => {
    if (!workflowId) return
    try {
      setVersionsLoading(true)
      const res = await fetch(`/api/workflows/${workflowId}/deployments`)
      if (res.ok) {
        const data = await res.json()
        setVersions(Array.isArray(data.versions) ? data.versions : [])
      } else {
        setVersions([])
      }
    } catch {
      setVersions([])
    } finally {
      setVersionsLoading(false)
    }
  }

  useEffect(() => {
    if (open && workflowId) {
      fetchVersions()
    }
  }, [open, workflowId])

  // Clean up selectedStreamingOutputs when blocks are deleted
  useEffect(() => {
    if (!open || selectedStreamingOutputs.length === 0) return

    const blocks = Object.values(useWorkflowStore.getState().blocks)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

    const validOutputs = selectedStreamingOutputs.filter((outputId) => {
      // If it starts with a UUID, extract the blockId and check if the block exists
      if (UUID_REGEX.test(outputId)) {
        const underscoreIndex = outputId.indexOf('_')
        if (underscoreIndex === -1) return false

        const blockId = outputId.substring(0, underscoreIndex)
        const block = blocks.find((b) => b.id === blockId)
        return !!block
      }

      // If it's in blockName.attribute format, check if a block with that name exists
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

    // Update the state if any outputs were filtered out
    if (validOutputs.length !== selectedStreamingOutputs.length) {
      setSelectedStreamingOutputs(validOutputs)
    }
  }, [open, selectedStreamingOutputs, setSelectedStreamingOutputs])

  // Listen for event to reopen deploy modal
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

  const handleActivateVersion = (version: number) => {
    setVersionToActivate(version)
    setActiveTab('api')
  }

  const openVersionPreview = async (version: number) => {
    if (!workflowId) return
    try {
      setPreviewing(true)
      setPreviewVersion(version)
      const res = await fetch(`/api/workflows/${workflowId}/deployments/${version}`)
      if (res.ok) {
        const data = await res.json()
        setPreviewDeployedState(data.deployedState || null)
      } else {
        setPreviewDeployedState(null)
      }
    } finally {
      // keep modal open even if error; user can close
    }
  }

  const handleStartRename = (version: number, currentName: string | null | undefined) => {
    setOpenDropdown(null) // Close dropdown first
    setEditingVersion(version)
    setEditValue(currentName || `v${version}`)
  }

  const handleSaveRename = async (version: number) => {
    if (!workflowId || !editValue.trim()) {
      setEditingVersion(null)
      return
    }

    const currentVersion = versions.find((v) => v.version === version)
    const currentName = currentVersion?.name || `v${version}`

    if (editValue.trim() === currentName) {
      setEditingVersion(null)
      return
    }

    setIsRenaming(true)
    try {
      const res = await fetch(`/api/workflows/${workflowId}/deployments/${version}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editValue.trim() }),
      })

      if (res.ok) {
        await fetchVersions()
        setEditingVersion(null)
      } else {
        logger.error('Failed to rename version')
      }
    } catch (error) {
      logger.error('Error renaming version:', error)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelRename = () => {
    setEditingVersion(null)
    setEditValue('')
  }

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

      setNeedsRedeployment(false)
      if (workflowId) {
        useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, false)
      }

      await refetchDeployedState()
      await fetchVersions()

      setDeploymentInfo((prev) => (prev ? { ...prev, needsRedeployment: false } : prev))
    } catch (error: unknown) {
      logger.error('Error redeploying workflow:', { error })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCloseModal = () => {
    setIsSubmitting(false)
    setChatSubmitting(false)
    onOpenChange(false)
  }

  const handlePostDeploymentUpdate = async () => {
    if (!workflowId) return

    const isActivating = versionToActivate !== null

    setDeploymentStatus(workflowId, true, new Date(), getApiKeyLabel())

    const deploymentInfoResponse = await fetch(`/api/workflows/${workflowId}/deploy`)
    if (deploymentInfoResponse.ok) {
      const deploymentData = await deploymentInfoResponse.json()
      const apiEndpoint = `${getEnv('NEXT_PUBLIC_APP_URL')}/api/workflows/${workflowId}/execute`
      const inputFormatExample = getInputFormatExample(selectedStreamingOutputs.length > 0)

      const placeholderKey = getApiHeaderPlaceholder()

      setDeploymentInfo({
        isDeployed: deploymentData.isDeployed,
        deployedAt: deploymentData.deployedAt,
        apiKey: getApiKeyLabel(deploymentData.apiKey),
        endpoint: apiEndpoint,
        exampleCommand: `curl -X POST -H "X-API-Key: ${placeholderKey}" -H "Content-Type: application/json"${inputFormatExample} ${apiEndpoint}`,
        needsRedeployment: isActivating,
      })
    }

    await refetchDeployedState()
    await fetchVersions()
    useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, isActivating)
  }

  const handleChatFormSubmit = () => {
    const form = document.getElementById('chat-deploy-form') as HTMLFormElement
    if (form) {
      // Check if we're in success view and need to trigger update
      const updateTrigger = form.querySelector('[data-update-trigger]') as HTMLButtonElement
      if (updateTrigger) {
        updateTrigger.click()
      } else {
        form.requestSubmit()
      }
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleCloseModal}>
        <DialogContent
          className='flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[700px]'
          hideCloseButton
        >
          <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <DialogTitle className='font-medium text-lg'>Deploy Workflow</DialogTitle>
                {needsRedeployment && versions.length > 0 && versionToActivate === null && (
                  <span className='inline-flex items-center rounded-md bg-purple-500/10 px-2 py-1 font-medium text-purple-600 text-xs dark:text-purple-400'>
                    {versions.find((v) => v.isActive)?.name ||
                      `v${versions.find((v) => v.isActive)?.version}`}{' '}
                    active
                  </span>
                )}
              </div>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 p-0'
                onClick={handleCloseModal}
              >
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </Button>
            </div>
          </DialogHeader>

          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='flex h-14 flex-none items-center border-b px-6'>
              <div className='flex gap-2'>
                <button
                  onClick={() => setActiveTab('api')}
                  className={`rounded-md px-3 py-1 text-sm transition-colors ${
                    activeTab === 'api'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                >
                  API
                </button>
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`rounded-md px-3 py-1 text-sm transition-colors ${
                    activeTab === 'chat'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab('versions')}
                  className={`rounded-md px-3 py-1 text-sm transition-colors ${
                    activeTab === 'versions'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                >
                  Versions
                </button>
                <button
                  onClick={() => setActiveTab('template')}
                  className={`rounded-md px-3 py-1 text-sm transition-colors ${
                    activeTab === 'template'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                >
                  Template
                </button>
              </div>
            </div>

            <div className='flex-1 overflow-y-auto'>
              <div className='p-6' key={`${activeTab}-${versionToActivate}`}>
                {activeTab === 'api' && (
                  <div className='space-y-4'>
                    {apiDeployError && (
                      <div className='rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm'>
                        <div className='font-semibold'>API Deployment Error</div>
                        <div>{apiDeployError}</div>
                      </div>
                    )}

                    {versionToActivate !== null ? (
                      <div className='space-y-4'>
                        <div className='rounded-md border bg-muted/40 p-4 text-muted-foreground text-sm'>
                          {`Deploy version ${
                            versions.find((v) => v.version === versionToActivate)?.name ||
                            `v${versionToActivate}`
                          } to production.`}
                        </div>
                        <div className='flex gap-2'>
                          <Button
                            onClick={onDeploy}
                            disabled={isSubmitting}
                            className={cn(
                              'gap-2 font-medium',
                              'bg-[var(--brand-primary-hover-hex)] hover:bg-[var(--brand-primary-hover-hex)]',
                              'shadow-[0_0_0_0_var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                              'text-white transition-all duration-200',
                              'disabled:opacity-50 disabled:hover:bg-[var(--brand-primary-hover-hex)] disabled:hover:shadow-none'
                            )}
                          >
                            {isSubmitting ? (
                              <>
                                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                                Deploying...
                              </>
                            ) : (
                              'Deploy version'
                            )}
                          </Button>
                          <Button variant='outline' onClick={() => setVersionToActivate(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <DeploymentInfo
                        isLoading={isLoading}
                        deploymentInfo={
                          deploymentInfo ? { ...deploymentInfo, needsRedeployment } : null
                        }
                        onRedeploy={handleRedeploy}
                        onUndeploy={handleUndeploy}
                        isSubmitting={isSubmitting}
                        isUndeploying={isUndeploying}
                        workflowId={workflowId}
                        deployedState={deployedState}
                        isLoadingDeployedState={isLoadingDeployedState}
                        getInputFormatExample={getInputFormatExample}
                        selectedStreamingOutputs={selectedStreamingOutputs}
                        onSelectedStreamingOutputsChange={setSelectedStreamingOutputs}
                      />
                    )}
                  </div>
                )}

                {activeTab === 'versions' && (
                  <>
                    <div className='mb-3 font-medium text-sm'>Deployment Versions</div>
                    {versionsLoading ? (
                      <div className='rounded-md border p-4 text-center text-muted-foreground text-sm'>
                        Loading deployments...
                      </div>
                    ) : versions.length === 0 ? (
                      <div className='rounded-md border p-4 text-center text-muted-foreground text-sm'>
                        No deployments yet
                      </div>
                    ) : (
                      <>
                        <div className='overflow-hidden rounded-md border'>
                          <table className='w-full'>
                            <thead className='border-b bg-muted/50'>
                              <tr>
                                <th className='w-10' />
                                <th className='w-[200px] whitespace-nowrap px-4 py-2 text-left font-medium text-muted-foreground text-xs'>
                                  Version
                                </th>
                                <th className='whitespace-nowrap px-4 py-2 text-left font-medium text-muted-foreground text-xs'>
                                  Deployed By
                                </th>
                                <th className='whitespace-nowrap px-4 py-2 text-left font-medium text-muted-foreground text-xs'>
                                  Created
                                </th>
                                <th className='w-10' />
                              </tr>
                            </thead>
                            <tbody className='divide-y'>
                              {versions
                                .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                                .map((v) => (
                                  <tr
                                    key={v.id}
                                    className='cursor-pointer transition-colors hover:bg-muted/30'
                                    onClick={() => {
                                      if (editingVersion !== v.version) {
                                        openVersionPreview(v.version)
                                      }
                                    }}
                                  >
                                    <td className='px-4 py-2.5'>
                                      <div
                                        className={`h-2 w-2 rounded-full ${
                                          v.isActive ? 'bg-green-500' : 'bg-muted-foreground/40'
                                        }`}
                                        title={v.isActive ? 'Active' : 'Inactive'}
                                      />
                                    </td>
                                    <td className='w-[220px] max-w-[220px] px-4 py-2.5'>
                                      {editingVersion === v.version ? (
                                        <input
                                          ref={inputRef}
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              handleSaveRename(v.version)
                                            } else if (e.key === 'Escape') {
                                              e.preventDefault()
                                              handleCancelRename()
                                            }
                                          }}
                                          onBlur={() => handleSaveRename(v.version)}
                                          className='w-full border-0 bg-transparent p-0 font-medium text-sm leading-5 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                                          maxLength={100}
                                          disabled={isRenaming}
                                          autoComplete='off'
                                          autoCorrect='off'
                                          autoCapitalize='off'
                                          spellCheck='false'
                                        />
                                      ) : (
                                        <span className='block whitespace-pre-wrap break-words break-all font-medium text-sm leading-5'>
                                          {v.name || `v${v.version}`}
                                        </span>
                                      )}
                                    </td>
                                    <td className='whitespace-nowrap px-4 py-2.5'>
                                      <span className='text-muted-foreground text-sm'>
                                        {v.deployedBy || 'Unknown'}
                                      </span>
                                    </td>
                                    <td className='whitespace-nowrap px-4 py-2.5'>
                                      <span className='text-muted-foreground text-sm'>
                                        {new Date(v.createdAt).toLocaleDateString()}{' '}
                                        {new Date(v.createdAt).toLocaleTimeString()}
                                      </span>
                                    </td>
                                    <td
                                      className='px-4 py-2.5'
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <DropdownMenu
                                        open={openDropdown === v.version}
                                        onOpenChange={(open) =>
                                          setOpenDropdown(open ? v.version : null)
                                        }
                                      >
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            variant='ghost'
                                            size='icon'
                                            className='h-8 w-8'
                                            disabled={activatingVersion === v.version}
                                          >
                                            <MoreVertical className='h-4 w-4' />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                          align='end'
                                          onCloseAutoFocus={(event) => event.preventDefault()}
                                        >
                                          <DropdownMenuItem
                                            onClick={() => openVersionPreview(v.version)}
                                          >
                                            {v.isActive ? 'View Active' : 'Inspect'}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => handleStartRename(v.version, v.name)}
                                          >
                                            Rename
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        {versions.length > itemsPerPage && (
                          <div className='mt-3 flex items-center justify-between'>
                            <span className='text-muted-foreground text-sm'>
                              Showing{' '}
                              {Math.min((currentPage - 1) * itemsPerPage + 1, versions.length)} -{' '}
                              {Math.min(currentPage * itemsPerPage, versions.length)} of{' '}
                              {versions.length}
                            </span>
                            <div className='flex gap-2'>
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() => setCurrentPage(currentPage - 1)}
                                disabled={currentPage === 1}
                              >
                                Previous
                              </Button>
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() => setCurrentPage(currentPage + 1)}
                                disabled={currentPage * itemsPerPage >= versions.length}
                              >
                                Next
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}

                {activeTab === 'chat' && (
                  <ChatDeploy
                    workflowId={workflowId || ''}
                    deploymentInfo={deploymentInfo}
                    onChatExistsChange={setChatExists}
                    chatSubmitting={chatSubmitting}
                    setChatSubmitting={setChatSubmitting}
                    onValidationChange={setIsChatFormValid}
                    onDeploymentComplete={handleCloseModal}
                    onDeployed={handlePostDeploymentUpdate}
                    onUndeploy={handleUndeploy}
                    onVersionActivated={() => setVersionToActivate(null)}
                  />
                )}

                {activeTab === 'template' && workflowId && (
                  <TemplateDeploy workflowId={workflowId} onDeploymentComplete={handleCloseModal} />
                )}
              </div>
            </div>
          </div>

          {activeTab === 'chat' && (
            <div className='flex flex-shrink-0 justify-between border-t px-6 py-4'>
              <Button variant='outline' onClick={handleCloseModal}>
                Cancel
              </Button>

              <div className='flex gap-2'>
                {chatExists && (
                  <Button
                    type='button'
                    onClick={() => {
                      const form = document.getElementById('chat-deploy-form') as HTMLFormElement
                      if (form) {
                        const deleteButton = form.querySelector(
                          '[data-delete-trigger]'
                        ) as HTMLButtonElement
                        if (deleteButton) {
                          deleteButton.click()
                        }
                      }
                    }}
                    disabled={chatSubmitting}
                    className={cn(
                      'gap-2 font-medium',
                      'bg-red-500 hover:bg-red-600',
                      'shadow-[0_0_0_0_rgb(239,68,68)] hover:shadow-[0_0_0_4px_rgba(239,68,68,0.15)]',
                      'text-white transition-all duration-200',
                      'disabled:opacity-50 disabled:hover:bg-red-500 disabled:hover:shadow-none'
                    )}
                  >
                    Delete
                  </Button>
                )}
                <Button
                  type='button'
                  onClick={handleChatFormSubmit}
                  disabled={chatSubmitting || !isChatFormValid}
                  className={cn(
                    'gap-2 font-medium',
                    'bg-[var(--brand-primary-hover-hex)] hover:bg-[var(--brand-primary-hover-hex)]',
                    'shadow-[0_0_0_0_var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    'text-white transition-all duration-200',
                    'disabled:opacity-50 disabled:hover:bg-[var(--brand-primary-hover-hex)] disabled:hover:shadow-none'
                  )}
                >
                  {chatSubmitting ? (
                    <>
                      <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                      Deploying...
                    </>
                  ) : chatExists ? (
                    'Update'
                  ) : (
                    'Deploy Chat'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
        {previewVersion !== null && previewDeployedState && workflowId && (
          <DeployedWorkflowModal
            isOpen={true}
            onClose={() => {
              setPreviewVersion(null)
              setPreviewDeployedState(null)
              setPreviewing(false)
            }}
            needsRedeployment={true}
            activeDeployedState={deployedState}
            selectedDeployedState={previewDeployedState as WorkflowState}
            selectedVersion={previewVersion}
            onActivateVersion={() => {
              handleActivateVersion(previewVersion)
              setPreviewVersion(null)
              setPreviewDeployedState(null)
              setPreviewing(false)
            }}
            isActivating={activatingVersion === previewVersion}
            selectedVersionLabel={
              versions.find((v) => v.version === previewVersion)?.name || `v${previewVersion}`
            }
            workflowId={workflowId}
            isSelectedVersionActive={versions.find((v) => v.version === previewVersion)?.isActive}
          />
        )}
      </Dialog>
    </>
  )
}
