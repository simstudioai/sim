'use client'

import { useEffect, useRef, useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { useFeedbackExpiry } from '@sim/emcn/feedback/use-feedback-expiry'
import { Icon } from '@sim/emcn/icon'
import { Modal } from '@sim/emcn/modal'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { McpServerFormModal } from '@/app/(product)/workspace/[workspaceId]/_components/mcp-server-form/mcp-server-form'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { McpServerDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/mcp/mcp-server-detail'
import {
  buildEditInitialData,
  formatTransportLabel,
  getRefreshActionState,
  getServerToolsLabel,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/mcp/server-status'
import {
  createLogger,
  type McpServer,
  type McpTool,
  useAllowedMcpDomains,
  useAvailableEnvVarKeys,
  useCreateMcpServer,
  useDeleteMcpServer,
  useForceRefreshMcpTools,
  useMcpOauthPopup,
  useMcpServerIdParam,
  useMcpServers,
  useMcpToolsQuery,
  useRefreshMcpServer,
  useSettingsSearch,
  useStoredMcpTools,
  useUpdateMcpServer,
} from '@/platform/lib/data/mcp'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

const logger = createLogger('McpSettings')

interface ServerRowStatus {
  connecting: boolean
  refreshing: boolean
  loadingTools: boolean
  discoveryError: string | null
}

/** The row's status after its transport: what is happening to it now, or what it offers. */
function describeServer(server: McpServer, tools: McpTool[], status: ServerRowStatus): string {
  // A connected server with last-known tools keeps its count through a transient probe failure.
  const showDiscoveryError =
    Boolean(status.discoveryError) &&
    tools.length === 0 &&
    server.connectionStatus !== 'error' &&
    server.connectionStatus !== 'disconnected'
  const state = server.managedConnectorId
    ? 'Managed by Connected accounts'
    : status.connecting
      ? 'Waiting for authorization...'
      : status.refreshing
        ? 'Refreshing...'
        : status.loadingTools && tools.length === 0
          ? 'Loading...'
          : showDiscoveryError && status.discoveryError
            ? status.discoveryError
            : getServerToolsLabel(tools, server.connectionStatus, server.lastError, server.authType)
  return `${formatTransportLabel(server.transport)} · ${state}`
}

/** The workspace's MCP servers, whose tools workflows and agents call. */
export default function McpSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { canMutate: canEdit, permission } = useWorkspaceSettingsSection(workspaceId, 'mcp')
  const [selectedServerId, setSelectedServerId] = useMcpServerIdParam()
  const [search, setSearch] = useSettingsSearch()
  const [adding, setAdding] = useState(false)
  const [editingServerId, setEditingServerId] = useState<string | null>(null)
  const [deletingServers, setDeletingServers] = useState<ReadonlySet<string>>(() => new Set())
  const [serverToDeleteId, setServerToDeleteId] = useState<string | null>(null)
  const formOpen = adding || editingServerId !== null

  const serversQuery = useMcpServers(workspaceId)
  const servers = serversQuery.data ?? []
  const { data: discoveredTools = [], toolsStateByServer } = useMcpToolsQuery(workspaceId)
  const { data: storedTools = [], refetch: refetchStoredTools } = useStoredMcpTools(workspaceId, {
    enabled: selectedServerId !== null,
  })
  const { mutate: forceRefreshTools } = useForceRefreshMcpTools()
  const createServer = useCreateMcpServer()
  const deleteServer = useDeleteMcpServer()
  const refreshServer = useRefreshMcpServer()
  const updateServer = useUpdateMcpServer()
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId, { enabled: formOpen })
  const domains = useAllowedMcpDomains({ enabled: formOpen })
  const domainPolicyUnavailable = formOpen && (domains.isPending || domains.isError)
  const domainPolicyError = domains.isError
    ? 'Unable to load the MCP domain policy. Try again before saving this server.'
    : undefined
  const { connectingServers, startOauthForServer } = useMcpOauthPopup({ workspaceId })

  // A deep link opens a server whose tools may be stale, so they are probed as a click would.
  const initialServerId = useRef(selectedServerId)
  const refreshedDeepLink = useRef(false)
  useEffect(() => {
    if (refreshedDeepLink.current || !initialServerId.current) return
    refreshedDeepLink.current = true
    if (canEdit) forceRefreshTools(workspaceId)
    void refetchStoredTools()
  }, [canEdit, workspaceId, forceRefreshTools, refetchStoredTools])

  useFeedbackExpiry(
    refreshServer.isSuccess || refreshServer.isError ? refreshServer.submittedAt : null,
    refreshServer.reset
  )

  const toolsByServer = new Map<string, McpTool[]>()
  for (const tool of discoveredTools) {
    toolsByServer.set(tool.serverId, [...(toolsByServer.get(tool.serverId) ?? []), tool])
  }

  const openServer = (serverId: string) => {
    void setSelectedServerId(serverId)
    if (canEdit) forceRefreshTools(workspaceId)
    void refetchStoredTools()
  }

  /** Closing replaces the URL, so Back leaves the section rather than reopening the server. */
  const closeServer = () => void setSelectedServerId(null, { history: 'replace' })

  const confirmDelete = async () => {
    if (!serverToDeleteId) return
    const serverId = serverToDeleteId
    setServerToDeleteId(null)
    setDeletingServers((previous) => new Set(previous).add(serverId))
    try {
      await deleteServer.mutateAsync({ workspaceId, serverId })
      if (selectedServerId === serverId) closeServer()
      logger.info('Removed MCP server', { serverId })
    } catch (error) {
      logger.error('Failed to remove MCP server', { error })
      toast.error('Failed to remove MCP server', { description: getErrorMessage(error) })
    } finally {
      setDeletingServers((previous) => {
        const next = new Set(previous)
        next.delete(serverId)
        return next
      })
    }
  }

  const refresh = async (serverId: string) => {
    try {
      const result = await refreshServer.mutateAsync({ workspaceId, serverId })
      logger.info('Refreshed MCP server', { serverId, workflowsUpdated: result.workflowsUpdated })
    } catch (error) {
      logger.error('Failed to refresh MCP server', { error })
      toast.error('Failed to refresh MCP server', { description: getErrorMessage(error) })
    }
  }

  const editingServer = editingServerId
    ? servers.find((server) => server.id === editingServerId)
    : undefined
  const serverToDelete = servers.find((server) => server.id === serverToDeleteId)

  const deleteConfirmation = canEdit && (
    <Modal
      variant='confirm'
      destructive
      open={serverToDeleteId !== null}
      onOpenChange={(open) => {
        if (!open) setServerToDeleteId(null)
      }}
      title='Delete MCP server'
      description={`Are you sure you want to delete ${serverToDelete?.name || 'this server'}? This action cannot be undone.`}
      confirmLabel='Delete'
      onConfirm={() => void confirmDelete()}
    />
  )

  const serverForm = canEdit && (
    <McpServerFormModal
      open={formOpen}
      onOpenChange={(open) => {
        if (open) return
        setAdding(false)
        setEditingServerId(null)
      }}
      mode={editingServer ? 'edit' : 'add'}
      initialData={editingServer ? buildEditInitialData(editingServer) : undefined}
      onSubmit={async (config) => {
        if (editingServer) {
          await updateServer.mutateAsync({
            workspaceId,
            serverId: editingServer.id,
            updates: { ...config, enabled: editingServer.enabled },
          })
          return
        }
        const result = await createServer.mutateAsync({
          workspaceId,
          config: { ...config, enabled: true },
        })
        if (result.authType === 'oauth') await startOauthForServer(result.serverId)
      }}
      workspaceId={workspaceId}
      availableEnvVars={availableEnvVars}
      allowedMcpDomains={domains.data ?? null}
      domainPolicyUnavailable={domainPolicyUnavailable}
      domainPolicyError={domainPolicyError}
      canChangeDestination={editingServer ? permission === 'admin' : true}
    />
  )

  /** A valid deep link never flashes the list before jumping to it; a dead id falls back to it. */
  if (selectedServerId !== null && serversQuery.isPending) return null
  const selectedServer = selectedServerId
    ? servers.find((server) => server.id === selectedServerId)
    : undefined

  if (selectedServer) {
    const currentRefresh = refreshServer.variables?.serverId === selectedServer.id
    return (
      <>
        <McpServerDetail
          key={selectedServer.id}
          server={selectedServer}
          servers={servers}
          discoveredTools={discoveredTools}
          storedTools={storedTools}
          canEdit={canEdit}
          authorizing={connectingServers.has(selectedServer.id)}
          deleting={deletingServers.has(selectedServer.id)}
          refresh={getRefreshActionState({
            mutationStatus: currentRefresh ? refreshServer.status : 'idle',
            connectionStatus: currentRefresh ? refreshServer.data?.status : undefined,
            workflowsUpdated: currentRefresh ? refreshServer.data?.workflowsUpdated : undefined,
          })}
          onBack={closeServer}
          onRefresh={() => void refresh(selectedServer.id)}
          onEdit={() => setEditingServerId(selectedServer.id)}
          onDelete={() => setServerToDeleteId(selectedServer.id)}
          onAuthorize={() => void startOauthForServer(selectedServer.id)}
        />
        {serverForm}
        {deleteConfirmation}
      </>
    )
  }

  const query = search.trim().toLowerCase()
  const filtered = servers.filter((server) => server.name.toLowerCase().includes(query))

  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SearchField
            label='Search servers'
            placeholder='Search servers...'
            value={search}
            onValueChange={setSearch}
          />
        }
      />
      <SettingsSection title='Servers'>
        {serversQuery.error ? (
          <FailureNotice
            message={getErrorMessage(serversQuery.error, 'Failed to load MCP servers')}
            retrying={serversQuery.isFetching}
            onRetry={() => void serversQuery.refetch()}
          />
        ) : serversQuery.isPending ? null : servers.length === 0 ? (
          <EmptyState
            title='No MCP servers configured'
            description={canEdit ? 'Add a server to get started.' : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title={`No servers found matching "${search}"`} />
        ) : (
          <ResourceList>
            {filtered.map((server) => {
              const tools = toolsByServer.get(server.id) ?? []
              const toolsState = toolsStateByServer.get(server.id)
              return (
                <ActivityRow
                  key={server.id}
                  leading={
                    server.managedConnectorId ? (
                      <Icon providerId={server.managedConnectorId} />
                    ) : (
                      <Icon name='I126' />
                    )
                  }
                  title={server.name || 'Unnamed server'}
                  detail={describeServer(server, tools, {
                    connecting: connectingServers.has(server.id),
                    refreshing:
                      refreshServer.isPending && refreshServer.variables?.serverId === server.id,
                    loadingTools: Boolean(toolsState?.isLoading || toolsState?.isFetching),
                    discoveryError: toolsState?.error ? getErrorMessage(toolsState.error) : null,
                  })}
                  onOpen={() => openServer(server.id)}
                />
              )
            })}
          </ResourceList>
        )}
        {canEdit && (
          <SettingsRow label='New MCP server'>
            <Button
              size='compact'
              icon='I074'
              disabled={serversQuery.isPending}
              onClick={() => setAdding(true)}
            >
              Add server
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
      {serverForm}
      {deleteConfirmation}
    </SectionStack>
  )
}
