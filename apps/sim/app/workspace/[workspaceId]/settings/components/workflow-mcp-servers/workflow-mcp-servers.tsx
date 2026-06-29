'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Check, Clipboard, Plus, Server } from 'lucide-react'
import { useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Badge,
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Chip,
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
  Tooltip,
} from '@/components/emcn'
import { ArrowLeft } from '@/components/emcn/icons'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
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
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import { CreateApiKeyModal } from '../api-keys/components'

const logger = createLogger('WorkflowMcpServers')

interface ServerDetailViewProps {
  workspaceId: string
  serverId: string
  onBack: () => void
}

type McpClientType = 'sim' | 'cursor' | 'claude-code' | 'claude-desktop' | 'vscode'

function ServerDetailView({ workspaceId, serverId, onBack }: ServerDetailViewProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const { data, isLoading, error } = useWorkflowMcpServer(workspaceId, serverId)
  const { data: deployedWorkflows = [], isLoading: isLoadingWorkflows } =
    useDeployedWorkflows(workspaceId)
  const deleteToolMutation = useDeleteWorkflowMcpTool()
  const addToolMutation = useAddWorkflowMcpTool()
  const updateToolMutation = useUpdateWorkflowMcpTool()
  const updateServerMutation = useUpdateWorkflowMcpServer()

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
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
          <Chip onClick={onBack} leftIcon={ArrowLeft}>
            {t('mcp_servers')}
          </Chip>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
          <Chip onClick={onBack} leftIcon={ArrowLeft}>
            {t('mcp_servers')}
          </Chip>
        </div>
        <div className='flex min-h-0 flex-1 items-center justify-center'>
          <p className='text-[var(--text-error)] text-xs leading-tight'>
            {t('failed_to_load_server_details')}
          </p>
        </div>
      </div>
    )
  }

  const { server } = data

  const detailHeaderJsx = (
    <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
      <Chip onClick={onBack} leftIcon={ArrowLeft}>
        {t('mcp_servers')}
      </Chip>
      <div className='flex items-center'>
        <Chip onClick={handleOpenEditServer}>{t('edit_server')}</Chip>
        {showAddDisabledTooltip ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <div className='inline-flex'>
                <Chip leftIcon={Plus} variant='primary' disabled>
                  {t('add_workflows')}
                </Chip>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content>{t('all_deployed_workflows_have_been_added')}</Tooltip.Content>
          </Tooltip.Root>
        ) : (
          <Chip
            leftIcon={Plus}
            variant='primary'
            onClick={() => setShowAddWorkflow(true)}
            disabled={!canAddWorkflow}
          >
            {t('add_workflows')}
          </Chip>
        )}
      </div>
    </div>
  )

  return (
    <>
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        {detailHeaderJsx}
        <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
          <div className='mx-auto flex max-w-[48rem] flex-col pt-4 pb-6'>
            <div className='flex min-h-0 flex-1 flex-col'>
              <ChipModalTabs
                tabs={[
                  { value: 'details', label: 'Details' },
                  { value: 'workflows', label: 'Workflows' },
                ]}
                value={activeServerTab}
                onChange={(value) => setActiveServerTab(value as 'workflows' | 'details')}
              />

              <div className='min-h-[300px] pt-4'>
                {activeServerTab === 'workflows' && (
                  <div className='flex flex-col gap-4.5'>
                    <span className='font-medium text-[var(--text-primary)] text-sm'>
                      {t('workflows')}
                    </span>

                    {tools.length === 0 ? (
                      <p className='text-[var(--text-muted)] text-sm'>
                        {t('no_workflows_added_yet_click_quot')}
                      </p>
                    ) : (
                      <div className='flex flex-col gap-2'>
                        {tools.map((tool) => (
                          <div key={tool.id} className='flex items-center justify-between gap-3'>
                            <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                              <span className='text-[14px] text-[var(--text-body)]'>
                                {tool.toolName}
                              </span>
                              <p className='truncate text-[12px] text-[var(--text-muted)]'>
                                {tool.toolDescription || tI18n('no_description')}
                              </p>
                            </div>
                            <div className='flex flex-shrink-0 items-center gap-1'>
                              <RowActionsMenu
                                label={t('tool_actions')}
                                actions={[
                                  { label: 'Edit', onSelect: () => setToolToView(tool) },
                                  {
                                    label: 'Remove',
                                    destructive: true,
                                    disabled: deleteToolMutation.isPending,
                                    onSelect: () => setToolToDelete(tool),
                                  },
                                ]}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {deployedWorkflows.length === 0 && !isLoadingWorkflows && (
                      <p className='mt-1 text-[var(--text-muted)] text-xs'>
                        {t('deploy_a_workflow_first_to_add')}
                      </p>
                    )}
                  </div>
                )}

                {activeServerTab === 'details' && (
                  <div className='flex flex-col gap-4.5'>
                    <div className='grid grid-cols-[1fr_1fr_1fr] gap-x-6 gap-y-3.5'>
                      <div className='flex flex-col gap-1'>
                        <span className='font-medium text-[var(--text-primary)] text-sm'>
                          {t('server_name')}
                        </span>
                        <p className='text-[var(--text-secondary)] text-base'>{server.name}</p>
                      </div>
                      <div className='flex flex-col gap-1'>
                        <span className='font-medium text-[var(--text-primary)] text-sm'>
                          {t('transport')}
                        </span>
                        <p className='text-[var(--text-secondary)] text-base'>
                          {t('streamable_http')}
                        </p>
                      </div>
                      <div className='flex flex-col gap-1'>
                        <span className='font-medium text-[var(--text-primary)] text-sm'>
                          {t('access')}
                        </span>
                        <p className='text-[var(--text-secondary)] text-base'>
                          {server.isPublic ? tI18n('public') : tI18n('api_key')}
                        </p>
                      </div>
                    </div>

                    {server.description?.trim() && (
                      <div className='flex flex-col gap-1'>
                        <span className='font-medium text-[var(--text-primary)] text-sm'>
                          {t('description')}
                        </span>
                        <p className='text-[var(--text-secondary)] text-base'>
                          {server.description}
                        </p>
                      </div>
                    )}

                    <div className='flex flex-col gap-1'>
                      <span className='font-medium text-[var(--text-primary)] text-sm'>URL</span>
                      <p className='break-all text-[var(--text-secondary)] text-base'>
                        {mcpServerUrl}
                      </p>
                    </div>

                    <div>
                      <div className='mb-[6.5px] flex items-center justify-between'>
                        <span className='block pl-0.5 font-medium text-[var(--text-primary)] text-sm'>
                          {t('mcp_client')}
                        </span>
                      </div>
                      <ButtonGroup
                        value={activeConfigTab}
                        onValueChange={(v) => setActiveConfigTab(v as McpClientType)}
                      >
                        <ButtonGroupItem value='cursor'>{t('cursor')}</ButtonGroupItem>
                        <ButtonGroupItem value='claude-code'>{t('claude_code')}</ButtonGroupItem>
                        <ButtonGroupItem value='claude-desktop'>
                          {t('claude_desktop')}
                        </ButtonGroupItem>
                        <ButtonGroupItem value='vscode'>{t('vs_code')}</ButtonGroupItem>
                        <ButtonGroupItem value='sim'>{t('sim')}</ButtonGroupItem>
                      </ButtonGroup>
                    </div>

                    {activeConfigTab === 'sim' ? (
                      <div className='rounded-lg border border-[var(--border-1)] p-4'>
                        <div className='flex flex-col gap-3'>
                          <p className='text-[var(--text-secondary)] text-small'>
                            {t('add_this_mcp_server_to_your')}
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
                                {t('added_to_workspace')}
                              </>
                            ) : (
                              <>
                                <Server className='mr-1.5 size-[14px]' />
                                {t('add_to_workspace')}
                              </>
                            )}
                          </Button>
                          {addToWorkspaceMutation.isError && (
                            <p className='text-[var(--text-error)] text-xs'>
                              {addToWorkspaceMutation.error?.message ||
                                tI18n('failed_to_add_server')}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className='mb-[6.5px] flex items-center justify-between'>
                          <span className='block pl-0.5 font-medium text-[var(--text-primary)] text-sm'>
                            {t('configuration')}
                          </span>
                          <Button
                            variant='ghost'
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
                                alt={t('add_to_cursor')}
                                className='h-[26px] rounded-md align-middle'
                              />
                            </a>
                          )}
                        </div>
                        {!server.isPublic && (
                          <p className='mt-2 text-[var(--text-muted)] text-xs'>
                            {t('replace_sim_api_key_with_your')}{' '}
                            <button
                              type='button'
                              onClick={() => setShowCreateApiKeyModal(true)}
                              className='underline hover-hover:text-[var(--text-secondary)]'
                            >
                              {t('create_one_now')}
                            </button>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ChipConfirmModal
        open={!!toolToDelete}
        onOpenChange={(open) => !open && setToolToDelete(null)}
        srTitle={tI18n('remove_workflow')}
        title={t('remove_workflow')}
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

      <ChipModal
        open={!!toolToView}
        onOpenChange={(open) => {
          if (!open) {
            setToolToView(null)
            setEditingDescription('')
            setEditingParameterDescriptions({})
          }
        }}
        srTitle={toolToView?.toolName ?? tI18n('edit_tool')}
      >
        <ChipModalHeader onClose={() => setToolToView(null)}>
          {toolToView?.toolName}
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='textarea'
            title={t('description')}
            value={editingDescription}
            onChange={setEditingDescription}
            placeholder={t('describe_what_this_tool_does')}
            minHeight={80}
          />

          <ChipModalField type='custom' title={t('parameters')}>
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
                          <Label className='text-sm'>{t('description')}</Label>
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
                  {t('no_inputs_configured_for_this_workflow')}
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

      <ChipModal
        open={showAddWorkflow}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddWorkflow(false)
            setSelectedWorkflowId(null)
          }
        }}
        srTitle={tI18n('add_workflow')}
      >
        <ChipModalHeader
          onClose={() => {
            setShowAddWorkflow(false)
            setSelectedWorkflowId(null)
          }}
        >
          {t('add_workflow')}
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            {t('select_a_deployed_workflow_to_add')}
          </p>
          <ChipModalField type='custom' title={t('select_workflow')}>
            <ChipSelect
              options={workflowOptions}
              value={selectedWorkflowId || undefined}
              onChange={(value: string) => setSelectedWorkflowId(value)}
              placeholder={t('select_a_workflow')}
              searchable
              searchPlaceholder={tI18n('search_workflows')}
              disabled={addToolMutation.isPending}
              fullWidth
              dropdownWidth='trigger'
              align='start'
              displayLabel={selectedWorkflow?.name}
            />
          </ChipModalField>
          <ChipModalError>
            {addToolMutation.isError
              ? addToolMutation.error?.message || tI18n('failed_to_add_workflow')
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

      <ChipModal
        open={showEditServer}
        onOpenChange={(open) => {
          if (!open) {
            setShowEditServer(false)
          }
        }}
        srTitle={tI18n('edit_server')}
      >
        <ChipModalHeader onClose={() => setShowEditServer(false)}>
          {t('edit_server')}
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='input'
            title={t('server_name_2')}
            required
            value={editServerName}
            onChange={setEditServerName}
            placeholder={t('e_g_my_mcp_server')}
          />
          <ChipModalField
            type='textarea'
            title={t('description')}
            value={editServerDescription}
            onChange={setEditServerDescription}
            placeholder={t('describe_what_this_mcp_server_does')}
            minHeight={60}
          />
          <ChipModalField type='custom' title={t('access')}>
            <div className='flex flex-col gap-1.5'>
              <ButtonGroup
                value={editServerIsPublic ? 'public' : 'private'}
                onValueChange={(value) => setEditServerIsPublic(value === 'public')}
              >
                <ButtonGroupItem value='private'>{t('api_key')}</ButtonGroupItem>
                <ButtonGroupItem value='public'>{t('public')}</ButtonGroupItem>
              </ButtonGroup>
              <p className='text-[var(--text-muted)] text-xs'>
                {editServerIsPublic
                  ? tI18n('anyone_with_the_url_can_call')
                  : tI18n('requests_must_include_your_sim_api')}
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const searchParams = useSearchParams()

  const { data: servers = [], isLoading, error } = useWorkflowMcpServers(workspaceId)
  const { data: deployedWorkflows = [], isLoading: isLoadingWorkflows } =
    useDeployedWorkflows(workspaceId)
  const deleteServerMutation = useDeleteWorkflowMcpServer()

  const [searchTerm, setSearchTerm] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(() =>
    searchParams.get('mcpServerId')
  )
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
      <SettingsPanel
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search servers...',
        }}
        actions={
          <Chip
            leftIcon={Plus}
            variant='primary'
            onClick={() => setShowAddModal(true)}
            disabled={isLoading}
          >
            {t('add_server')}
          </Chip>
        }
      >
        <div className='min-h-0 flex-1'>
          {error ? (
            <div className='flex h-full flex-col items-center justify-center gap-2'>
              <p className='text-[var(--text-error)] text-sm leading-tight'>
                {getErrorMessage(error, 'Failed to load MCP servers')}
              </p>
            </div>
          ) : isLoading ? null : !hasServers ? (
            <SettingsEmptyState>{t('click_quot_add_server_quot_above')}</SettingsEmptyState>
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
                        <span className='max-w-[200px] truncate text-[14px] text-[var(--text-body)]'>
                          {server.name}
                        </span>
                        {server.isPublic && (
                          <Badge variant='outline' size='sm'>
                            {t('public')}
                          </Badge>
                        )}
                      </div>
                      <p className='truncate text-[12px] text-[var(--text-muted)]'>{toolsLabel}</p>
                    </div>
                    <div className='flex flex-shrink-0 items-center gap-1'>
                      <RowActionsMenu
                        label={t('server_actions')}
                        actions={[
                          { label: 'Details', onSelect: () => setSelectedServerId(server.id) },
                          {
                            label: 'Delete',
                            destructive: true,
                            disabled: isDeleting,
                            onSelect: () => setServerToDelete(server),
                          },
                        ]}
                      />
                    </div>
                  </div>
                )
              })}
              {showNoResults && (
                <SettingsEmptyState variant='inline'>
                  {t('no_servers_found_matching')}
                  {searchTerm}"
                </SettingsEmptyState>
              )}
            </div>
          )}
        </div>
      </SettingsPanel>

      <CreateWorkflowMcpServerModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        workspaceId={workspaceId}
        workflowOptions={workflowOptions}
        isLoadingWorkflows={isLoadingWorkflows}
      />

      <ChipConfirmModal
        open={!!serverToDelete}
        onOpenChange={(open) => !open && setServerToDelete(null)}
        srTitle={tI18n('delete_mcp_server')}
        title={t('delete_mcp_server')}
        text={[
          'Are you sure you want to delete ',
          { text: serverToDelete?.name ?? 'this server', bold: true },
          '? This action cannot be undone.',
        ]}
        confirm={{ label: 'Delete', onClick: handleDeleteServer }}
      />
    </>
  )
}
