'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  ButtonGroup,
  ButtonGroupItem,
  ChipConfirmModal,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
  ChipSelect,
  Code,
  type ComboboxOption,
  Label,
  useCopyToClipboard,
} from '@sim/emcn'
import { ArrowLeft, Check, Clipboard, Plus, Server } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { McpIcon } from '@/components/icons'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  mcpServerIdParam,
  mcpServerIdUrlKeys,
  serverTabParam,
  serverTabUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { CreateApiKeyModal } from '@/app/workspace/[workspaceId]/settings/components/api-keys/components'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsField } from '@/app/workspace/[workspaceId]/settings/components/settings-field'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { CreateWorkflowMcpServerModal } from '@/app/workspace/[workspaceId]/settings/components/workflow-mcp-servers/components'
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

const logger = createLogger('WorkflowMcpServers')

interface ServerDetailViewProps {
  canManage: boolean
  workspaceId: string
  serverId: string
  onBack: () => void
  /** Opens the parent's delete confirmation — the modal lives with the mutation.
   *  Absent until the parent's list resolves, so a deep link never shows an inert Delete. */
  onDelete?: () => void
  isDeleting: boolean
}

type McpClientType = 'sim' | 'cursor' | 'codex' | 'claude-code' | 'claude-desktop' | 'vscode'

