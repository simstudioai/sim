'use client'

import { useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { ConnectionFormModal } from '@/app/workspace/[workspaceId]/settings/components/managed-agents/connection-form-modal'
import { RotateKeyModal } from '@/app/workspace/[workspaceId]/settings/components/managed-agents/rotate-key-modal'
import {
  useCreateManagedAgentConnection,
  useDeleteManagedAgentConnection,
  useManagedAgentConnections,
  useRotateManagedAgentConnection,
} from '@/hooks/queries/managed-agent-connections'

const logger = createLogger('ManagedAgentsSettings')

export function ManagedAgents() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workspacePermissions = useUserPermissionsContext()
  const canEdit = canMutateWorkspaceSettingsSection('managed-agents', workspacePermissions)

  const {
    data: connections = [],
    isLoading,
    error: listError,
  } = useManagedAgentConnections(workspaceId)
  const createConnection = useCreateManagedAgentConnection()
  const deleteConnection = useDeleteManagedAgentConnection()
  const rotateConnection = useRotateManagedAgentConnection()

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [showAddModal, setShowAddModal] = useState(false)
  const [connectionToDeleteId, setConnectionToDeleteId] = useState<string | null>(null)
  const [connectionToRotate, setConnectionToRotate] = useState<{
    id: string
    name: string
  } | null>(null)

  const filtered = connections.filter((c) => {
    if (!searchTerm.trim()) return true
    return c.name.toLowerCase().includes(searchTerm.toLowerCase())
  })

  const handleCreate = async (values: { name: string; apiKey: string }) => {
    await createConnection.mutateAsync({
      workspaceId,
      name: values.name,
      apiKey: values.apiKey,
    })
    toast.success('Claude workspace linked')
  }

  const confirmDelete = async () => {
    if (!connectionToDeleteId) return
    const id = connectionToDeleteId
    setConnectionToDeleteId(null)
    try {
      await deleteConnection.mutateAsync({ workspaceId, id })
      toast.success('Connection removed')
    } catch (error) {
      logger.error('Failed to delete connection:', error)
      toast.error('Failed to remove connection', {
        description: getErrorMessage(error),
      })
    }
  }

  const handleRotate = async (apiKey: string) => {
    if (!connectionToRotate) return
    await rotateConnection.mutateAsync({
      workspaceId,
      id: connectionToRotate.id,
      apiKey,
    })
    toast.success('API key rotated')
  }

  const hasConnections = connections.length > 0
  const showNoResults = searchTerm.trim() && filtered.length === 0 && hasConnections

  return (
    <>
      <SettingsPanel
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search connections...',
          disabled: isLoading,
        }}
        actions={
          canEdit
            ? [
                {
                  text: 'Link Claude workspace',
                  icon: Plus,
                  variant: 'primary',
                  onSelect: () => setShowAddModal(true),
                  disabled: isLoading,
                },
              ]
            : []
        }
      >
        {listError ? (
          <div className='flex h-full flex-col items-center justify-center gap-2'>
            <p className='text-[var(--text-error)] text-sm leading-tight'>
              {getErrorMessage(listError, 'Failed to load connections')}
            </p>
          </div>
        ) : isLoading ? null : !hasConnections ? (
          <SettingsEmptyState>
            {canEdit
              ? 'Click "Link Claude workspace" above to connect an Anthropic workspace.'
              : 'No Managed Agent connections configured.'}
          </SettingsEmptyState>
        ) : (
          <div className='flex flex-col gap-2'>
            {filtered.map((c) => {
              const subtitle = formatSubtitle(c)
              return (
                <div key={c.id} className='flex items-center justify-between gap-3'>
                  <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                    <div className='flex items-center gap-1.5'>
                      <span className='max-w-[240px] truncate text-[var(--text-body)] text-sm'>
                        {c.name}
                      </span>
                      <span className='text-[var(--text-muted)] text-caption'>
                        {c.maskedApiKey}
                      </span>
                    </div>
                    <p
                      className={
                        subtitle.isError
                          ? 'truncate text-[var(--text-error)] text-caption'
                          : 'truncate text-[var(--text-muted)] text-caption'
                      }
                    >
                      {subtitle.text}
                    </p>
                  </div>
                  <div className='flex flex-shrink-0 items-center gap-1'>
                    <RowActionsMenu
                      label='Connection actions'
                      actions={[
                        ...(canEdit
                          ? [
                              {
                                label: 'Rotate key',
                                onSelect: () =>
                                  setConnectionToRotate({ id: c.id, name: c.name }),
                              },
                              {
                                label: 'Remove',
                                destructive: true,
                                onSelect: () => setConnectionToDeleteId(c.id),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </div>
                </div>
              )
            })}
            {showNoResults && (
              <SettingsEmptyState variant='inline'>
                No connections found matching &quot;{searchTerm}&quot;
              </SettingsEmptyState>
            )}
          </div>
        )}
      </SettingsPanel>

      {canEdit && (
        <ConnectionFormModal
          open={showAddModal}
          onOpenChange={setShowAddModal}
          onSubmit={handleCreate}
        />
      )}

      {canEdit && (
        <ChipConfirmModal
          open={connectionToDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) setConnectionToDeleteId(null)
          }}
          srTitle='Remove connection'
          title='Remove Managed Agent connection'
          text={[
            'Any workflows that reference this connection will fail at run time until you re-link the workspace. This action cannot be undone.',
          ]}
          confirm={{ label: 'Remove', onClick: confirmDelete }}
        />
      )}

      {canEdit && (
        <RotateKeyModal
          open={connectionToRotate !== null}
          connectionName={connectionToRotate?.name ?? null}
          onOpenChange={(open) => {
            if (!open) setConnectionToRotate(null)
          }}
          onSubmit={handleRotate}
        />
      )}
    </>
  )
}

function formatSubtitle(row: {
  lastVerifiedAt: string | null
  lastVerificationError: string | null
}): { text: string; isError: boolean } {
  if (row.lastVerificationError) {
    return { text: row.lastVerificationError, isError: true }
  }
  if (row.lastVerifiedAt) {
    const when = new Date(row.lastVerifiedAt).toLocaleString()
    return { text: `Verified ${when}`, isError: false }
  }
  return { text: 'Not verified', isError: false }
}
