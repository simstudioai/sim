'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, Clipboard, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Code,
  Combobox,
  type ComboboxOption,
  Input as EmcnInput,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  SModalTabs,
  SModalTabsBody,
  SModalTabsContent,
  SModalTabsList,
  SModalTabsTrigger,
  Textarea,
  Tooltip,
} from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useApiKeys } from '@/hooks/queries/api-keys'
import {
  useAddWorkflowMcpTool,
  useCreateWorkflowMcpServer,
  useDeleteWorkflowMcpServer,
  useDeleteWorkflowMcpTool,
  useDeployedWorkflows,
  useUpdateWorkflowMcpServer,
  useUpdateWorkflowMcpTool,
  useWorkflowMcpServer,
  useWorkflowMcpServers,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
} from '@/hooks/queries/workflow-mcp-servers'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import { CreateApiKeyModal } from '../api-keys/components'
import { FormField, McpServerSkeleton } from '../mcp/components'

const logger = createLogger('WorkflowMcpServers')

interface ServerDetailViewProps {
  workspaceId: string
  serverId: string
  onBack: () => void
}

type McpClientType = 'cursor' | 'claude-code' | 'claude-desktop' | 'vscode'

function ServerDetailView({ workspaceId, serverId, onBack }: ServerDetailViewProps) {
  const { data, isLoading, error } = useWorkflowMcpServer(workspaceId, serverId)
  const { data: deployedWorkflows = [], isLoading: isLoadingWorkflows } =
    useDeployedWorkflows(workspaceId)
  const deleteToolMutation = useDeleteWorkflowMcpTool()
  const addToolMutation = useAddWorkflowMcpTool()
  const updateToolMutation = useUpdateWorkflowMcpTool()
  const updateServerMutation = useUpdateWorkflowMcpServer()

  // API Keys - for "Create API key" link
  const { data: apiKeysData } = useApiKeys(workspaceId)
  const { data: workspaceSettingsData } = useWorkspaceSettings(workspaceId)
  const userPermissions = useUserPermissionsContext()
  const [showCreateApiKeyModal, setShowCreateApiKeyModal] = useState(false)

  const existingKeyNames = [
    ...(apiKeysData?.workspaceKeys ?? []),
    ...(apiKeysData?.personalKeys ?? []),
  ].map((k) => k.name)
  const allowPersonalApiKeys =
    workspaceSettingsData?.settings?.workspace?.allowPersonalApiKeys ?? true
  const canManageWorkspaceKeys = userPermissions.canAdmin
  const defaultKeyType = allowPersonalApiKeys ? 'personal' : 'workspace'

  const [copiedConfig, setCopiedConfig] = useState(false)
  const [activeConfigTab, setActiveConfigTab] = useState<McpClientType>('cursor')
  const [toolToDelete, setToolToDelete] = useState<WorkflowMcpTool | null>(null)
  const [toolToView, setToolToView] = useState<WorkflowMcpTool | null>(null)
  const [editingDescription, setEditingDescription] = useState<string>('')
  const [editingParameterDescriptions, setEditingParameterDescriptions] = useState<
    Record<string, string>
  >({})
  const [showAddWorkflow, setShowAddWorkflow] = useState(false)
  const [showEditServer, setShowEditServer] = useState(false)
  const [editServerName, setEditServerName] = useState('')
  const [editServerDescription, setEditServerDescription] = useState('')
  const [editServerIsPublic, setEditServerIsPublic] = useState(false)
  const [activeServerTab, setActiveServerTab] = useState<'workflows' | 'details'>('details')

  useEffect(() => {
    if (toolToView) {
      setEditingDescription(toolToView.toolDescription || '')
      const schema = toolToView.parameterSchema as
        | { properties?: Record<string, { type?: string; description?: string }> }
        | undefined
      const properties = schema?.properties
      if (properties) {
        const descriptions: Record<string, string> = {}
        for (const [name, prop] of Object.entries(properties)) {
          descriptions[name] = prop.description || ''
        }
        setEditingParameterDescriptions(descriptions)
      } else {
        setEditingParameterDescriptions({})
      }
    }
  }, [toolToView])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)

  const mcpServerUrl = useMemo(() => {
    return `${getBaseUrl()}/api/mcp/serve/${serverId}`
  }, [serverId])

  const handleDeleteTool = async () => {
    if (!toolToDelete) return
    try {
      await deleteToolMutation.mutateAsync({
        workspaceId,
        serverId,
        toolId: toolToDelete.id,
      })
      setToolToDelete(null)
    } catch (err) {
      logger.error('Failed to delete tool:', err)
    }
  }

  const handleAddWorkflow = async () => {
    if (!selectedWorkflowId) return
    try {
      await addToolMutation.mutateAsync({
        workspaceId,
        serverId,
        workflowId: selectedWorkflowId,
      })
      setShowAddWorkflow(false)
      setSelectedWorkflowId(null)
      setActiveServerTab('workflows')
    } catch (err) {
      logger.error('Failed to add workflow:', err)
    }
  }

  const tools = data?.tools ?? []

  const availableWorkflows = useMemo(() => {
    const existingWorkflowIds = new Set(tools.map((t) => t.workflowId))
    return deployedWorkflows.filter((w) => !existingWorkflowIds.has(w.id))
  }, [deployedWorkflows, tools])
  const canAddWorkflow = availableWorkflows.length > 0
  const showAddDisabledTooltip = !canAddWorkflow && deployedWorkflows.length > 0

  const workflowOptions: ComboboxOption[] = useMemo(() => {
    return availableWorkflows.map((w) => ({
      label: w.name,
      value: w.id,
    }))
  }, [availableWorkflows])

  const selectedWorkflow = useMemo(() => {
    return availableWorkflows.find((w) => w.id === selectedWorkflowId)
  }, [availableWorkflows, selectedWorkflowId])

  const getConfigSnippet = useCallback(
    (client: McpClientType, isPublic: boolean, serverName: string): string => {
      const safeName = serverName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')

      if (client === 'claude-code') {
        if (isPublic) {
          return `claude mcp add "${safeName}" --url "${mcpServerUrl}"`
        }
        return `claude mcp add "${safeName}" --url "${mcpServerUrl}" --header "X-API-Key:$SIM_API_KEY"`
      }

      // Cursor supports direct URL configuration (no mcp-remote needed)
      if (client === 'cursor') {
        const cursorConfig = isPublic
          ? { url: mcpServerUrl }
          : { url: mcpServerUrl, headers: { 'X-API-Key': '$SIM_API_KEY' } }

        return JSON.stringify({ mcpServers: { [safeName]: cursorConfig } }, null, 2)
      }

      // Claude Desktop and VS Code still use mcp-remote (stdio transport)
      const mcpRemoteArgs = isPublic
        ? ['-y', 'mcp-remote', mcpServerUrl]
        : ['-y', 'mcp-remote', mcpServerUrl, '--header', 'X-API-Key:$SIM_API_KEY']

      const baseServerConfig = {
        command: 'npx',
        args: mcpRemoteArgs,
      }

      if (client === 'vscode') {
        return JSON.stringify(
          {
            servers: {
              [safeName]: {
                type: 'stdio',
                ...baseServerConfig,
              },
            },
          },
          null,
          2
        )
      }

      return JSON.stringify(
        {
          mcpServers: {
            [safeName]: baseServerConfig,
          },
        },
        null,
        2
      )
    },
    [mcpServerUrl]
  )

  const handleCopyConfig = useCallback(
    (isPublic: boolean, serverName: string) => {
      const snippet = getConfigSnippet(activeConfigTab, isPublic, serverName)
      navigator.clipboard.writeText(snippet)
      setCopiedConfig(true)
      setTimeout(() => setCopiedConfig(false), 2000)
    },
    [activeConfigTab, getConfigSnippet]
  )

  const handleOpenEditServer = useCallback(() => {
    if (data?.server) {
      setEditServerName(data.server.name)
      setEditServerDescription(data.server.description || '')
      setEditServerIsPublic(data.server.isPublic)
      setShowEditServer(true)
    }
  }, [data?.server])

  const handleSaveServerEdit = async () => {
    if (!editServerName.trim()) return
    try {
      await updateServerMutation.mutateAsync({
        workspaceId,
        serverId,
        name: editServerName.trim(),
        description: editServerDescription.trim() || undefined,
        isPublic: editServerIsPublic,
      })
      setShowEditServer(false)
    } catch (err) {
      logger.error('Failed to update server:', err)
    }
  }

  const getCursorInstallUrl = useCallback(
    (isPublic: boolean, serverName: string): string => {
      const safeName = serverName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')

      const config = isPublic
        ? { url: mcpServerUrl }
        : { url: mcpServerUrl, headers: { 'X-API-Key': '$SIM_API_KEY' } }

      const base64Config = btoa(JSON.stringify(config))
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(safeName)}&config=${encodeURIComponent(base64Config)}`
    },
    [mcpServerUrl]
  )

  if (isLoading) {
    return (
      <div className='flex h-full flex-col gap-[16px]'>
        <Skeleton className='h-[24px] w-[200px]' />
        <Skeleton className='h-[100px] w-full' />
        <Skeleton className='h-[150px] w-full' />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-[8px]'>
        <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
          Failed to load server details
        </p>
        <Button variant='default' onClick={onBack}>
          Go Back
        </Button>
      </div>
    )
  }

  const { server } = data

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <SModalTabs
          value={activeServerTab}
          onValueChange={(value) => setActiveServerTab(value as 'workflows' | 'details')}
          className='flex min-h-0 flex-1 flex-col'
        >
          <SModalTabsList activeValue={activeServerTab}>
            <SModalTabsTrigger value='details'>Details</SModalTabsTrigger>
            <SModalTabsTrigger value='workflows'>Workflows</SModalTabsTrigger>
          </SModalTabsList>

          <SModalTabsBody>
            <SModalTabsContent value='workflows'>
              <div className='flex flex-col gap-[16px]'>
                <div className='flex items-center justify-between'>
                  <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                    Workflows
                  </span>
                  {showAddDisabledTooltip ? (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <div className='inline-flex'>
                          <Button
                            variant='tertiary'
                            onClick={() => setShowAddWorkflow(true)}
                            disabled
                          >
                            <Plus className='mr-[6px] h-[13px] w-[13px]' />
                            Add
                          </Button>
                        </div>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        All deployed workflows have been added to this server.
                      </Tooltip.Content>
                    </Tooltip.Root>
                  ) : (
                    <Button
                      variant='tertiary'
                      onClick={() => setShowAddWorkflow(true)}
                      disabled={!canAddWorkflow}
                    >
                      <Plus className='mr-[6px] h-[13px] w-[13px]' />
                      Add
                    </Button>
                  )}
                </div>

                {tools.length === 0 ? (
                  <p className='text-[13px] text-[var(--text-muted)]'>
                    No workflows added yet. Click "Add" to add a deployed workflow.
                  </p>
                ) : (
                  <div className='flex flex-col gap-[8px]'>
                    {tools.map((tool) => (
                      <div key={tool.id} className='flex items-center justify-between gap-[12px]'>
                        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                          <span className='font-medium text-[14px]'>{tool.toolName}</span>
                          <p className='truncate text-[13px] text-[var(--text-muted)]'>
                            {tool.toolDescription || 'No description'}
                          </p>
                        </div>
                        <div className='flex flex-shrink-0 items-center gap-[4px]'>
                          <Button variant='default' onClick={() => setToolToView(tool)}>
                            Edit
                          </Button>
                          <Button
                            variant='ghost'
                            onClick={() => setToolToDelete(tool)}
                            disabled={deleteToolMutation.isPending}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {deployedWorkflows.length === 0 && !isLoadingWorkflows && (
                  <p className='mt-[4px] text-[11px] text-[var(--text-muted)]'>
                    Deploy a workflow first to add it to this server.
                  </p>
                )}
              </div>
            </SModalTabsContent>

            <SModalTabsContent value='details'>
              <div className='flex flex-col gap-[16px]'>
                <div className='flex flex-col gap-[8px]'>
                  <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                    Server Name
                  </span>
                  <p className='text-[14px] text-[var(--text-secondary)]'>{server.name}</p>
                </div>

                {server.description?.trim() && (
                  <div className='flex flex-col gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Description
                    </span>
                    <p className='text-[14px] text-[var(--text-secondary)]'>{server.description}</p>
                  </div>
                )}

                <div className='flex gap-[24px]'>
                  <div className='flex flex-col gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Transport
                    </span>
                    <p className='text-[14px] text-[var(--text-secondary)]'>Streamable-HTTP</p>
                  </div>
                  <div className='flex flex-col gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Access
                    </span>
                    <p className='text-[14px] text-[var(--text-secondary)]'>
                      {server.isPublic ? 'Public' : 'API Key'}
                    </p>
                  </div>
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <span className='font-medium text-[13px] text-[var(--text-primary)]'>URL</span>
                  <p className='break-all text-[14px] text-[var(--text-secondary)]'>
                    {mcpServerUrl}
                  </p>
                </div>

                <div>
                  <div className='mb-[6.5px] flex items-center justify-between'>
                    <span className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
                      MCP Client
                    </span>
                  </div>
                  <ButtonGroup
                    value={activeConfigTab}
                    onValueChange={(v) => setActiveConfigTab(v as McpClientType)}
                  >
                    <ButtonGroupItem value='cursor'>Cursor</ButtonGroupItem>
                    <ButtonGroupItem value='claude-code'>Claude Code</ButtonGroupItem>
                    <ButtonGroupItem value='claude-desktop'>Claude Desktop</ButtonGroupItem>
                    <ButtonGroupItem value='vscode'>VS Code</ButtonGroupItem>
                  </ButtonGroup>
                </div>

                <div>
                  <div className='mb-[6.5px] flex items-center justify-between'>
                    <span className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
                      Configuration
                    </span>
                    <Button
                      variant='ghost'
                      onClick={() => handleCopyConfig(server.isPublic, server.name)}
                      className='!p-1.5 -my-1.5'
                    >
                      {copiedConfig ? (
                        <Check className='h-3 w-3' />
                      ) : (
                        <Clipboard className='h-3 w-3' />
                      )}
                    </Button>
                  </div>
                  <div className='relative'>
                    <Code.Viewer
                      code={getConfigSnippet(activeConfigTab, server.isPublic, server.name)}
                      language={activeConfigTab === 'claude-code' ? 'javascript' : 'json'}
                      wrapText
                      className='!min-h-0 rounded-[4px] border border-[var(--border-1)]'
                    />
                    {activeConfigTab === 'cursor' && (
                      <a
                        href={getCursorInstallUrl(server.isPublic, server.name)}
                        className='absolute top-[6px] right-2'
                      >
                        <img
                          src='https://cursor.com/deeplink/mcp-install-dark.svg'
                          alt='Add to Cursor'
                          className='h-[26px]'
                        />
                      </a>
                    )}
                  </div>
                  {!server.isPublic && (
                    <p className='mt-[8px] text-[11px] text-[var(--text-muted)]'>
                      Replace $SIM_API_KEY with your API key, or{' '}
                      <button
                        type='button'
                        onClick={() => setShowCreateApiKeyModal(true)}
                        className='underline hover:text-[var(--text-secondary)]'
                      >
                        create one now
                      </button>
                    </p>
                  )}
                </div>
              </div>
            </SModalTabsContent>
          </SModalTabsBody>
        </SModalTabs>

        <div className='mt-auto flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            {activeServerTab === 'details' && (
              <>
                <Button onClick={handleOpenEditServer} variant='default'>
                  Edit Server
                </Button>
                <Button
                  onClick={() => setShowAddWorkflow(true)}
                  variant='default'
                  disabled={!canAddWorkflow}
                >
                  Add Workflows
                </Button>
              </>
            )}
          </div>
          <Button onClick={onBack} variant='tertiary'>
            Back
          </Button>
        </div>
      </div>

      <Modal open={!!toolToDelete} onOpenChange={(open) => !open && setToolToDelete(null)}>
        <ModalContent size='sm'>
          <ModalHeader>Remove Workflow</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to remove{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {toolToDelete?.toolName}
              </span>{' '}
              from this server? The workflow will remain deployed and can be added back later.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setToolToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDeleteTool}
              disabled={deleteToolMutation.isPending}
            >
              {deleteToolMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={!!toolToView}
        onOpenChange={(open) => {
          if (!open) {
            setToolToView(null)
            setEditingDescription('')
            setEditingParameterDescriptions({})
          }
        }}
      >
        <ModalContent className='w-[480px]'>
          <ModalHeader>{toolToView?.toolName}</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[16px]'>
              <div>
                <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
                  Description
                </Label>
                <Textarea
                  value={editingDescription}
                  onChange={(e) => setEditingDescription(e.target.value)}
                  placeholder='Describe what this tool does...'
                  className='min-h-[80px] resize-none'
                />
              </div>

              {(() => {
                const schema = toolToView?.parameterSchema as
                  | { properties?: Record<string, { type?: string; description?: string }> }
                  | undefined
                const properties = schema?.properties
                const hasParams = properties && Object.keys(properties).length > 0
                return (
                  <div>
                    <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
                      Parameters
                    </Label>
                    {hasParams ? (
                      <div className='flex flex-col gap-[8px]'>
                        {Object.entries(properties).map(([name, prop]) => (
                          <div
                            key={name}
                            className='overflow-hidden rounded-[4px] border border-[var(--border-1)]'
                          >
                            <div className='flex items-center justify-between bg-[var(--surface-4)] px-[10px] py-[5px]'>
                              <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
                                <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
                                  {name}
                                </span>
                                <Badge variant='type' size='sm'>
                                  {prop.type || 'any'}
                                </Badge>
                              </div>
                            </div>
                            <div className='border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
                              <div className='flex flex-col gap-[6px]'>
                                <Label className='text-[13px]'>Description</Label>
                                <EmcnInput
                                  value={editingParameterDescriptions[name] || ''}
                                  onChange={(e) =>
                                    setEditingParameterDescriptions((prev) => ({
                                      ...prev,
                                      [name]: e.target.value,
                                    }))
                                  }
                                  placeholder={`Enter description for ${name}`}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className='text-[13px] text-[var(--text-muted)]'>
                        No inputs configured for this workflow.
                      </p>
                    )}
                  </div>
                )
              })()}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setToolToView(null)}>
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={async () => {
                if (!toolToView) return
                try {
                  const currentSchema = toolToView.parameterSchema as Record<string, unknown>
                  const currentProperties = (currentSchema?.properties || {}) as Record<
                    string,
                    { type?: string; description?: string }
                  >
                  const updatedProperties: Record<string, { type?: string; description?: string }> =
                    {}

                  for (const [name, prop] of Object.entries(currentProperties)) {
                    updatedProperties[name] = {
                      ...prop,
                      description: editingParameterDescriptions[name]?.trim() || undefined,
                    }
                  }

                  const updatedSchema = {
                    ...currentSchema,
                    properties: updatedProperties,
                  }

                  await updateToolMutation.mutateAsync({
                    workspaceId,
                    serverId,
                    toolId: toolToView.id,
                    toolDescription: editingDescription.trim() || undefined,
                    parameterSchema: updatedSchema,
                  })
                  setToolToView(null)
                  setEditingDescription('')
                  setEditingParameterDescriptions({})
                } catch (err) {
                  logger.error('Failed to update tool:', err)
                }
              }}
              disabled={(() => {
                if (updateToolMutation.isPending) return true
                if (!toolToView) return true

                const descriptionChanged =
                  editingDescription.trim() !== (toolToView.toolDescription || '')

                const schema = toolToView.parameterSchema as
                  | { properties?: Record<string, { type?: string; description?: string }> }
                  | undefined
                const properties = schema?.properties || {}
                const paramDescriptionsChanged = Object.keys(properties).some((name) => {
                  const original = properties[name]?.description || ''
                  const edited = editingParameterDescriptions[name]?.trim() || ''
                  return original !== edited
                })

                return !descriptionChanged && !paramDescriptionsChanged
              })()}
            >
              {updateToolMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={showAddWorkflow}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddWorkflow(false)
            setSelectedWorkflowId(null)
          }
        }}
      >
        <ModalContent className='w-[420px]'>
          <ModalHeader>Add Workflow</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Select a deployed workflow to add to this MCP server. The workflow will be available
              as a tool.
            </p>

            <div className='mt-[16px] flex flex-col gap-[8px]'>
              <Label className='font-medium text-[13px] text-[var(--text-secondary)]'>
                Select Workflow
              </Label>
              <Combobox
                options={workflowOptions}
                value={selectedWorkflowId || undefined}
                onChange={(value: string) => setSelectedWorkflowId(value)}
                placeholder='Select a workflow...'
                searchable
                searchPlaceholder='Search workflows...'
                disabled={addToolMutation.isPending}
                overlayContent={
                  selectedWorkflow ? (
                    <span className='truncate text-[var(--text-primary)]'>
                      {selectedWorkflow.name}
                    </span>
                  ) : undefined
                }
              />
              {addToolMutation.isError && (
                <p className='text-[12px] text-[var(--text-error)] leading-tight'>
                  {addToolMutation.error?.message || 'Failed to add workflow'}
                </p>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setShowAddWorkflow(false)
                setSelectedWorkflowId(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={handleAddWorkflow}
              disabled={!selectedWorkflowId || addToolMutation.isPending}
            >
              {addToolMutation.isPending ? 'Adding...' : 'Add Workflow'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={showEditServer}
        onOpenChange={(open) => {
          if (!open) {
            setShowEditServer(false)
          }
        }}
      >
        <ModalContent className='w-[420px]'>
          <ModalHeader>Edit Server</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[12px]'>
              <FormField label='Server Name'>
                <EmcnInput
                  placeholder='e.g., My MCP Server'
                  value={editServerName}
                  onChange={(e) => setEditServerName(e.target.value)}
                  className='h-9'
                />
              </FormField>

              <FormField label='Description'>
                <Textarea
                  placeholder='Describe what this MCP server does (optional)'
                  value={editServerDescription}
                  onChange={(e) => setEditServerDescription(e.target.value)}
                  className='min-h-[60px] resize-none'
                />
              </FormField>

              <FormField label='Access'>
                <ButtonGroup
                  value={editServerIsPublic ? 'public' : 'private'}
                  onValueChange={(value) => setEditServerIsPublic(value === 'public')}
                >
                  <ButtonGroupItem value='private'>API Key</ButtonGroupItem>
                  <ButtonGroupItem value='public'>Public</ButtonGroupItem>
                </ButtonGroup>
              </FormField>
              <p className='text-[11px] text-[var(--text-muted)]'>
                {editServerIsPublic
                  ? 'Anyone with the URL can call this server without authentication'
                  : 'Requests must include your Sim API key in the X-API-Key header'}
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowEditServer(false)}>
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={handleSaveServerEdit}
              disabled={
                !editServerName.trim() ||
                updateServerMutation.isPending ||
                (editServerName === server.name &&
                  editServerDescription === (server.description || '') &&
                  editServerIsPublic === server.isPublic)
              }
            >
              {updateServerMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <CreateApiKeyModal
        open={showCreateApiKeyModal}
        onOpenChange={setShowCreateApiKeyModal}
        workspaceId={workspaceId}
        existingKeyNames={existingKeyNames}
        allowPersonalApiKeys={allowPersonalApiKeys}
        canManageWorkspaceKeys={canManageWorkspaceKeys}
        defaultKeyType={defaultKeyType}
      />
    </>
  )
}

/**
 * MCP Servers settings component.
 * Allows users to create and manage MCP servers that expose workflows as tools.
 */
export function WorkflowMcpServers() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: servers = [], isLoading, error } = useWorkflowMcpServers(workspaceId)
  const { data: deployedWorkflows = [], isLoading: isLoadingWorkflows } =
    useDeployedWorkflows(workspaceId)
  const createServerMutation = useCreateWorkflowMcpServer()
  const deleteServerMutation = useDeleteWorkflowMcpServer()

  const [searchTerm, setSearchTerm] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({ name: '', description: '', isPublic: false })
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([])
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [serverToDelete, setServerToDelete] = useState<WorkflowMcpServer | null>(null)
  const [deletingServers, setDeletingServers] = useState<Set<string>>(new Set())

  const filteredServers = useMemo(() => {
    if (!searchTerm.trim()) return servers
    const search = searchTerm.toLowerCase()
    return servers.filter((server) => server.name.toLowerCase().includes(search))
  }, [servers, searchTerm])

  const workflowOptions: ComboboxOption[] = useMemo(() => {
    return deployedWorkflows.map((w) => ({
      label: w.name,
      value: w.id,
    }))
  }, [deployedWorkflows])

  const resetForm = useCallback(() => {
    setFormData({ name: '', description: '', isPublic: false })
    setSelectedWorkflowIds([])
    setShowAddForm(false)
  }, [])

  const handleCreateServer = async () => {
    if (!formData.name.trim()) return

    try {
      await createServerMutation.mutateAsync({
        workspaceId,
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        isPublic: formData.isPublic,
        workflowIds: selectedWorkflowIds.length > 0 ? selectedWorkflowIds : undefined,
      })
      resetForm()
    } catch (err) {
      logger.error('Failed to create server:', err)
    }
  }

  const handleDeleteServer = async () => {
    if (!serverToDelete) return

    setDeletingServers((prev) => new Set(prev).add(serverToDelete.id))
    setServerToDelete(null)

    try {
      await deleteServerMutation.mutateAsync({
        workspaceId,
        serverId: serverToDelete.id,
      })
    } catch (err) {
      logger.error('Failed to delete server:', err)
    } finally {
      setDeletingServers((prev) => {
        const next = new Set(prev)
        next.delete(serverToDelete.id)
        return next
      })
    }
  }

  const hasServers = servers.length > 0
  const shouldShowForm = showAddForm || !hasServers
  const showNoResults = searchTerm.trim() && filteredServers.length === 0 && hasServers
  const isFormValid = formData.name.trim().length > 0

  if (selectedServerId) {
    return (
      <ServerDetailView
        workspaceId={workspaceId}
        serverId={selectedServerId}
        onBack={() => setSelectedServerId(null)}
      />
    )
  }

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='flex items-center gap-[8px]'>
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <Input
              placeholder='Search servers...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Button onClick={() => setShowAddForm(true)} disabled={isLoading} variant='tertiary'>
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Add
          </Button>
        </div>

        {shouldShowForm && !isLoading && (
          <div className='rounded-[8px] border p-[10px]'>
            <div className='flex flex-col gap-[12px]'>
              <FormField label='Server Name'>
                <EmcnInput
                  placeholder='e.g., My MCP Server'
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className='h-9'
                />
              </FormField>

              <FormField label='Description'>
                <Textarea
                  placeholder='Describe what this MCP server does (optional)'
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className='min-h-[60px] resize-none'
                />
              </FormField>

              <FormField label='Workflows'>
                <Combobox
                  options={workflowOptions}
                  multiSelect
                  multiSelectValues={selectedWorkflowIds}
                  onMultiSelectChange={setSelectedWorkflowIds}
                  placeholder='Select workflows...'
                  searchable
                  searchPlaceholder='Search workflows...'
                  isLoading={isLoadingWorkflows}
                  disabled={createServerMutation.isPending}
                  emptyMessage='No deployed workflows available'
                  overlayContent={
                    selectedWorkflowIds.length > 0 ? (
                      <span className='text-[var(--text-primary)]'>
                        {selectedWorkflowIds.length} workflow
                        {selectedWorkflowIds.length !== 1 ? 's' : ''} selected
                      </span>
                    ) : undefined
                  }
                />
              </FormField>

              <FormField label='Access'>
                <div className='flex items-center gap-[12px]'>
                  <ButtonGroup
                    value={formData.isPublic ? 'public' : 'private'}
                    onValueChange={(value) =>
                      setFormData({ ...formData, isPublic: value === 'public' })
                    }
                  >
                    <ButtonGroupItem value='private'>API Key</ButtonGroupItem>
                    <ButtonGroupItem value='public'>Public</ButtonGroupItem>
                  </ButtonGroup>
                  {formData.isPublic && (
                    <span className='text-[11px] text-[var(--text-muted)]'>
                      No authentication required
                    </span>
                  )}
                </div>
              </FormField>

              <div className='flex items-center justify-end gap-[8px] pt-[4px]'>
                <Button variant='ghost' onClick={resetForm}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateServer}
                  disabled={!isFormValid || createServerMutation.isPending}
                  variant='tertiary'
                >
                  {createServerMutation.isPending ? 'Adding...' : 'Add Server'}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {error ? (
            <div className='flex h-full flex-col items-center justify-center gap-[8px]'>
              <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                {error instanceof Error ? error.message : 'Failed to load MCP servers'}
              </p>
            </div>
          ) : isLoading ? (
            <div className='flex flex-col gap-[8px]'>
              <McpServerSkeleton />
              <McpServerSkeleton />
              <McpServerSkeleton />
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredServers.map((server) => {
                const count = server.toolCount || 0
                const toolsLabel = `${count} tool${count !== 1 ? 's' : ''}`
                const isDeleting = deletingServers.has(server.id)
                return (
                  <div key={server.id} className='flex items-center justify-between gap-[12px]'>
                    <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                      <div className='flex items-center gap-[6px]'>
                        <span className='max-w-[200px] truncate font-medium text-[14px]'>
                          {server.name}
                        </span>
                        {server.isPublic && (
                          <Badge variant='outline' size='sm'>
                            Public
                          </Badge>
                        )}
                      </div>
                      <p className='truncate text-[13px] text-[var(--text-muted)]'>{toolsLabel}</p>
                    </div>
                    <div className='flex flex-shrink-0 items-center gap-[4px]'>
                      <Button variant='default' onClick={() => setSelectedServerId(server.id)}>
                        Details
                      </Button>
                      <Button
                        variant='ghost'
                        onClick={() => setServerToDelete(server)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  </div>
                )
              })}
              {showNoResults && (
                <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                  No servers found matching "{searchTerm}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!serverToDelete} onOpenChange={(open) => !open && setServerToDelete(null)}>
        <ModalContent size='sm'>
          <ModalHeader>Delete MCP Server</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{serverToDelete?.name}</span>
              ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setServerToDelete(null)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteServer}>
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
