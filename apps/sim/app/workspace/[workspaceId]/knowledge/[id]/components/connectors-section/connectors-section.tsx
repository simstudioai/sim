'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Trash,
  XCircle,
} from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  Tooltip,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { consumeOAuthReturnContext, writeOAuthReturnContext } from '@/lib/credentials/client-state'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  type OAuthProvider,
} from '@/lib/oauth'
import { getMissingRequiredScopes } from '@/lib/oauth/utils'
import { OAuthModal } from '@/app/workspace/[workspaceId]/components/oauth-modal'
import { EditConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/edit-connector-modal'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type { ConnectorData, SyncLogData } from '@/hooks/queries/kb/connectors'
import {
  useConnectorDetail,
  useDeleteConnector,
  useTriggerSync,
  useUpdateConnector,
} from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'

const logger = createLogger('ConnectorsSection')

interface ConnectorsSectionProps {
  workspaceId: string
  knowledgeBaseId: string
  connectors: ConnectorData[]
  isLoading: boolean
  canEdit: boolean
}

/** 5-minute cooldown after a manual sync trigger */
const SYNC_COOLDOWN_MS = 5 * 60 * 1000

const STATUS_CONFIG = {
  active: { label: 'Active', variant: 'green' as const },
  syncing: { label: 'Syncing', variant: 'amber' as const },
  error: { label: 'Error', variant: 'red' as const },
  paused: { label: 'Paused', variant: 'gray' as const },
} as const

export function ConnectorsSection({
  workspaceId,
  knowledgeBaseId,
  connectors,
  isLoading,
  canEdit,
}: ConnectorsSectionProps) {
  const { mutate: triggerSync } = useTriggerSync()
  const { mutate: updateConnector } = useUpdateConnector()
  const { mutate: deleteConnector, isPending: isDeleting } = useDeleteConnector()
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteDocuments, setDeleteDocuments] = useState(false)

  const closeDeleteModal = useCallback(() => {
    setDeleteTarget(null)
    setDeleteDocuments(false)
  }, [])
  const [editingConnector, setEditingConnector] = useState<ConnectorData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncingIds, setSyncingIds] = useState<Set<string>>(() => new Set())
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set())

  const addToSet = useCallback((setter: typeof setSyncingIds, id: string) => {
    setter((prev) => new Set(prev).add(id))
  }, [])

  const removeFromSet = useCallback((setter: typeof setSyncingIds, id: string) => {
    setter((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const syncTriggeredAt = useRef<Record<string, number>>({})
  const cooldownTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    return () => {
      for (const timer of cooldownTimers.current) {
        clearTimeout(timer)
      }
    }
  }, [])

  const isSyncOnCooldown = useCallback((connectorId: string) => {
    const triggeredAt = syncTriggeredAt.current[connectorId]
    if (!triggeredAt) return false
    return Date.now() - triggeredAt < SYNC_COOLDOWN_MS
  }, [])

  const handleSync = useCallback(
    (connectorId: string) => {
      if (isSyncOnCooldown(connectorId)) return

      syncTriggeredAt.current[connectorId] = Date.now()
      addToSet(setSyncingIds, connectorId)

      triggerSync(
        { knowledgeBaseId, connectorId },
        {
          onSuccess: () => {
            setError(null)
            const timer = setTimeout(() => {
              cooldownTimers.current.delete(timer)
              forceUpdate((n) => n + 1)
            }, SYNC_COOLDOWN_MS)
            cooldownTimers.current.add(timer)
          },
          onError: (err) => {
            logger.error('Sync trigger failed', { error: err.message })
            setError(err.message)
            delete syncTriggeredAt.current[connectorId]
            forceUpdate((n) => n + 1)
          },
          onSettled: () => removeFromSet(setSyncingIds, connectorId),
        }
      )
    },
    [knowledgeBaseId, triggerSync, isSyncOnCooldown, addToSet, removeFromSet]
  )

  const handleTogglePause = useCallback(
    (connector: ConnectorData) => {
      addToSet(setUpdatingIds, connector.id)
      updateConnector(
        {
          knowledgeBaseId,
          connectorId: connector.id,
          updates: {
            status: connector.status === 'paused' ? 'active' : 'paused',
          },
        },
        {
          onSettled: () => removeFromSet(setUpdatingIds, connector.id),
          onSuccess: () => setError(null),
          onError: (err) => {
            logger.error('Toggle pause failed', { error: err.message })
            setError(err.message)
          },
        }
      )
    },
    [knowledgeBaseId, updateConnector, addToSet, removeFromSet]
  )

  if (connectors.length === 0 && !canEdit && !isLoading) return null

  return (
    <div className='mt-4'>
      {error && <p className='mt-2 text-[var(--text-error)] text-caption leading-tight'>{error}</p>}

      {isLoading ? (
        <div className='mt-2 flex flex-col gap-2'>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className='rounded-lg border border-[var(--border-1)] px-3 py-2.5'>
              <div className='flex items-center gap-2.5'>
                <Skeleton className='h-5 w-5 flex-shrink-0 rounded-sm' />
                <div className='flex flex-col gap-1'>
                  <div className='flex items-center gap-2'>
                    <Skeleton className='h-[14px] w-[100px]' />
                    <Skeleton className='h-[18px] w-[52px] rounded-full' />
                  </div>
                  <Skeleton className='h-[12px] w-[180px]' />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : connectors.length === 0 ? (
        <p className='mt-2 text-[var(--text-muted)] text-small'>
          No connected sources yet. Connect an external source to automatically sync documents.
        </p>
      ) : (
        <div className='mt-2 flex flex-col gap-2'>
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              workspaceId={workspaceId}
              knowledgeBaseId={knowledgeBaseId}
              canEdit={canEdit}
              isSyncPending={syncingIds.has(connector.id)}
              isUpdating={updatingIds.has(connector.id)}
              syncCooldown={isSyncOnCooldown(connector.id)}
              onSync={() => handleSync(connector.id)}
              onTogglePause={() => handleTogglePause(connector)}
              onEdit={() => setEditingConnector(connector)}
              onDelete={() => setDeleteTarget(connector.id)}
            />
          ))}
        </div>
      )}

      {editingConnector && (
        <EditConnectorModal
          open={editingConnector !== null}
          onOpenChange={(val) => !val && setEditingConnector(null)}
          knowledgeBaseId={knowledgeBaseId}
          connector={editingConnector}
        />
      )}

      <Modal open={deleteTarget !== null} onOpenChange={closeDeleteModal}>
        <ModalContent size='sm'>
          <ModalHeader>Remove Connector</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)] text-sm'>
              This will disconnect the source and stop future syncs. Documents already synced will
              remain in the knowledge base unless you choose to delete them.
            </p>
            <div className='mt-3 flex items-center gap-2'>
              <Checkbox
                id='delete-docs'
                checked={deleteDocuments}
                onCheckedChange={(checked) => setDeleteDocuments(checked === true)}
              />
              <label
                htmlFor='delete-docs'
                className='cursor-pointer text-[var(--text-secondary)] text-sm'
              >
                Also delete all synced documents
              </label>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={closeDeleteModal} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              disabled={isDeleting}
              onClick={() => {
                if (deleteTarget) {
                  deleteConnector(
                    { knowledgeBaseId, connectorId: deleteTarget, deleteDocuments },
                    {
                      onSuccess: () => {
                        setError(null)
                        closeDeleteModal()
                      },
                      onError: (err) => {
                        logger.error('Delete connector failed', { error: err.message })
                        setError(err.message)
                        closeDeleteModal()
                      },
                    }
                  )
                }
              }}
            >
              {isDeleting ? 'Removing...' : 'Remove'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

interface ConnectorCardProps {
  connector: ConnectorData
  workspaceId: string
  knowledgeBaseId: string
  canEdit: boolean
  isSyncPending: boolean
  isUpdating: boolean
  syncCooldown: boolean
  onSync: () => void
  onEdit: () => void
  onTogglePause: () => void
  onDelete: () => void
}

function ConnectorCard({
  connector,
  workspaceId,
  knowledgeBaseId,
  canEdit,
  isSyncPending,
  isUpdating,
  syncCooldown,
  onSync,
  onEdit,
  onTogglePause,
  onDelete,
}: ConnectorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)

  const connectorDef = CONNECTOR_REGISTRY[connector.connectorType]
  const Icon = connectorDef?.icon
  const statusConfig =
    STATUS_CONFIG[connector.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.active

  const serviceId = connectorDef?.auth.mode === 'oauth' ? connectorDef.auth.provider : undefined
  const providerId = serviceId ? getProviderIdFromServiceId(serviceId) : undefined
  const requiredScopes =
    connectorDef?.auth.mode === 'oauth' ? (connectorDef.auth.requiredScopes ?? []) : []

  const { data: credentials, refetch: refetchCredentials } = useOAuthCredentials(providerId, {
    workspaceId,
  })

  useCredentialRefreshTriggers(refetchCredentials, providerId ?? '', workspaceId)

  const missingScopes = useMemo(() => {
    if (!credentials || !connector.credentialId) return []
    const credential = credentials.find((c) => c.id === connector.credentialId)
    if (!credential) return []
    return getMissingRequiredScopes(credential, requiredScopes)
  }, [credentials, connector.credentialId, requiredScopes])

  const { data: detail, isLoading: detailLoading } = useConnectorDetail(
    expanded ? knowledgeBaseId : undefined,
    expanded ? connector.id : undefined
  )
  const syncLogs = detail?.syncLogs ?? []

  return (
    <div className='rounded-lg border border-[var(--border-1)]'>
      <div className='flex items-center justify-between px-3 py-2.5'>
        <div className='flex items-center gap-2.5'>
          {Icon && <Icon className='h-5 w-5 flex-shrink-0' />}
          <div className='flex flex-col gap-0.5'>
            <div className='flex items-center gap-2'>
              <span className='flex items-center gap-1.5 font-medium text-[var(--text-primary)] text-small'>
                {connectorDef?.name || connector.connectorType}
                {(isSyncPending || connector.status === 'syncing') && (
                  <Loader2 className='h-3 w-3 animate-spin text-[var(--text-muted)]' />
                )}
              </span>
              <Badge variant={statusConfig.variant} className='text-micro'>
                {statusConfig.label}
              </Badge>
            </div>
            <div className='flex items-center gap-1.5 text-[var(--text-muted)] text-xs'>
              {connector.lastSyncAt && (
                <span>Last sync: {format(new Date(connector.lastSyncAt), 'MMM d, h:mm a')}</span>
              )}
              {connector.lastSyncDocCount !== null && (
                <>
                  <span>·</span>
                  <span>{connector.lastSyncDocCount} docs</span>
                </>
              )}
              {connector.nextSyncAt && connector.status === 'active' && (
                <>
                  <span>·</span>
                  <span>
                    Next sync:{' '}
                    {isPast(new Date(connector.nextSyncAt))
                      ? 'pending'
                      : formatDistanceToNow(new Date(connector.nextSyncAt), { addSuffix: true })}
                  </span>
                </>
              )}
              {connector.lastSyncError && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <AlertCircle className='h-3 w-3 text-[var(--text-error)]' />
                  </Tooltip.Trigger>
                  <Tooltip.Content>{connector.lastSyncError}</Tooltip.Content>
                </Tooltip.Root>
              )}
            </div>
          </div>
        </div>

        <div className='flex items-center gap-1'>
          {canEdit && (
            <>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    className='h-7 w-7 p-0'
                    onClick={onSync}
                    disabled={connector.status === 'syncing' || isSyncPending || syncCooldown}
                  >
                    <RefreshCw
                      className={cn(
                        'h-3.5 w-3.5',
                        connector.status === 'syncing' && 'animate-spin'
                      )}
                    />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {syncCooldown ? 'Sync recently triggered' : 'Sync now'}
                </Tooltip.Content>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button variant='ghost' className='h-7 w-7 p-0' onClick={onEdit}>
                    <Settings className='h-3.5 w-3.5' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Settings</Tooltip.Content>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    className='h-7 w-7 p-0'
                    onClick={onTogglePause}
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <Loader2 className='h-3.5 w-3.5 animate-spin' />
                    ) : connector.status === 'paused' ? (
                      <Play className='h-3.5 w-3.5' />
                    ) : (
                      <Pause className='h-3.5 w-3.5' />
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {connector.status === 'paused' ? 'Resume' : 'Pause'}
                </Tooltip.Content>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button variant='ghost' className='h-7 w-7 p-0' onClick={onDelete}>
                    <Trash className='h-3.5 w-3.5' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Delete</Tooltip.Content>
              </Tooltip.Root>
            </>
          )}

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                className='h-7 w-7 p-0'
                onClick={() => setExpanded((prev) => !prev)}
              >
                <ChevronDown
                  className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
                />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{expanded ? 'Hide history' : 'Sync history'}</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>

      {missingScopes.length > 0 && (
        <div className='border-[var(--border-1)] border-t px-3 py-2'>
          <div className='flex flex-col gap-1 rounded-sm border bg-[var(--surface-2)] px-2 py-1.5'>
            <div className='flex items-center font-medium text-caption'>
              <span className='mr-1.5 inline-block h-[6px] w-[6px] rounded-xs bg-amber-500' />
              Additional permissions required
            </div>
            {canEdit && (
              <Button
                variant='active'
                onClick={() => {
                  if (connector.credentialId) {
                    writeOAuthReturnContext({
                      origin: 'kb-connectors',
                      knowledgeBaseId,
                      displayName: connectorDef?.name ?? connector.connectorType,
                      providerId: providerId!,
                      preCount: credentials?.length ?? 0,
                      workspaceId,
                      requestedAt: Date.now(),
                    })
                  }
                  setShowOAuthModal(true)
                }}
                className='w-full px-2 py-1 font-medium text-caption'
              >
                Update access
              </Button>
            )}
          </div>
        </div>
      )}

      {expanded && (
        <div className='border-[var(--border-1)] border-t px-3 py-2'>
          <SyncHistory logs={syncLogs} isLoading={detailLoading} />
        </div>
      )}

      {showOAuthModal && serviceId && providerId && !connector.credentialId && (
        <OAuthModal
          mode='connect'
          isOpen={showOAuthModal}
          onClose={() => {
            consumeOAuthReturnContext()
            setShowOAuthModal(false)
          }}
          provider={providerId as OAuthProvider}
          serviceId={serviceId}
          workspaceId={workspaceId}
          knowledgeBaseId={knowledgeBaseId}
          credentialCount={credentials?.length ?? 0}
        />
      )}

      {showOAuthModal && serviceId && providerId && connector.credentialId && (
        <OAuthModal
          mode='reauthorize'
          isOpen={showOAuthModal}
          onClose={() => {
            consumeOAuthReturnContext()
            setShowOAuthModal(false)
          }}
          provider={providerId as OAuthProvider}
          toolName={connectorDef?.name ?? connector.connectorType}
          requiredScopes={getCanonicalScopesForProvider(providerId)}
          newScopes={missingScopes}
          serviceId={serviceId}
        />
      )}
    </div>
  )
}

