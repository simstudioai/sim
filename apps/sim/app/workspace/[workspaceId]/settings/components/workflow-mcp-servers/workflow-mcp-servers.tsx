'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, Clipboard, Plus, Search, Server } from 'lucide-react'
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
  Skeleton,
  SModalTabs,
  SModalTabsBody,
  SModalTabsContent,
  SModalTabsList,
  SModalTabsTrigger,
  Textarea,
  Tooltip,
} from '@/components/emcn'
import { Input } from '@/components/ui'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useApiKeys } from '@/hooks/queries/api-keys'
import { useCreateMcpServer } from '@/hooks/queries/mcp'
import {
  useAddWorkflowMcpTool,
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
import { CreateWorkflowMcpServerModal } from './create-workflow-mcp-server-modal'

const logger = createLogger('WorkflowMcpServers')

interface ServerDetailViewProps {
  workspaceId: string
  serverId: string
  onBack: () => void
}

type McpClientType = 'sim' | 'cursor' | 'claude-code' | 'claude-desktop' | 'vscode'

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

  const addToWorkspaceMutation = useCreateMcpServer()
  const [addedToWorkspace, setAddedToWorkspace] = useState(false)
  const addedToWorkspaceTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    return () => {
      if (addedToWorkspaceTimerRef.current) {
        clearTimeout(addedToWorkspaceTimerRef.current)
      }
    }
  }, [])

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

  const mcpServerUrl = `${getBaseUrl()}/api/mcp/serve/${serverId}`

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

      if (client === 'sim') {
        return ''
      }

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
      <div className='flex h-full flex-col gap-4.5'>
        <Skeleton className='h-[24px] w-[200px]' />
        <Skeleton className='h-[100px] w-full' />
        <Skeleton className='h-[150px] w-full' />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-2'>
        <p className='text-[var(--error)] text-xs leading-tight dark:text-[var(--error)]'>
          Failed to load server details
        </p>
        <Button variant='default' onClick={onBack}>
          Back
        </Button>
      </div>
    )
  }

  const { server } = data

  return (
    <>
      <div className='flex h-full flex-col gap-4.5'>
        <SModalTabs
          value={activeServerTab}
          onValueChange={(value) => setActiveServerTab(value as 'workflows' | 'details')}
          className='flex min-h-0 flex-1 flex-col'
        >
          <SModalTabsList activeValue={activeServerTab}>
            <SModalTabsTrigger value='details'>Details</SModalTabsTrigger>
            <SModalTabsTrigger value='workflows'>Workflows</SModalTabsTrigger>
          </SModalTabsList>

          <SModalTabsBody className='min-h-[300px]'>
            <SModalTabsContent value='workflows'>
              <div className='flex flex-col gap-4.5'>
                <div className='flex items-center justify-between'>
                  <span className='font-medium text-[var(--text-primary)] text-sm'>Workflows</span>
                  {showAddDisabledTooltip ? (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <div className='inline-flex'>
                          <Button
                            variant='primary'
                            onClick={() => setShowAddWorkflow(true)}
                            disabled
                          >
                            <Plus className='mr-1.5 h-[13px] w-[13px]' />
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
                      variant='primary'
                      onClick={() => setShowAddWorkflow(true)}
                      disabled={!canAddWorkflow}
                    >
                      <Plus className='mr-1.5 h-[13px] w-[13px]' />
                      Add
                    </Button>
                  )}
                </div>

                {tools.length === 0 ? (
                  <p className='text-[var(--text-muted)] text-sm'>
                    No workflows added yet. Click "Add" to add a deployed workflow.
                  </p>
                ) : (
                  <div className='flex flex-col gap-2'>
                    {tools.map((tool) => (
                      <div key={tool.id} className='flex items-center justify-between gap-3'>
                        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                          <span className='font-medium text-base'>{tool.toolName}</span>
                          <p className='truncate text-[var(--text-muted)] text-sm'>
                            {tool.toolDescription || 'No description'}
                          </p>
                        </div>
                        <div className='flex flex-shrink-0 items-center gap-1'>
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
                  <p className='mt-1 text-[var(--text-muted)] text-xs'>
                    Deploy a workflow first to add it to this server.
                  </p>
                )}
              </div>
            </SModalTabsContent>

            <SModalTabsContent value='details'>
              <div className='flex flex-col gap-4.5'>
                <div className='grid grid-cols-[1fr_1fr_1fr] gap-x-6 gap-y-3.5'>
                  <div className='flex flex-col gap-1'>
                    <span className='font-medium text-[var(--text-primary)] text-sm'>
                      Server Name
                    </span>
                    <p className='text-[var(--text-secondary)] text-base'>{server.name}</p>
                  </div>
                  <div className='flex flex-col gap-1'>
                    <span className='font-medium text-[var(--text-primary)] text-sm'>
                      Transport
                    </span>
                    <p className='text-[var(--text-secondary)] text-base'>Streamable-HTTP</p>
                  </div>
                  <div className='flex flex-col gap-1'>
                    <span className='font-medium text-[var(--text-primary)] text-sm'>Access</span>
                    <p className='text-[var(--text-secondary)] text-base'>
                      {server.isPublic ? 'Public' : 'API Key'}
                    </p>
                  </div>
                </div>

                {server.description?.trim() && (
                  <div className='flex flex-col gap-1'>
                    <span className='font-medium text-[var(--text-primary)] text-sm'>
                      Description
                    </span>
                    <p className='text-[var(--text-secondary)] text-base'>{server.description}</p>
                  </div>
                )}

                <div className='flex flex-col gap-1'>
                  <span className='font-medium text-[var(--text-primary)] text-sm'>URL</span>
                  <p className='break-all text-[var(--text-secondary)] text-base'>{mcpServerUrl}</p>
                </div>

                <div>
                  <div className='mb-[6.5px] flex items-center justify-between'>
                    <span className='block pl-0.5 font-medium text-[var(--text-primary)] text-sm'>
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
                    <ButtonGroupItem value='sim'>Sim</ButtonGroupItem>
                  </ButtonGroup>
                </div>

                {activeConfigTab === 'sim' ? (
                  <div className='rounded-lg border border-[var(--border-1)] p-4'>
                    <div className='flex flex-col gap-3'>
                      <p className='text-[var(--text-secondary)] text-small'>
                        Add this MCP server to your workspace so you can use its tools in other
                        workflows via the MCP block.
                      </p>
                      <Button
                        variant='primary'
                        className='self-start'
                        disabled={addToWorkspaceMutation.isPending || addedToWorkspace}
                        onClick={async () => {
                          try {
                            const headers: Record<string, string> = server.isPublic
                              ? {}
                              : { 'X-API-Key': '{{SIM_API_KEY}}' }
                            await addToWorkspaceMutation.mutateAsync({
                              workspaceId,
                              config: {
                                name: server.name,
                                transport: 'streamable-http',
                                url: mcpServerUrl,
                                timeout: 30000,
                                headers,
                                enabled: true,
                              },
                            })
                            setAddedToWorkspace(true)
                            addedToWorkspaceTimerRef.current = setTimeout(
                              () => setAddedToWorkspace(false),
                              3000
                            )
                          } catch (err) {
                            logger.error('Failed to add server to workspace:', err)
                          }
                        }}
                      >
                        {addToWorkspaceMutation.isPending ? (
                          'Adding...'
                        ) : addedToWorkspace ? (
                          <>
                            <Check className='mr-1.5 h-[13px] w-[13px]' />
                            Added to Workspace
                          </>
                        ) : (
                          <>
                            <Server className='mr-1.5 h-[13px] w-[13px]' />
                            Add to Workspace
                          </>
                        )}
                      </Button>
                      {addToWorkspaceMutation.isError && (
                        <p className='text-[var(--text-error)] text-xs'>
                          {addToWorkspaceMutation.error?.message || 'Failed to add server'}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className='mb-[6.5px] flex items-center justify-between'>
                      <span className='block pl-0.5 font-medium text-[var(--text-primary)] text-sm'>
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
                        className='!min-h-0 rounded-sm border border-[var(--border-1)]'
                      />
                      {activeConfigTab === 'cursor' && (
                        <a
                          href={getCursorInstallUrl(server.isPublic, server.name)}
                          className='absolute top-1.5 right-2 inline-flex rounded-md bg-[var(--surface-5)] ring-1 ring-[var(--border-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)]'
                        >
                          <img
                            src='https://cursor.com/deeplink/mcp-install-dark.svg'
                            alt='Add to Cursor'
                            className='h-[26px] rounded-md align-middle'
                          />
                        </a>
                      )}
                    </div>
                    {!server.isPublic && (
                      <p className='mt-2 text-[var(--text-muted)] text-xs'>
                        Replace $SIM_API_KEY with your API key, or{' '}
                        <button
                          type='button'
                          onClick={() => setShowCreateApiKeyModal(true)}
                          className='underline hover-hover:text-[var(--text-secondary)]'
                        >
                          create one now
                        </button>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </SModalTabsContent>
          </SModalTabsBody>
        </SModalTabs>

        <div className='mt-auto flex items-center justify-between'>
          <Button onClick={onBack} variant='default'>
            Back
          </Button>
          <div className='flex items-center gap-2'>
            {activeServerTab === 'details' && (
              <>
                <Button onClick={handleOpenEditServer} variant='default'>
                  Edit Server
                </Button>
                {showAddDisabledTooltip ? (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <div className='inline-flex'>
                        <Button variant='default' disabled>
                          Add Workflows
                        </Button>
                      </div>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      All deployed workflows have been added to this server.
                    </Tooltip.Content>
                  </Tooltip.Root>
                ) : (
                  <Button
                    onClick={() => setShowAddWorkflow(true)}
                    variant='default'
                    disabled={!canAddWorkflow}
                  >
                    Add Workflows
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <Modal open={!!toolToDelete} onOpenChange={(open) => !open && setToolToDelete(null)}>
        <ModalContent size='sm'>
          <ModalHeader>Remove Workflow</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
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
        <ModalContent size='md'>
          <ModalHeader>{toolToView?.toolName}</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-4.5'>
              <div>
                <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-sm'>
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
                    <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-sm'>
                      Parameters
                    </Label>
                    {hasParams ? (
                      <div className='flex flex-col gap-2'>
                        {Object.entries(properties).map(([name, prop]) => (
                          <div
                            key={name}
                            className='overflow-hidden rounded-sm border border-[var(--border-1)]'
                          >
                            <div className='flex items-center justify-between bg-[var(--surface-4)] px-2.5 py-[5px]'>
                              <div className='flex min-w-0 flex-1 items-center gap-2'>
                                <span className='block truncate font-medium text-[var(--text-tertiary)] text-base'>
                                  {name}
                                </span>
                                <Badge variant='type' size='sm'>
                                  {prop.type || 'any'}
                                </Badge>
                              </div>
                            </div>
                            <div className='rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 pt-1.5 pb-2.5'>
                              <div className='flex flex-col gap-1.5'>
                                <Label className='text-sm'>Description</Label>
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
                      <p className='text-[var(--text-muted)] text-sm'>
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
              variant='primary'
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
        <ModalContent size='sm'>
          <ModalHeader>Add Workflow</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Select a deployed workflow to add to this MCP server. The workflow will be available
              as a tool.
            </p>

            <div className='mt-4 flex flex-col gap-2'>
              <Label className='font-medium text-[var(--text-secondary)] text-sm'>
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
                <p className='text-[var(--text-error)] text-small leading-tight'>
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
              variant='primary'
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
        <ModalContent size='lg'>
          <ModalHeader>Edit Server</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-3'>
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
              <p className='text-[var(--text-muted)] text-xs'>
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
              variant='primary'
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
  const deleteServerMutation = useDeleteWorkflowMcpServer()

  const [searchTerm, setSearchTerm] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [serverToDelete, setServerToDelete] = useState<WorkflowMcpServer | null>(null)
  const [deletingServers, setDeletingServers] = useState<Set<string>>(() => new Set())

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
  const showNoResults = searchTerm.trim() && filteredServers.length === 0 && hasServers

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
      <div className='flex h-full flex-col gap-4.5'>
        <div className='flex items-center gap-2'>
          <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
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
          <Button onClick={() => setShowAddModal(true)} disabled={isLoading} variant='primary'>
            <Plus className='mr-1.5 h-[13px] w-[13px]' />
            Add
          </Button>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {error ? (
            <div className='flex h-full flex-col items-center justify-center gap-2'>
              <p className='text-[var(--error)] text-xs leading-tight dark:text-[var(--error)]'>
                {error instanceof Error ? error.message : 'Failed to load MCP servers'}
              </p>
            </div>
          ) : isLoading ? (
            <div className='flex flex-col gap-2'>
              <McpServerSkeleton />
              <McpServerSkeleton />
              <McpServerSkeleton />
            </div>
          ) : !hasServers ? (
            <div className='flex h-full items-center justify-center'>
              <p className='text-[var(--text-muted)] text-sm'>Click "Add" above to get started</p>
            </div>
          ) : (
            <div className='flex flex-col gap-2'>
              {filteredServers.map((server) => {
                const count = server.toolCount || 0
                const toolsLabel = `${count} tool${count !== 1 ? 's' : ''}`
                const isDeleting = deletingServers.has(server.id)
                return (
                  <div key={server.id} className='flex items-center justify-between gap-3'>
                    <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                      <div className='flex items-center gap-1.5'>
                        <span className='max-w-[200px] truncate font-medium text-base'>
                          {server.name}
                        </span>
                        {server.isPublic && (
                          <Badge variant='outline' size='sm'>
                            Public
                          </Badge>
                        )}
                      </div>
                      <p className='truncate text-[var(--text-muted)] text-sm'>{toolsLabel}</p>
                    </div>
                    <div className='flex flex-shrink-0 items-center gap-1'>
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
                <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                  No servers found matching "{searchTerm}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <CreateWorkflowMcpServerModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        workspaceId={workspaceId}
        workflowOptions={workflowOptions}
        isLoadingWorkflows={isLoadingWorkflows}
      />

      <Modal open={!!serverToDelete} onOpenChange={(open) => !open && setServerToDelete(null)}>
        <ModalContent size='sm'>
          <ModalHeader>Delete MCP Server</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{serverToDelete?.name}</span>
              ? This action cannot be undone.
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