function ServerDetailView({
  canManage,
  workspaceId,
  serverId,
  onBack,
  onDelete,
  isDeleting,
}: ServerDetailViewProps) {
  const { data, isLoading, error } = useWorkflowMcpServer(workspaceId, serverId)
  const { data: deployedWorkflows = [], isLoading: isLoadingWorkflows } =
    useDeployedWorkflows(workspaceId)
  const deleteToolMutation = useDeleteWorkflowMcpTool()
  const addToolMutation = useAddWorkflowMcpTool()
  const updateToolMutation = useUpdateWorkflowMcpTool()
  const updateServerMutation = useUpdateWorkflowMcpServer()

  const { data: apiKeysData } = useApiKeys(workspaceId, 'workspace')
  const [showCreateApiKeyModal, setShowCreateApiKeyModal] = useState(false)

  const existingKeyNames = (apiKeysData?.workspaceKeys ?? []).map((key) => key.name)
  const allowPersonalApiKeys = false
  const canManageWorkspaceKeys = canManage
  const defaultKeyType = 'workspace'

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

  const { copied: copiedConfig, copy: copyConfig } = useCopyToClipboard()
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
  const [activeServerTab, setActiveServerTab] = useQueryState(serverTabParam.key, {
    ...serverTabParam.parser,
    ...serverTabUrlKeys,
  })

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)

  const mcpServerUrl = `${getBaseUrl()}/api/mcp/serve/${serverId}`

  const handleOpenToolEdit = (tool: WorkflowMcpTool) => {
    setToolToView(tool)
    setEditingDescription(tool.toolDescription || '')
    const schema = tool.parameterSchema as
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

  const handleSaveToolEdit = async () => {
    if (!toolToView) return
    try {
      const currentSchema = toolToView.parameterSchema as Record<string, unknown>
      const currentProperties = (currentSchema?.properties || {}) as Record<
        string,
        { type?: string; description?: string }
      >
      const updatedProperties: Record<string, { type?: string; description?: string }> = {}

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
        toolDescription: editingDescription.trim(),
        parameterSchema: updatedSchema,
      })
      setToolToView(null)
      setEditingDescription('')
      setEditingParameterDescriptions({})
    } catch (err) {
      logger.error('Failed to update tool:', err)
    }
  }

  const isSaveToolDisabled = (() => {
    if (updateToolMutation.isPending) return true
    if (!toolToView) return true

    const descriptionChanged = editingDescription.trim() !== (toolToView.toolDescription || '')

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
  })()

  const tools = useMemo(() => data?.tools ?? [], [data?.tools])

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

      if (client === 'codex') {
        return [
          `[mcp_servers."${safeName}"]`,
          `url = "${mcpServerUrl}"`,
          ...(isPublic ? [] : ['env_http_headers = { "X-API-Key" = "SIM_API_KEY" }']),
        ].join('\n')
      }

      if (client === 'cursor') {
        const cursorConfig = isPublic
          ? { url: mcpServerUrl }
          : { url: mcpServerUrl, headers: { 'X-API-Key': '$SIM_API_KEY' } }

        return JSON.stringify({ mcpServers: { [safeName]: cursorConfig } }, null, 2)
      }

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
      void copyConfig(getConfigSnippet(activeConfigTab, isPublic, serverName))
    },
    [activeConfigTab, getConfigSnippet, copyConfig]
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
    return <SettingsPanel back={{ text: 'MCP servers', icon: ArrowLeft, onSelect: onBack }} />
  }

  if (error || !data) {
    return (
      <SettingsPanel back={{ text: 'MCP servers', icon: ArrowLeft, onSelect: onBack }}>
        <SettingsEmptyState tone='error'>Failed to load server details</SettingsEmptyState>
      </SettingsPanel>
    )
  }

  const { server } = data

  return (
    <>
      <SettingsPanel
        back={{ text: 'MCP servers', icon: ArrowLeft, onSelect: onBack }}
        title={server.name}
        actions={
          canManage
            ? [
                { text: 'Edit server', onSelect: handleOpenEditServer },
                {
                  text: 'Add workflows',
                  icon: Plus,
                  variant: 'primary',
                  onSelect: () => setShowAddWorkflow(true),
                  disabled: !canAddWorkflow,
                  tooltip: showAddDisabledTooltip
                    ? 'All deployed workflows have been added to this server.'
                    : undefined,
                },
                ...(onDelete
                  ? [
                      {
                        id: 'delete',
                        text: isDeleting ? 'Deleting...' : 'Delete',
                        onSelect: onDelete,
                        disabled: isDeleting,
                      },
                    ]
                  : []),
              ]
            : []
        }
      >
        <div className='flex min-h-0 flex-1 flex-col'>
          <ChipModalTabs
            tabs={[
              { value: 'details', label: 'Details' },
              { value: 'workflows', label: 'Workflows' },
            ]}
            value={activeServerTab}
            onChange={(value) => void setActiveServerTab(value as 'workflows' | 'details')}
          />

          <div className='min-h-[300px] pt-4'>
            {activeServerTab === 'workflows' && (
              <div className='flex flex-col gap-4.5'>
                {tools.length === 0 ? (
                  <p className='text-[var(--text-muted)] text-sm'>
                    No workflows added yet. Click &quot;Add Workflow&quot; to add a deployed
                    workflow.
                  </p>
                ) : (
                  <div className={RESOURCE_LIST_STACK}>
                    {tools.map((tool) => (
                      <SettingsResourceRow
                        key={tool.id}
                        title={tool.toolName}
                        description={tool.toolDescription || 'No description'}
                        trailing={
                          canManage ? (
                            <RowActionsMenu
                              label='Tool actions'
                              actions={[
                                { label: 'Edit', onSelect: () => handleOpenToolEdit(tool) },
                                {
                                  label: 'Remove',
                                  destructive: true,
                                  disabled: deleteToolMutation.isPending,
                                  onSelect: () => setToolToDelete(tool),
                                },
                              ]}
                            />
                          ) : undefined
                        }
                      />
                    ))}
                  </div>
                )}

                {deployedWorkflows.length === 0 && !isLoadingWorkflows && (
                  <p className='mt-1 text-[var(--text-muted)] text-caption'>
                    Deploy a workflow first to add it to this server.
                  </p>
                )}
              </div>
            )}

            {activeServerTab === 'details' && (
              <div className='flex flex-col gap-4.5'>
                <div className='grid grid-cols-[1fr_1fr_1fr] gap-x-6 gap-y-3.5'>
                  <SettingsField label='Server Name'>{server.name}</SettingsField>
                  <SettingsField label='Transport'>Streamable-HTTP</SettingsField>
                  <SettingsField label='Access'>
                    {server.isPublic ? 'Public' : 'API Key'}
                  </SettingsField>
                </div>

                {server.description?.trim() && (
                  <SettingsField label='Description'>{server.description}</SettingsField>
                )}

                <SettingsField label='URL' breakAll>
                  {mcpServerUrl}
                </SettingsField>

                <div>
                  <div className='mb-[6.5px] flex items-center justify-between'>
                    <span className='block pl-0.5 text-[var(--text-muted)] text-small'>
                      MCP Client
                    </span>
                  </div>
                  <ButtonGroup
                    value={activeConfigTab}
                    onValueChange={(v) => setActiveConfigTab(v as McpClientType)}
                  >
                    <ButtonGroupItem value='cursor'>Cursor</ButtonGroupItem>
                    <ButtonGroupItem value='codex'>Codex</ButtonGroupItem>
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
                            <Check className='mr-1.5 size-[14px]' />
                            Added to Workspace
                          </>
                        ) : (
                          <>
                            <Server className='mr-1.5 size-[14px]' />
                            Add to Workspace
                          </>
                        )}
                      </Button>
                      {addToWorkspaceMutation.isError && (
                        <p className='text-[var(--text-error)] text-caption'>
                          {addToWorkspaceMutation.error?.message || 'Failed to add server'}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className='mb-[6.5px] flex items-center justify-between'>
                      <span className='block pl-0.5 text-[var(--text-primary)] text-sm'>
                        Configuration
                      </span>
                      <Button
                        variant='ghost'
                        aria-label={copiedConfig ? 'Configuration copied' : 'Copy configuration'}
                        onClick={() => handleCopyConfig(server.isPublic, server.name)}
                        className='!p-1.5 -my-1.5'
                      >
                        {copiedConfig ? (
                          <Check className='size-[14px]' />
                        ) : (
                          <Clipboard className='size-[14px]' />
                        )}
                      </Button>
                    </div>
                    <div className='relative'>
                      <Code.Viewer
                        code={getConfigSnippet(activeConfigTab, server.isPublic, server.name)}
                        language={
                          activeConfigTab === 'claude-code'
                            ? 'bash'
                            : activeConfigTab === 'codex'
                              ? 'toml'
                              : 'json'
                        }
                        wrapText
                        className='!min-h-0 rounded-sm border border-[var(--border-1)]'
                      />
                      {activeConfigTab === 'cursor' && (
                        <a
                          href={getCursorInstallUrl(server.isPublic, server.name)}
                          className='absolute top-1.5 right-2 inline-flex rounded-md bg-[var(--surface-5)] ring-[length:var(--border-width)] ring-[var(--border-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)]'
                        >
                          <img
                            src='https://cursor.com/deeplink/mcp-install-dark.svg'
                            alt='Add to Cursor'
                            className='h-[26px] rounded-md align-middle'
                          />
                        </a>
                      )}
                    </div>
                    {activeConfigTab === 'codex' && server.isPublic && (
                      <p className='mt-2 text-[var(--text-muted)] text-caption'>
                        Add this to <span className='font-mono'>~/.codex/config.toml</span>.
                      </p>
                    )}
                    {!server.isPublic && (
                      <p className='mt-2 text-[var(--text-muted)] text-caption'>
                        {activeConfigTab === 'codex' ? (
                          <>
                            Add this to <span className='font-mono'>~/.codex/config.toml</span> and
                            set the SIM_API_KEY environment variable with an existing API key
                          </>
                        ) : (
                          'Replace $SIM_API_KEY with your API key'
                        )}
                        {canManage && (
                          <>
                            , or{' '}
                            <button
                              type='button'
                              onClick={() => setShowCreateApiKeyModal(true)}
                              className='underline hover-hover:text-[var(--text-secondary)]'
                            >
                              create one now
                            </button>
                          </>
                        )}
                        {activeConfigTab === 'codex' && '.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </SettingsPanel>
      {canManage && (
        <ChipConfirmModal
          open={!!toolToDelete}
          onOpenChange={(open) => !open && setToolToDelete(null)}
          srTitle='Remove Workflow'
          title='Remove Workflow'
          text={[
            'Are you sure you want to remove ',
            { text: toolToDelete?.toolName ?? 'this workflow', bold: true },
            ' from this server? The workflow will remain deployed and can be added back later.',
          ]}
          confirm={{
            label: 'Remove',
            onClick: handleDeleteTool,
            pending: deleteToolMutation.isPending,
            pendingLabel: 'Removing...',
          }}
        />
      )}
      {canManage && (
        <ChipModal
          open={!!toolToView}
          onOpenChange={(open) => {
            if (!open) {
              setToolToView(null)
              setEditingDescription('')
              setEditingParameterDescriptions({})
            }
          }}
          srTitle={toolToView?.toolName ?? 'Edit Tool'}
        >
          <ChipModalHeader onClose={() => setToolToView(null)}>
            {toolToView?.toolName}
          </ChipModalHeader>
          <ChipModalBody>
            <ChipModalField
              type='textarea'
              title='Description'
              value={editingDescription}
              onChange={setEditingDescription}
              placeholder='Describe what this tool does...'
              minHeight={80}
            />

            <ChipModalField type='custom' title='Parameters'>
              {(() => {
                const schema = toolToView?.parameterSchema as
                  | { properties?: Record<string, { type?: string; description?: string }> }
                  | undefined
                const properties = schema?.properties
                const hasParams = properties && Object.keys(properties).length > 0
                return hasParams ? (
                  <div className='flex flex-col gap-2'>
                    {Object.entries(properties).map(([name, prop]) => (
                      <div
                        key={name}
                        className='overflow-hidden rounded-sm border border-[var(--border-1)]'
                      >
                        <div className='flex items-center justify-between bg-[var(--surface-4)] px-2.5 py-[5px]'>
                          <div className='flex min-w-0 flex-1 items-center gap-2'>
                            <span className='block truncate text-[var(--text-tertiary)] text-base'>
                              {name}
                            </span>
                            <Badge variant='type' size='sm'>
                              {prop.type || 'any'}
                            </Badge>
                          </div>
                        </div>
                        <div className='rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 pt-1.5 pb-2.5'>
                          <div className='flex flex-col gap-1.5'>
                            <Label>Description</Label>
                            <ChipInput
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
                )
              })()}
            </ChipModalField>
          </ChipModalBody>
          <ChipModalFooter
            onCancel={() => setToolToView(null)}
            primaryAction={{
              label: updateToolMutation.isPending ? 'Saving...' : 'Save',
              onClick: handleSaveToolEdit,
              disabled: isSaveToolDisabled,
            }}
          />
        </ChipModal>
      )}
      {canManage && (
        <ChipModal
          open={showAddWorkflow}
          onOpenChange={(open) => {
            if (!open) {
              setShowAddWorkflow(false)
              setSelectedWorkflowId(null)
            }
          }}
          srTitle='Add Workflow'
        >
          <ChipModalHeader
            onClose={() => {
              setShowAddWorkflow(false)
              setSelectedWorkflowId(null)
            }}
          >
            Add Workflow
          </ChipModalHeader>
          <ChipModalBody>
            <p className='px-2 text-[var(--text-secondary)] text-sm'>
              Select a deployed workflow to add to this MCP server. The workflow will be available
              as a tool.
            </p>
            <ChipModalField type='custom' title='Select Workflow'>
              <ChipSelect
                options={workflowOptions}
                value={selectedWorkflowId || undefined}
                onChange={(value: string) => setSelectedWorkflowId(value)}
                placeholder='Select a workflow...'
                searchable
                searchPlaceholder='Search workflows...'
                disabled={addToolMutation.isPending}
                fullWidth
                dropdownWidth='trigger'
                align='start'
                displayLabel={selectedWorkflow?.name}
              />
            </ChipModalField>
            <ChipModalError>
              {addToolMutation.isError
                ? addToolMutation.error?.message || 'Failed to add workflow'
                : null}
            </ChipModalError>
          </ChipModalBody>
          <ChipModalFooter
            onCancel={() => {
              setShowAddWorkflow(false)
              setSelectedWorkflowId(null)
            }}
            primaryAction={{
              label: addToolMutation.isPending ? 'Adding...' : 'Add Workflow',
              onClick: handleAddWorkflow,
              disabled: !selectedWorkflowId || addToolMutation.isPending,
            }}
          />
        </ChipModal>
      )}
      {canManage && (
        <ChipModal
          open={showEditServer}
          onOpenChange={(open) => {
            if (!open) {
              setShowEditServer(false)
            }
          }}
          srTitle='Edit Server'
        >
          <ChipModalHeader onClose={() => setShowEditServer(false)}>Edit Server</ChipModalHeader>
          <ChipModalBody>
            <ChipModalField
              type='input'
              title='Server name'
              required
              value={editServerName}
              onChange={setEditServerName}
              placeholder='e.g., My MCP Server'
            />
            <ChipModalField
              type='textarea'
              title='Description'
              value={editServerDescription}
              onChange={setEditServerDescription}
              placeholder='Describe what this MCP server does (optional)'
              minHeight={60}
            />
            <ChipModalField type='custom' title='Access'>
              <div className='flex flex-col gap-1.5'>
                <ButtonGroup
                  value={editServerIsPublic ? 'public' : 'private'}
                  onValueChange={(value) => setEditServerIsPublic(value === 'public')}
                >
                  <ButtonGroupItem value='private'>API Key</ButtonGroupItem>
                  <ButtonGroupItem value='public'>Public</ButtonGroupItem>
                </ButtonGroup>
                <p className='text-[var(--text-muted)] text-caption'>
                  {editServerIsPublic
                    ? 'Anyone with the URL can call this server without authentication'
                    : 'Requests must include your Sim API key in the X-API-Key header'}
                </p>
              </div>
            </ChipModalField>
          </ChipModalBody>
          <ChipModalFooter
            onCancel={() => setShowEditServer(false)}
            primaryAction={{
              label: updateServerMutation.isPending ? 'Saving...' : 'Save',
              onClick: handleSaveServerEdit,
              disabled:
                !editServerName.trim() ||
                updateServerMutation.isPending ||
                (editServerName === server.name &&
                  editServerDescription === (server.description || '') &&
                  editServerIsPublic === server.isPublic),
            }}
          />
        </ChipModal>
      )}
      {canManage && (
        <CreateApiKeyModal
          open={showCreateApiKeyModal}
          onOpenChange={setShowCreateApiKeyModal}
          workspaceId={workspaceId}
          existingKeyNames={existingKeyNames}
          allowPersonalApiKeys={allowPersonalApiKeys}
          canManageWorkspaceKeys={canManageWorkspaceKeys}
          defaultKeyType={defaultKeyType}
        />
      )}
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
  const workspacePermissions = useUserPermissionsContext()
  const canAdmin = canMutateWorkspaceSettingsSection('workflow-mcp-servers', workspacePermissions)

  const { data: servers = [], isLoading, error } = useWorkflowMcpServers(workspaceId)
  const { data: deployedWorkflows = [] } = useDeployedWorkflows(workspaceId)
  const deleteServerMutation = useDeleteWorkflowMcpServer()

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedServerId, setSelectedServerId] = useQueryState(mcpServerIdParam.key, {
    ...mcpServerIdParam.parser,
    ...mcpServerIdUrlKeys,
  })
  const [serverToDelete, setServerToDelete] = useState<WorkflowMcpServer | null>(null)
  const [deletingServers, setDeletingServers] = useState<Set<string>>(() => new Set())
  /** Cleared alongside the server id on close so the tab never lingers on the list URL. */
  const [, setServerTab] = useQueryState(serverTabParam.key, {
    ...serverTabParam.parser,
    ...serverTabUrlKeys,
  })

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
      // Deleting from the detail view leaves a dead id in the URL; on reload the
      // detail branch mounts against a server that no longer exists.
      if (selectedServerId === serverToDelete.id) {
        void setServerTab(null, { history: 'replace' })
        void setSelectedServerId(null, { history: 'replace' })
      }
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

  /**
   * Render the detail view only while the id can still resolve — while the
   * list loads (a fresh deep link) or when the server exists in it. A stale id
   * (deleted server restored from an old history entry or a dead link) falls
   * back to the list instead of a failed detail view; the lingering param is
   * harmless and gets overwritten by the next selection. Closing replaces the
   * URL so Back leaves the section rather than reopening the detail view.
   */
  const selectedServerResolves =
    selectedServerId !== null && (isLoading || servers.some((s) => s.id === selectedServerId))

  // Delete is reachable from both the list and the detail header, so the confirm
  // modal has to render in whichever branch is mounted.
  const deleteConfirmModal = canAdmin ? (
    <ChipConfirmModal
      open={!!serverToDelete}
      onOpenChange={(open) => !open && setServerToDelete(null)}
      srTitle='Delete MCP Server'
      title='Delete MCP Server'
      text={[
        'Are you sure you want to delete ',
        { text: serverToDelete?.name ?? 'this server', bold: true },
        '? This action cannot be undone.',
      ]}
      confirm={{ label: 'Delete', onClick: handleDeleteServer }}
    />
  ) : null

  if (selectedServerId && selectedServerResolves) {
    const selectedServer = servers.find((s) => s.id === selectedServerId)
    return (
      <>
        <ServerDetailView
          canManage={canAdmin}
          workspaceId={workspaceId}
          serverId={selectedServerId}
          onBack={() => {
            void setServerTab(null, { history: 'replace' })
            void setSelectedServerId(null, { history: 'replace' })
          }}
          onDelete={selectedServer ? () => setServerToDelete(selectedServer) : undefined}
          isDeleting={deletingServers.has(selectedServerId)}
        />
        {deleteConfirmModal}
      </>
    )
  }

  const actions: SettingsAction[] = canAdmin
    ? [
        {
          text: 'Add server',
          icon: Plus,
          variant: 'primary',
          onSelect: () => setShowAddModal(true),
          disabled: isLoading,
        },
      ]
    : []

  return (
    <>
      <SettingsPanel
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search servers...',
        }}
        actions={actions}
      >
        <div className='min-h-0 flex-1'>
          {error ? (
            <SettingsEmptyState tone='error'>
              {getErrorMessage(error, 'Failed to load MCP servers')}
            </SettingsEmptyState>
          ) : isLoading ? null : !hasServers ? (
            <SettingsEmptyState>
              {canAdmin ? 'Click "Add server" above to get started' : 'No MCP servers configured'}
            </SettingsEmptyState>
          ) : (
            <div className={RESOURCE_LIST_STACK}>
              {filteredServers.map((server) => {
                const count = server.toolCount || 0
                const toolsLabel = `${count} tool${count !== 1 ? 's' : ''}`
                return (
                  <SettingsResourceRow
                    key={server.id}
                    icon={<McpIcon className='text-[var(--text-icon)]' />}
                    iconFilled
                    title={server.name}
                    description={toolsLabel}
                    onClick={() => {
                      // A lingering ?server-tab= (dead deep link) must not re-target the next open — reset it in the same batched push.
                      void setServerTab(null)
                      void setSelectedServerId(server.id)
                    }}
                    clickLabel={`Open ${server.name}`}
                    navigable
                    // The badge sits at the row's end, not beside the name — the
                    // title truncates, so a long name would clip it out of view.
                    badge={
                      server.isPublic ? (
                        <Badge variant='outline' size='sm'>
                          Public
                        </Badge>
                      ) : undefined
                    }
                  />
                )
              })}
              {showNoResults && (
                <SettingsEmptyState variant='inline'>
                  No servers found matching "{searchTerm}"
                </SettingsEmptyState>
              )}
            </div>
          )}
        </div>
      </SettingsPanel>

      {canAdmin && (
        <CreateWorkflowMcpServerModal
          open={showAddModal}
          onOpenChange={setShowAddModal}
          workspaceId={workspaceId}
          workflowOptions={workflowOptions}
        />
      )}

      {deleteConfirmModal}
    </>
  )
}