interface SyncHistoryProps {
  logs: SyncLogData[]
  isLoading: boolean
}

function SyncHistory({ logs, isLoading }: SyncHistoryProps) {
  if (isLoading) {
    return (
      <div className='flex items-center gap-2 py-1 text-[var(--text-muted)] text-xs'>
        <Loader2 className='h-3 w-3 animate-spin' />
        Loading sync history...
      </div>
    )
  }

  if (logs.length === 0) {
    return <p className='py-1 text-[var(--text-muted)] text-xs'>No sync history yet.</p>
  }

  return (
    <div className='flex flex-col gap-1.5'>
      {logs.map((log) => {
        const isError = log.status === 'error' || log.status === 'failed'
        const isRunning = log.status === 'running' || log.status === 'syncing'
        const totalChanges =
          log.docsAdded + log.docsUpdated + log.docsDeleted + (log.docsFailed ?? 0)

        return (
          <div key={log.id} className='flex items-start gap-2 text-xs'>
            <div className='mt-[1px] flex-shrink-0'>
              {isRunning ? (
                <Loader2 className='h-3 w-3 animate-spin text-[var(--text-muted)]' />
              ) : isError ? (
                <XCircle className='h-3 w-3 text-[var(--text-error)]' />
              ) : (
                <CheckCircle2 className='h-3 w-3 text-[var(--color-green-600)]' />
              )}
            </div>

            <div className='flex min-w-0 flex-1 flex-col gap-[1px]'>
              <div className='flex items-center gap-1.5'>
                <span className='text-[var(--text-muted)]'>
                  {format(new Date(log.startedAt), 'MMM d, h:mm a')}
                </span>
                {!isRunning && !isError && (
                  <span className='text-[var(--text-muted)]'>
                    {totalChanges > 0 ? (
                      <>
                        {log.docsAdded > 0 && (
                          <span className='text-[var(--color-green-600)]'>+{log.docsAdded}</span>
                        )}
                        {log.docsUpdated > 0 && (
                          <>
                            {log.docsAdded > 0 && ' '}
                            <span className='text-[var(--color-amber-600)]'>
                              ~{log.docsUpdated}
                            </span>
                          </>
                        )}
                        {log.docsDeleted > 0 && (
                          <>
                            {(log.docsAdded > 0 || log.docsUpdated > 0) && ' '}
                            <span className='text-[var(--text-error)]'>-{log.docsDeleted}</span>
                          </>
                        )}
                        {log.docsFailed > 0 && (
                          <>
                            {(log.docsAdded > 0 || log.docsUpdated > 0 || log.docsDeleted > 0) &&
                              ' '}
                            <span className='text-[var(--text-error)]'>!{log.docsFailed}</span>
                          </>
                        )}
                      </>
                    ) : (
                      'No changes'
                    )}
                  </span>
                )}
                {isRunning && <span className='text-[var(--text-muted)]'>In progress...</span>}
              </div>

              {isError && log.errorMessage && (
                <span className='truncate text-[var(--text-error)]'>{log.errorMessage}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
