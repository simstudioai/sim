'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from '@/components/emcn'
import { Input } from '@/components/ui'
import { requestJson } from '@/lib/api/client/request'
import { getWorkflowStateContract } from '@/lib/api/contracts/workflows'
import { cn } from '@/lib/core/utils/cn'
import {
  getIssueBadgeLabel,
  getIssueBadgeVariant,
  getMcpToolIssue,
  type McpToolIssue,
} from '@/lib/mcp/tool-validation'
import type { McpTransport } from '@/lib/mcp/types'
import {
  type McpServer,
  type McpTool,
  useAllowedMcpDomains,
  useCreateMcpServer,
  useDeleteMcpServer,
  useForceRefreshMcpTools,
  useMcpServers,
  useMcpToolsQuery,
  useRefreshMcpServer,
  useStoredMcpTools,
  useUpdateMcpServer,
} from '@/hooks/queries/mcp'
import { useAvailableEnvVarKeys } from '@/hooks/use-available-env-vars'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { McpServerFormModal, McpServerSkeleton } from './components'

const logger = createLogger('McpSettings')

function formatTransportLabel(transport: string): string {
  return transport
    .split('-')
    .map((word) =>
      ['http', 'sse', 'stdio'].includes(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('-')
}

function formatToolsLabel(tools: McpTool[], connectionStatus?: string): string {
  if (connectionStatus === 'error') {
    return 'Unable to connect'
  }
  const count = tools.length
  const plural = count !== 1 ? 's' : ''
  const names = count > 0 ? `: ${tools.map((t) => t.name).join(', ')}` : ''
  return `${count} tool${plural}${names}`
}

interface ServerListItemProps {
  server: McpServer
  tools: McpTool[]
  isDeleting: boolean
  isLoadingTools?: boolean
  isRefreshing?: boolean
  onRemove: () => void
  onViewDetails: () => void
}

function ServerListItem({
  server,
  tools,
  isDeleting,
  isLoadingTools = false,
  isRefreshing = false,
  onRemove,
  onViewDetails,
}: ServerListItemProps) {
  const transportLabel = formatTransportLabel(server.transport || 'http')
  const toolsLabel = formatToolsLabel(tools, server.connectionStatus)
  const isError = server.connectionStatus === 'error'

  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-1.5'>
          <span className='max-w-[200px] truncate font-medium text-base'>
            {server.name || 'Unnamed Server'}
          </span>
          <span className='text-[var(--text-secondary)] text-sm'>({transportLabel})</span>
        </div>
        <p
          className={`truncate text-sm ${isError ? 'text-red-500 dark:text-red-400' : 'text-[var(--text-muted)]'}`}
        >
          {isRefreshing
            ? 'Refreshing...'
            : isLoadingTools && tools.length === 0
              ? 'Loading...'
              : toolsLabel}
        </p>
      </div>
      <div className='flex flex-shrink-0 items-center gap-1'>
        <Button variant='default' onClick={onViewDetails}>
          Details
        </Button>
        <Button variant='ghost' onClick={onRemove} disabled={isDeleting}>
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </div>
  )
}

interface MCPProps {
  initialServerId?: string | null
}

/**
 * MCP Settings component for managing Model Context Protocol servers.
 * Handles server CRUD operations, connection testing, and environment variable integration.
 */
export function MCP({ initialServerId }: MCPProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    data: servers = [],
    isLoading: serversLoading,
    error: serversError,
  } = useMcpServers(workspaceId)
  const {
    data: mcpToolsData = [],
    error: toolsError,
    isLoading: toolsLoading,
    isFetching: toolsFetching,
  } = useMcpToolsQuery(workspaceId)
  const { data: storedTools = [], refetch: refetchStoredTools } = useStoredMcpTools(workspaceId)
  const forceRefreshTools = useForceRefreshMcpTools()
  const createServerMutation = useCreateMcpServer()
  const deleteServerMutation = useDeleteMcpServer()
  const refreshServerMutation = useRefreshMcpServer()
  const updateServerMutation = useUpdateMcpServer()
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId)
  const { data: allowedMcpDomains = null } = useAllowedMcpDomains()

  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editInitialData, setEditInitialData] = useState<
    | {
        name: string
        transport: McpTransport
        url?: string
        timeout?: number
        headers?: { key: string; value: string }[]
      }
    | undefined
  >(undefined)

  const [searchTerm, setSearchTerm] = useState('')
  const [deletingServers, setDeletingServers] = useState<Set<string>>(() => new Set())

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<{ id: string; name: string } | null>(null)

  const [selectedServerId, setSelectedServerId] = useState<string | null>(initialServerId ?? null)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- initialServerId and workspaceId
  // are stable for the component's lifetime (route changes remount the settings page).
  useEffect(() => {
    if (initialServerId) {
      forceRefreshTools(workspaceId)
      refetchStoredTools()
    }
  }, [])

  const [refreshingServers, setRefreshingServers] = useState<
    Record<string, { status: 'refreshing' | 'refreshed'; workflowsUpdated?: number }>
  >({})
  const [expandedTools, setExpandedTools] = useState<Set<string>>(() => new Set())

  const handleRemoveServer = useCallback((serverId: string, serverName: string) => {
    setServerToDelete({ id: serverId, name: serverName })
    setShowDeleteDialog(true)
  }, [])

  const confirmDeleteServer = useCallback(async () => {
    if (!serverToDelete) return

    setShowDeleteDialog(false)
    const { id: serverId, name: serverName } = serverToDelete
    setServerToDelete(null)

    setDeletingServers((prev) => new Set(prev).add(serverId))

    try {
      await deleteServerMutation.mutateAsync({ workspaceId, serverId })
      logger.info(`Removed MCP server: ${serverName}`)
    } catch (error) {
      logger.error('Failed to remove MCP server:', error)
    } finally {
      setDeletingServers((prev) => {
        const newSet = new Set(prev)
        newSet.delete(serverId)
        return newSet
      })
    }
  }, [serverToDelete, deleteServerMutation, workspaceId])

  const toolsByServer = useMemo(() => {
    return (mcpToolsData || []).reduce(
      (acc, tool) => {
        if (!tool?.serverId) return acc
        if (!acc[tool.serverId]) {
          acc[tool.serverId] = []
        }
        acc[tool.serverId].push(tool)
        return acc
      },
      {} as Record<string, typeof mcpToolsData>
    )
  }, [mcpToolsData])

  const filteredServers = useMemo(() => {
    return (servers || []).filter((server) =>
      server.name?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [servers, searchTerm])

  const handleViewDetails = useCallback(
    (serverId: string) => {
      setSelectedServerId(serverId)
      forceRefreshTools(workspaceId)
      refetchStoredTools()
    },
    [workspaceId, forceRefreshTools, refetchStoredTools]
  )

  const handleBackToList = useCallback(() => {
    setSelectedServerId(null)
    setExpandedTools(new Set())
  }, [])

  const toggleToolExpanded = useCallback((toolName: string) => {
    setExpandedTools((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(toolName)) {
        newSet.delete(toolName)
      } else {
        newSet.add(toolName)
      }
      return newSet
    })
  }, [])

  const handleRefreshServer = useCallback(
    async (serverId: string) => {
      try {
        setRefreshingServers((prev) => ({ ...prev, [serverId]: { status: 'refreshing' } }))
        const result = await refreshServerMutation.mutateAsync({ workspaceId, serverId })
        logger.info(
          `Refreshed MCP server: ${serverId}, workflows updated: ${result.workflowsUpdated}`
        )

        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (activeWorkflowId && result.updatedWorkflowIds?.includes(activeWorkflowId)) {
          logger.info(`Active workflow ${activeWorkflowId} was updated, reloading subblock values`)
          try {
            const { data: workflowData } = await requestJson(getWorkflowStateContract, {
              params: { id: activeWorkflowId },
            })
            if (workflowData?.state?.blocks) {
              useSubBlockStore
                .getState()
                .initializeFromWorkflow(
                  activeWorkflowId,
                  workflowData.state.blocks as Record<string, BlockState>
                )
            }
          } catch (reloadError) {
            logger.warn('Failed to reload workflow subblock values:', reloadError)
          }
        }

        setRefreshingServers((prev) => ({
          ...prev,
          [serverId]: { status: 'refreshed', workflowsUpdated: result.workflowsUpdated },
        }))
        setTimeout(() => {
          setRefreshingServers((prev) => {
            const newState = { ...prev }
            delete newState[serverId]
            return newState
          })
        }, 3000)
      } catch (error) {
        logger.error('Failed to refresh MCP server:', error)
        setRefreshingServers((prev) => {
          const newState = { ...prev }
          delete newState[serverId]
          return newState
        })
      }
    },
    [refreshServerMutation, workspaceId]
  )

  const handleOpenEditModal = useCallback((server: McpServer) => {
    const headers: { key: string; value: string }[] = server.headers
      ? Object.entries(server.headers).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }]
    if (headers.length === 0) headers.push({ key: '', value: '' })

    const lastHeader = headers[headers.length - 1]
    if (lastHeader.key !== '' || lastHeader.value !== '') {
      headers.push({ key: '', value: '' })
    }

    setEditInitialData({
      name: server.name || '',
      transport: (server.transport as McpTransport) || 'streamable-http',
      url: server.url || '',
      timeout: 30000,
      headers,
    })
    setShowEditModal(true)
  }, [])

  const selectedServer = useMemo(() => {
    if (!selectedServerId) return null
    const server = servers.find((s) => s.id === selectedServerId) as McpServer | undefined
    if (!server) return null
    const serverTools = (toolsByServer[selectedServerId] || []) as McpTool[]
    return { server, tools: serverTools }
  }, [selectedServerId, servers, toolsByServer])

  const getStoredToolIssues = useCallback(
    (serverId: string, toolName: string): { issue: McpToolIssue; workflowName: string }[] => {
      const relevantStoredTools = storedTools.filter(
        (st) => st.serverId === serverId && st.toolName === toolName
      )

      const serverStates = servers.map((s) => ({
        id: s.id,
        url: s.url,
        connectionStatus: s.connectionStatus,
        lastError: s.lastError || undefined,
      }))

      const discoveredTools = mcpToolsData.map((t) => ({
        serverId: t.serverId,
        name: t.name,
        inputSchema: t.inputSchema,
      }))

      const issues: { issue: McpToolIssue; workflowName: string }[] = []

      for (const storedTool of relevantStoredTools) {
        const issue = getMcpToolIssue(
          {
            serverId: storedTool.serverId,
            serverUrl: storedTool.serverUrl,
            toolName: storedTool.toolName,
            schema: storedTool.schema,
          },
          serverStates,
          discoveredTools
        )

        if (issue) {
          issues.push({ issue, workflowName: storedTool.workflowName })
        }
      }

      return issues
    },
    [storedTools, servers, mcpToolsData]
  )

  const error = toolsError || serversError
  const hasServers = servers && servers.length > 0
  const showNoResults = searchTerm.trim() && filteredServers.length === 0 && servers.length > 0

  if (selectedServer) {
    const { server, tools } = selectedServer
    const transportLabel = formatTransportLabel(server.transport || 'http')

    return (
      <div className='flex h-full flex-col gap-4.5'>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-4.5'>
            <div className='flex flex-col gap-2'>
              <span className='font-medium text-[var(--text-primary)] text-sm'>Server Name</span>
              <p className='text-[var(--text-secondary)] text-base'>
                {server.name || 'Unnamed Server'}
              </p>
            </div>

            <div className='flex flex-col gap-2'>
              <span className='font-medium text-[var(--text-primary)] text-sm'>Transport</span>
              <p className='text-[var(--text-secondary)] text-base'>{transportLabel}</p>
            </div>

            {server.url && (
              <div className='flex flex-col gap-2'>
                <span className='font-medium text-[var(--text-primary)] text-sm'>URL</span>
                <p className='break-all text-[var(--text-secondary)] text-base'>{server.url}</p>
              </div>
            )}

            {server.connectionStatus === 'error' && (
              <div className='flex flex-col gap-2'>
                <span className='font-medium text-[var(--text-primary)] text-sm'>Status</span>
                <p className='text-base text-red-500 dark:text-red-400'>
                  {server.lastError || 'Unable to connect'}
                </p>
              </div>
            )}

            <div className='flex flex-col gap-2'>
              <span className='font-medium text-[var(--text-primary)] text-sm'>
                Tools ({tools.length})
              </span>
              {tools.length === 0 ? (
                <p className='text-[var(--text-muted)] text-sm'>No tools available</p>
              ) : (
                <div className='flex flex-col gap-2'>
                  {tools.map((tool) => {
                    const issues = getStoredToolIssues(server.id, tool.name)
                    const affectedWorkflows = issues.map((i) => i.workflowName)
                    const isExpanded = expandedTools.has(tool.name)
                    const hasParams =
                      tool.inputSchema?.properties &&
                      Object.keys(tool.inputSchema.properties).length > 0
                    const requiredParams = tool.inputSchema?.required || []

                    return (
                      <div
                        key={tool.name}
                        className='overflow-hidden rounded-md border bg-[var(--surface-3)]'
                      >
                        <button
                          type='button'
                          onClick={() => hasParams && toggleToolExpanded(tool.name)}
                          className={cn(
                            'flex w-full items-start justify-between px-2.5 py-2 text-left',
                            hasParams && 'cursor-pointer hover-hover:bg-[var(--surface-4)]'
                          )}
                          disabled={!hasParams}
                        >
                          <div className='flex-1'>
                            <div className='flex h-[16px] items-center gap-1.5'>
                              <p className='font-medium text-[var(--text-primary)] text-sm leading-none'>
                                {tool.name}
                              </p>
                              {issues.length > 0 && (
                                <Tooltip.Root>
                                  <Tooltip.Trigger asChild>
                                    <div className='flex items-center'>
                                      <Badge
                                        variant={getIssueBadgeVariant(issues[0].issue)}
                                        size='sm'
                                      >
                                        {getIssueBadgeLabel(issues[0].issue)}
                                      </Badge>
                                    </div>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content>
                                    Update in: {affectedWorkflows.join(', ')}
                                  </Tooltip.Content>
                                </Tooltip.Root>
                              )}
                            </div>
                            {tool.description && (
                              <p className='mt-1 text-[var(--text-tertiary)] text-sm'>
                                {tool.description}
                              </p>
                            )}
                          </div>
                          {hasParams && (
                            <ChevronDown
                              className={cn(
                                'mt-0.5 h-[14px] w-[14px] flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200',
                                isExpanded && 'rotate-180'
                              )}
                            />
                          )}
                        </button>

                        {isExpanded && hasParams && (
                          <div className='border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 py-2'>
                            <p className='mb-1.5 font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide'>
                              Parameters
                            </p>
                            <div className='flex flex-col gap-1.5'>
                              {Object.entries(tool.inputSchema!.properties!).map(
                                ([paramName, param]) => {
                                  const isRequired = requiredParams.includes(paramName)
                                  const paramType =
                                    typeof param === 'object' && param !== null
                                      ? (param as { type?: string }).type || 'any'
                                      : 'any'
                                  const paramDesc =
                                    typeof param === 'object' && param !== null
                                      ? (param as { description?: string }).description
                                      : undefined

                                  return (
                                    <div
                                      key={paramName}
                                      className='rounded-sm border border-[var(--border-1)] bg-[var(--surface-3)] px-2 py-1.5'
                                    >
                                      <div className='flex items-center gap-1.5'>
                                        <span className='font-medium text-[var(--text-primary)] text-small'>
                                          {paramName}
                                        </span>
                                        <Badge variant='outline' size='sm'>
                                          {paramType}
                                        </Badge>
                                        {isRequired && (
                                          <Badge variant='default' size='sm'>
                                            required
                                          </Badge>
                                        )}
                                      </div>
                                      {paramDesc && (
                                        <p className='mt-[3px] text-[var(--text-tertiary)] text-xs leading-relaxed'>
                                          {paramDesc}
                                        </p>
                                      )}
                                    </div>
                                  )
                                }
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className='mt-auto flex items-center justify-between'>
          <Button onClick={handleBackToList} variant='default'>
            Back
          </Button>
          <div className='flex items-center gap-2'>
            <Button
              onClick={() => handleRefreshServer(server.id)}
              variant='default'
              disabled={!!refreshingServers[server.id]}
            >
              {refreshingServers[server.id]?.status === 'refreshing'
                ? 'Refreshing...'
                : refreshingServers[server.id]?.status === 'refreshed'
                  ? refreshingServers[server.id].workflowsUpdated
                    ? `Synced (${refreshingServers[server.id].workflowsUpdated} workflow${refreshingServers[server.id].workflowsUpdated === 1 ? '' : 's'})`
                    : 'Refreshed'
                  : 'Refresh Tools'}
            </Button>
            <Button onClick={() => handleOpenEditModal(server)} variant='default'>
              Edit
            </Button>
          </div>
        </div>

        <McpServerFormModal
          open={showEditModal}
          onOpenChange={setShowEditModal}
          mode='edit'
          initialData={editInitialData}
          onSubmit={async (config) => {
            const currentServer = servers.find((s) => s.id === selectedServerId)
            await updateServerMutation.mutateAsync({
              workspaceId,
              serverId: selectedServerId!,
              updates: {
                ...config,
                enabled: currentServer?.enabled ?? true,
              },
            })
          }}
          workspaceId={workspaceId}
          availableEnvVars={availableEnvVars}
          allowedMcpDomains={allowedMcpDomains}
        />
      </div>
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
              placeholder='Search MCPs...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Button onClick={() => setShowAddModal(true)} variant='primary' disabled={serversLoading}>
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
          ) : serversLoading ? (
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
                if (!server?.id) return null
                const tools = toolsByServer[server.id] || []
                const isLoadingTools = toolsLoading || toolsFetching

                return (
                  <ServerListItem
                    key={server.id}
                    server={server}
                    tools={tools}
                    isDeleting={deletingServers.has(server.id)}
                    isLoadingTools={isLoadingTools}
                    isRefreshing={refreshingServers[server.id]?.status === 'refreshing'}
                    onRemove={() => handleRemoveServer(server.id, server.name || 'this server')}
                    onViewDetails={() => handleViewDetails(server.id)}
                  />
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

      <McpServerFormModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        mode='add'
        onSubmit={async (config) => {
          await createServerMutation.mutateAsync({
            workspaceId,
            config: { ...config, enabled: true },
          })
        }}
        workspaceId={workspaceId}
        availableEnvVars={availableEnvVars}
        allowedMcpDomains={allowedMcpDomains}
      />

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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
            <Button variant='default' onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={confirmDeleteServer}>
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
