'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import { CreateMcpServerModal } from '@/app/(product)/workspace/[workspaceId]/_components/create-mcp-server-modal/create-mcp-server-modal'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { ServerDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/workflow-mcp-servers/server-detail'
import {
  createLogger,
  mcpServerIdParam,
  useDeleteWorkflowMcpServer,
  useDeployedWorkflows,
  useMcpServerTabParam,
  useSettingsSearch,
  useWorkflowMcpServers,
  type WorkflowMcpServer,
} from '@/platform/lib/data/mcp'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { plural } from '@/platform/shared/plural'

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
  const deleteServer = useDeleteWorkflowMcpServer()
  const [search, setSearch] = useSettingsSearch()
  const subview = useSettingsSubview({ idParam: mcpServerIdParam.key })
  const selectedServerId = subview.id
  const [, setServerTab] = useMcpServerTabParam()
  const [adding, setAdding] = useState(false)
  const deployed = useDeployedWorkflows(workspaceId, { enabled: adding })
  const [serverToDelete, setServerToDelete] = useState<WorkflowMcpServer | null>(null)
  const [deletingServers, setDeletingServers] = useState<ReadonlySet<string>>(() => new Set())

  /** Closing replaces the URL, so Back leaves the section rather than reopening the server. */
  const closeServer = () => {
    void setServerTab(null, { history: 'replace' })
    subview.close()
  }

  const confirmDelete = async ({ id: serverId }: WorkflowMcpServer) => {
    setDeletingServers((previous) => new Set(previous).add(serverId))
    try {
      await deleteServer.mutateAsync({ workspaceId, serverId })
      if (selectedServerId === serverId) closeServer()
    } catch (error) {
      logger.error('Failed to delete server', { error })
      throw error
    } finally {
      setDeletingServers((previous) => {
        const next = new Set(previous)
        next.delete(serverId)
        return next
      })
    }
  }

  const deleteConfirmation = canManage && (
    <ConfirmDialog
      target={serverToDelete}
      onClose={() => setServerToDelete(null)}
      title='Delete MCP server'
      description={({ name }) =>
        `Clients connected to ${name} lose its tools. This action cannot be undone.`
      }
      confirmLabel='Delete'
      pendingLabel='Deleting…'
      onConfirm={confirmDelete}
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
  const addServer = canManage ? (
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
                      description: canManage ? 'Serve deployed workflows as MCP tools' : undefined,
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
                    leading={<Icon name='I126' />}
                    title={server.name}
                    detail={plural(server.toolCount || 0, 'tool')}
                    textMetadata={server.isPublic ? 'Public' : undefined}
                    onOpen={() => {
                      // A lingering tab from a dead deep link must not retarget the next server.
                      void setServerTab(null)
                      subview.open(server.id)
                    }}
                  />
                ))}
              </ResourceList>
              {addServer && (
                <SettingsRow
                  label='New MCP server'
                  description='Serve deployed workflows as MCP tools'
                >
                  {addServer}
                </SettingsRow>
              )}
            </SettingsList>
          </>
        )}
      </SettingsRead>
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
