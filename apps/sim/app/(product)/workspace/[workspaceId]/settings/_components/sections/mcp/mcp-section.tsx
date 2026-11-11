'use client'

import { type ComponentProps, useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { useFeedbackExpiry } from '@sim/emcn/feedback/use-feedback-expiry'
import { Icon } from '@sim/emcn/icon'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
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
  mcpServerIdParam,
  useAllowedMcpDomains,
  useAvailableEnvVarKeys,
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpOauthPopup,
  useMcpServers,
  useMcpServerToolsProbe,
  useMcpToolsQuery,
  useRefreshMcpServer,
  useSettingsSearch,
  useStoredMcpTools,
  useUpdateMcpServer,
} from '@/platform/lib/data/mcp'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { plural } from '@/platform/shared/plural'

const logger = createLogger('McpSettings')

interface ServerRowStatus {
  connecting: boolean
  refreshing: boolean
}

/**
 * The row's status after its transport: what is happening to it now, or what it offers. The count
 * is the one stored at the server's last discovery, so the list probes no server.
 */
function describeServer(server: McpServer, status: ServerRowStatus): string {
  const state = server.managedConnectorId
    ? 'Managed by Connected accounts'
    : status.connecting
      ? 'Waiting for authorization…'
      : status.refreshing
        ? 'Refreshing…'
        : server.connectionStatus === 'error' || server.connectionStatus === 'disconnected'
          ? getServerToolsLabel([], server.connectionStatus, server.lastError, server.authType)
          : plural(server.toolCount ?? 0, 'tool')
  return `${formatTransportLabel(server.transport)} · ${state}`
}

interface McpServerViewProps
  extends Omit<
    ComponentProps<typeof McpServerDetail>,
    'discoveredTools' | 'storedTools' | 'toolsState' | 'onRetryTools'
  > {
  workspaceId: string
}

/**
 * The open server's detail with its tool reads, which load only while it is open: the workspace's
 * discovered tools, where workflows use them, and a fresh discovery of this server alone each time
 * it opens, by a click or a shared link.
 */
function McpServerView({ workspaceId, ...detail }: McpServerViewProps) {
  const { server, canEdit } = detail
  const { data: discoveredTools = [], toolsStateByServer } = useMcpToolsQuery(workspaceId)
  const { data: storedTools = [] } = useStoredMcpTools(workspaceId)
  const probe = useMcpServerToolsProbe(workspaceId, server.id, {
    enabled: canEdit && !server.managedConnectorId,
  })
  const discovery = toolsStateByServer.get(server.id)
  return (
    <McpServerDetail
      server={detail.server}
      servers={detail.servers}
      canEdit={detail.canEdit}
      authorizing={detail.authorizing}
      deleting={detail.deleting}
      refresh={detail.refresh}
      onBack={detail.onBack}
      onRefresh={detail.onRefresh}
      onEdit={detail.onEdit}
      onDelete={detail.onDelete}
      onAuthorize={detail.onAuthorize}
      discoveredTools={discoveredTools}
      storedTools={storedTools}
      toolsState={{
        isLoading: Boolean(discovery?.isLoading) || (probe.isFetching && !discovery),
        isFetching: Boolean(discovery?.isFetching) || probe.isFetching,
        error: probe.error ?? discovery?.error ?? null,
      }}
      onRetryTools={() => void probe.refetch()}
    />
  )
}

/** The workspace's MCP servers, whose tools workflows and agents call. */
export default function McpSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { canMutate: canEdit, permission } = useWorkspaceSettingsSection(workspaceId, 'mcp')
  const subview = useSettingsSubview({ idParam: mcpServerIdParam.key })
  const selectedServerId = subview.id
  const [search, setSearch] = useSettingsSearch()
  const [adding, setAdding] = useState(false)
  const [editingServerId, setEditingServerId] = useState<string | null>(null)
  const [deletingServers, setDeletingServers] = useState<ReadonlySet<string>>(() => new Set())
  const [serverToDeleteId, setServerToDeleteId] = useState<string | null>(null)
  const formOpen = adding || editingServerId !== null

  const serversQuery = useMcpServers(workspaceId)
  const servers = serversQuery.data ?? []
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

  useFeedbackExpiry(
    refreshServer.isSuccess || refreshServer.isError ? refreshServer.submittedAt : null,
    refreshServer.reset
  )

  const confirmDelete = async (serverId: string) => {
    setDeletingServers((previous) => new Set(previous).add(serverId))
    try {
      await deleteServer.mutateAsync({ workspaceId, serverId })
      if (selectedServerId === serverId) subview.close()
      logger.info('Removed MCP server', { serverId })
    } catch (error) {
      logger.error('Failed to remove MCP server', { error })
      throw error
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
    <ConfirmDialog
      target={serverToDeleteId}
      onClose={() => setServerToDeleteId(null)}
      title='Delete MCP server'
      description={`${serverToDelete?.name || 'This server'} and its tools leave the workspace, and workflows using them stop working. This action cannot be undone.`}
      confirmLabel='Delete'
      pendingLabel='Deleting…'
      onConfirm={confirmDelete}
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
        <McpServerView
          key={selectedServer.id}
          workspaceId={workspaceId}
          server={selectedServer}
          servers={servers}
          canEdit={canEdit}
          authorizing={connectingServers.has(selectedServer.id)}
          deleting={deletingServers.has(selectedServer.id)}
          refresh={getRefreshActionState({
            mutationStatus: currentRefresh ? refreshServer.status : 'idle',
            connectionStatus: currentRefresh ? refreshServer.data?.status : undefined,
            workflowsUpdated: currentRefresh ? refreshServer.data?.workflowsUpdated : undefined,
          })}
          onBack={subview.close}
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
  const addServer = canEdit ? (
    <Button size='compact' icon='I074' onClick={() => setAdding(true)}>
      Add server
    </Button>
  ) : undefined

  return (
    <SectionStack>
      <SettingsPageHeader />
      <SettingsRead query={serversQuery} failureMessage='Couldn’t load MCP servers'>
        {(loaded) => (
          <>
            {loaded.length > 0 && (
              <SectionToolbar
                grow={
                  <SearchField
                    label='Search servers'
                    placeholder='Search servers…'
                    value={search}
                    onValueChange={setSearch}
                  />
                }
              />
            )}
            <SettingsList
              title='Servers'
              empty={
                loaded.length === 0
                  ? {
                      title: 'No MCP servers yet',
                      description: canEdit
                        ? 'Connect an MCP server your workflows can call'
                        : undefined,
                      action: addServer,
                    }
                  : filtered.length === 0
                    ? { title: 'No matching servers' }
                    : undefined
              }
            >
              <ResourceList>
                {filtered.map((server) => (
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
                    detail={describeServer(server, {
                      connecting: connectingServers.has(server.id),
                      refreshing:
                        refreshServer.isPending && refreshServer.variables?.serverId === server.id,
                    })}
                    onOpen={() => subview.open(server.id)}
                  />
                ))}
              </ResourceList>
              {addServer && (
                <SettingsRow
                  label='New MCP server'
                  description='Connect an MCP server your workflows can call'
                >
                  {addServer}
                </SettingsRow>
              )}
            </SettingsList>
          </>
        )}
      </SettingsRead>
      {serverForm}
      {deleteConfirmation}
    </SectionStack>
  )
}
