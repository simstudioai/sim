'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { format, formatDistanceToNow } from 'date-fns'
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
  Unplug,
  XCircle,
} from 'lucide-react'
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
import { cn } from '@/lib/core/utils/cn'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  type OAuthProvider,
} from '@/lib/oauth'
import { EditConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/edit-connector-modal'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { CONNECTOR_META } from '@/connectors/icons'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type { ConnectorData, SyncLogData } from '@/hooks/queries/kb/connectors'
import {
  useConnectorDetail,
  useDeleteConnector,
  useTriggerSync,
  useUpdateConnector,
} from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { getMissingRequiredScopes } from '@/hooks/use-oauth-scope-status'

const logger = createLogger('ConnectorsSection')

interface ConnectorsSectionProps {
  knowledgeBaseId: string
  connectors: ConnectorData[]
  isLoading: boolean
  canEdit: boolean
  onAddConnector: () => void
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
  knowledgeBaseId,
  connectors,
  isLoading,
  canEdit,
  onAddConnector,
}: ConnectorsSectionProps) {
  const { mutate: triggerSync, isPending: isSyncing } = useTriggerSync()
  const { mutate: updateConnector } = useUpdateConnector()
  const { mutate: deleteConnector } = useDeleteConnector()
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [editingConnector, setEditingConnector] = useState<ConnectorData | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        }
      )
    },
    [knowledgeBaseId, triggerSync, isSyncOnCooldown]
  )

  if (isLoading) return null
  if (connectors.length === 0 && !canEdit) return null

  return (
    <div className='mt-[16px]'>
      <div className='flex items-center justify-between'>
        <h2 className='font-medium text-[14px] text-[var(--text-secondary)]'>Connected Sources</h2>
        {canEdit && (
          <Button
            variant='default'
            className='h-[28px] rounded-[6px] text-[12px]'
            onClick={onAddConnector}
          >
            <Unplug className='mr-1 h-3.5 w-3.5' />
            Connect Source
          </Button>
        )}
      </div>

      {error && (
        <p className='mt-[8px] text-[12px] text-[var(--text-error)] leading-tight'>{error}</p>
      )}

      {connectors.length === 0 ? (
        <p className='mt-[8px] text-[13px] text-[var(--text-muted)]'>
          No connected sources yet. Connect an external source to automatically sync documents.
        </p>
      ) : (
        <div className='mt-[8px] flex flex-col gap-[8px]'>
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              knowledgeBaseId={knowledgeBaseId}
              canEdit={canEdit}
              isSyncing={isSyncing}
              syncCooldown={isSyncOnCooldown(connector.id)}
              onSync={() => handleSync(connector.id)}
              onTogglePause={() =>
                updateConnector(
                  {
                    knowledgeBaseId,
                    connectorId: connector.id,
                    updates: {
                      status: connector.status === 'paused' ? 'active' : 'paused',
                    },
                  },
                  {
                    onSuccess: () => setError(null),
                    onError: (err) => {
                      logger.error('Toggle pause failed', { error: err.message })
                      setError(err.message)
                    },
                  }
                )
              }
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

      <Modal open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Connector</ModalHeader>
          <ModalBody>
            <p className='text-[14px] text-[var(--text-secondary)]'>
              Are you sure you want to remove this connected source? Documents already synced will
              remain in the knowledge base.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (deleteTarget) {
                  deleteConnector(
                    { knowledgeBaseId, connectorId: deleteTarget },
                    {
                      onSuccess: () => setError(null),
                      onError: (err) => {
                        logger.error('Delete connector failed', { error: err.message })
                        setError(err.message)
                      },
                    }
                  )
                  setDeleteTarget(null)
                }
              }}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

interface ConnectorCardProps {
  connector: ConnectorData
  knowledgeBaseId: string
  canEdit: boolean
  isSyncing: boolean
  syncCooldown: boolean
  onSync: () => void
  onEdit: () => void
  onTogglePause: () => void
  onDelete: () => void
}

function ConnectorCard({
  connector,
  knowledgeBaseId,
  canEdit,
  isSyncing,
  syncCooldown,
  onSync,
  onEdit,
  onTogglePause,
  onDelete,
}: ConnectorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)

  const meta = CONNECTOR_META[connector.connectorType]
  const Icon = meta?.icon
  const statusConfig =
    STATUS_CONFIG[connector.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.active

  const connectorConfig = CONNECTOR_REGISTRY[connector.connectorType]
  const serviceId = connectorConfig?.oauth.provider
  const providerId = serviceId ? getProviderIdFromServiceId(serviceId) : undefined
  const requiredScopes = connectorConfig?.oauth.requiredScopes ?? []

  const { data: credentials } = useOAuthCredentials(providerId)

  const missingScopes = useMemo(() => {
    if (!credentials || !connector.credentialId) return []
    const credential = credentials.find((c) => c.id === connector.credentialId)
    return getMissingRequiredScopes(credential, requiredScopes)
  }, [credentials, connector.credentialId, requiredScopes])

  const { data: detail, isLoading: detailLoading } = useConnectorDetail(
    expanded ? knowledgeBaseId : undefined,
    expanded ? connector.id : undefined
  )
  const syncLogs = detail?.syncLogs ?? []

  return (
    <div className='rounded-[8px] border border-[var(--border-1)]'>
      <div className='flex items-center justify-between px-[12px] py-[10px]'>
        <div className='flex items-center gap-[10px]'>
          {Icon && <Icon className='h-5 w-5 flex-shrink-0' />}
          <div className='flex flex-col gap-[2px]'>
            <div className='flex items-center gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                {meta?.name || connector.connectorType}
              </span>
              <Badge variant={statusConfig.variant} className='text-[10px]'>
                {connector.status === 'syncing' && (
                  <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                )}
                {statusConfig.label}
              </Badge>
            </div>
            <div className='flex items-center gap-[6px] text-[11px] text-[var(--text-muted)]'>
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
                    {formatDistanceToNow(new Date(connector.nextSyncAt), { addSuffix: true })}
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

        <div className='flex items-center gap-[4px]'>
          {canEdit && (
            <>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    className='h-7 w-7 p-0'
                    onClick={onSync}
                    disabled={connector.status === 'syncing' || isSyncing || syncCooldown}
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
                  <Button variant='ghost' className='h-7 w-7 p-0' onClick={onTogglePause}>
                    {connector.status === 'paused' ? (
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
        <div className='border-[var(--border-1)] border-t px-[12px] py-[8px]'>
          <div className='flex flex-col gap-[4px] rounded-[4px] border bg-[var(--surface-2)] px-[8px] py-[6px]'>
            <div className='flex items-center font-medium text-[12px]'>
              <span className='mr-[6px] inline-block h-[6px] w-[6px] rounded-[2px] bg-amber-500' />
              Additional permissions required
            </div>
            {canEdit && (
              <Button
                variant='active'
                onClick={() => setShowOAuthModal(true)}
                className='w-full px-[8px] py-[4px] font-medium text-[12px]'
              >
                Update access
              </Button>
            )}
          </div>
        </div>
      )}

      {expanded && (
        <div className='border-[var(--border-1)] border-t px-[12px] py-[8px]'>
          <SyncHistory logs={syncLogs} isLoading={detailLoading} />
        </div>
      )}

      {showOAuthModal && serviceId && providerId && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={providerId as OAuthProvider}
          toolName={connectorConfig?.name ?? connector.connectorType}
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
      <div className='flex items-center gap-2 py-[4px] text-[11px] text-[var(--text-muted)]'>
        <Loader2 className='h-3 w-3 animate-spin' />
        Loading sync history...
      </div>
    )
  }

  if (logs.length === 0) {
    return <p className='py-[4px] text-[11px] text-[var(--text-muted)]'>No sync history yet.</p>
  }

  return (
    <div className='flex flex-col gap-[6px]'>
      {logs.map((log) => {
        const isError = log.status === 'error' || log.status === 'failed'
        const isRunning = log.status === 'running' || log.status === 'syncing'
        const totalChanges = log.docsAdded + log.docsUpdated + log.docsDeleted

        return (
          <div key={log.id} className='flex items-start gap-[8px] text-[11px]'>
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
              <div className='flex items-center gap-[6px]'>
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
