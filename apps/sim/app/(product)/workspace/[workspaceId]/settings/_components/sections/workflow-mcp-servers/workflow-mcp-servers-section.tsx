'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
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
import { CreateMcpServerModal } from '@/app/(product)/workspace/[workspaceId]/_components/create-mcp-server-modal/create-mcp-server-modal'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { ServerDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/workflow-mcp-servers/server-detail'
import {
  createLogger,
  useDeleteWorkflowMcpServer,
  useDeployedWorkflows,
  useMcpServerIdParam,
  useMcpServerTabParam,
  useSettingsSearch,
  useWorkflowMcpServers,
  type WorkflowMcpServer,
} from '@/platform/lib/data/mcp'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

const logger = createLogger('WorkflowMcpServers')

/** The workspace's MCP servers that serve deployed workflows as tools to outside clients. */
export default function WorkflowMcpServersSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { canMutate: canManage, permission } = useWorkspaceSettingsSection(
    workspaceId,
    'workflow-mcp-servers'
  )
  const canChangeVisibility = permission === 'admin'
  const serversQuery = useWorkflowMcpServers(workspaceId)
  const servers = serversQuery.data ?? []
  const deployed = useDeployedWorkflows(workspaceId)
  const deleteServer = useDeleteWorkflowMcpServer()
  const [search, setSearch] = useSettingsSearch()
  const [selectedServerId, setSelectedServerId] = useMcpServerIdParam()
  const [, setServerTab] = useMcpServerTabParam()
  const [adding, setAdding] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<WorkflowMcpServer | null>(null)
  const [deletingServers, setDeletingServers] = useState<ReadonlySet<string>>(() => new Set())

  /** Closing replaces the URL, so Back leaves the section rather than reopening the server. */
  const closeServer = () => {
    void setServerTab(null, { history: 'replace' })
    void setSelectedServerId(null, { history: 'replace' })
  }

  const confirmDelete = async () => {
    if (!serverToDelete) return
    const serverId = serverToDelete.id
    setServerToDelete(null)
    setDeletingServers((previous) => new Set(previous).add(serverId))
    try {
      await deleteServer.mutateAsync({ workspaceId, serverId })
      if (selectedServerId === serverId) closeServer()
    } catch (error) {
      logger.error('Failed to delete server', { error })
      toast.error('Failed to delete MCP server', { description: getErrorMessage(error) })
    } finally {
      setDeletingServers((previous) => {
        const next = new Set(previous)
        next.delete(serverId)
        return next
      })
    }
  }

  const deleteConfirmation = canManage && (
    <Modal
      variant='confirm'
      destructive
      open={serverToDelete !== null}
      onOpenChange={(open) => {
        if (!open) setServerToDelete(null)
      }}
      title='Delete MCP server'
      description={`Are you sure you want to delete ${serverToDelete?.name ?? 'this server'}? This action cannot be undone.`}
      confirmLabel='Delete'
      onConfirm={() => void confirmDelete()}
    />
  )

  /** A valid deep link never flashes the list before jumping to it; a dead id falls back to it. */
  if (selectedServerId !== null && serversQuery.isPending) return null
  const selectedServer = selectedServerId
    ? servers.find((server) => server.id === selectedServerId)
    : undefined

  if (selectedServer) {
    return (
      <>
        <ServerDetail
          key={selectedServer.id}
          workspaceId={workspaceId}
          server={selectedServer}
          canManage={canManage}
          canChangeVisibility={canChangeVisibility}
          deleting={deletingServers.has(selectedServer.id)}
          onBack={closeServer}
          onDelete={() => setServerToDelete(selectedServer)}
        />
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
            description={canManage ? 'Add a server to get started.' : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title={`No servers found matching "${search}"`} />
        ) : (
          <ResourceList>
            {filtered.map((server) => {
              const count = server.toolCount || 0
              return (
                <ActivityRow
                  key={server.id}
                  leading={<Icon name='I126' />}
                  title={server.name}
                  detail={`${count} tool${count !== 1 ? 's' : ''}`}
                  textMetadata={server.isPublic ? 'Public' : undefined}
                  onOpen={() => {
                    // A lingering tab from a dead deep link must not retarget the next server.
                    void setServerTab(null)
                    void setSelectedServerId(server.id)
                  }}
                />
              )
            })}
          </ResourceList>
        )}
        {canManage && (
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
      {adding && (
        <CreateMcpServerModal
          workspaceId={workspaceId}
          canChangeVisibility={canChangeVisibility}
          workflowOptions={(deployed.data ?? []).map((workflow) => ({
            value: workflow.id,
            label: workflow.name,
          }))}
          onClose={() => setAdding(false)}
        />
      )}
      {deleteConfirmation}
    </SectionStack>
  )
}
