'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import {
  Badge,
  Checkbox,
  Chip,
  ChipConfirmModal,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  OverflowText,
  Tooltip,
} from '@sim/emcn'
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleX,
  Loader,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Trash,
  TriangleAlert,
  Users,
} from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { consumeOAuthReturnContext, writeOAuthReturnContext } from '@/lib/credentials/client-state'
import {
  CONNECTOR_SYNC_STALE_LOCK_TTL_MS,
  MEMBER_SYNC_STALE_LOCK_TTL_MS,
} from '@/lib/knowledge/connectors/sync-limits'
import type { MemberSyncStatus } from '@/lib/knowledge/types'
import { getCanonicalScopesForProvider, getProviderIdFromServiceId } from '@/lib/oauth'
import { getMissingRequiredScopes } from '@/lib/oauth/utils'
import { describeSearchSource } from '@/lib/sim-search/source-identity'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { EditConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/edit-connector-modal'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type {
  ConnectorData,
  ConnectorMemberSummary,
  MemberSyncLogData,
  SyncLogData,
} from '@/hooks/queries/kb/connectors'
import {
  isConnectorSyncingOrPending,
  useConnectorDetail,
  useDeleteConnector,
  useTriggerSync,
  useUpdateConnector,
} from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'

const logger = createLogger('ConnectorsSection')

interface ConnectorsSectionProps {
  scope?: ResourceScope
  workspaceId?: string
  knowledgeBaseId: string
  isSearchIndex?: boolean
  connectors: ConnectorData[]
  isLoading: boolean
  canEdit: boolean
  className?: string
}

const EMPTY_REQUIRED_SCOPES: string[] = []

const STATUS_CONFIG = {
  active: { label: 'Active', variant: 'green' as const },
  pending: { label: 'Queued', variant: 'blue' as const },
  syncing: { label: 'Syncing', variant: 'amber' as const },
  error: { label: 'Error', variant: 'red' as const },
  paused: { label: 'Paused', variant: 'gray' as const },
  disabled: { label: 'Disabled', variant: 'orange' as const },
} as const

/** Covers exactly the statuses {@link isConnectorSyncingOrPending} matches. */
const SYNC_IN_FLIGHT_TOOLTIP = {
  pending: 'Sync queued',
  syncing: 'Sync in progress',
} as const

/** The member engine's own in-flight states, shown when the connector syncs per member. */
const MEMBER_SYNC_IN_FLIGHT_TOOLTIP: Partial<Record<MemberSyncStatus, string>> = {
  pending: 'Member sync queued',
  running: 'Syncing members',
}

/** How each member-engine status reads on the card's badge. */
const MEMBER_SYNC_STATUS_AS_CONNECTOR_STATUS = {
  idle: 'active',
  pending: 'pending',
  running: 'syncing',
  error: 'error',
  disabled: 'disabled',
} as const satisfies Record<MemberSyncStatus, keyof typeof STATUS_CONFIG>

export function ConnectorsSection({
  workspaceId,
  scope: explicitScope,
  knowledgeBaseId,
  isSearchIndex = false,
  connectors,
  isLoading,
  canEdit,
  className,
}: ConnectorsSectionProps) {
  const scope = explicitScope ?? resourceScopeFromOwner({ workspaceId })
  const { mutate: triggerSync } = useTriggerSync()
  const {
    mutate: updateConnector,
    isPending: isUpdatingConnector,
    variables: updatingVariables,
  } = useUpdateConnector()
  const { mutate: deleteConnector, isPending: isDeleting } = useDeleteConnector()
  const deleteDocumentsId = useId()
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteDocuments, setDeleteDocuments] = useState(false)

  const closeDeleteModal = () => {
    setDeleteTarget(null)
    setDeleteDocuments(false)
  }
  const [editingConnector, setEditingConnector] = useState<ConnectorData | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * In-flight state is written optimistically into the connector list, so the
   * row's own `status` is the only thing the UI reads — local id sets would not
   * survive the modal holding them unmounting.
   */
  const handleSync = (connectorId: string, rehydrate = false) => {
    triggerSync(
      { knowledgeBaseId, connectorId, rehydrate },
      {
        onSuccess: () => setError(null),
        onError: (err) => {
          logger.error('Sync trigger failed', { error: err.message })
          setError(err.message)
        },
      }
    )
  }

  const handleTogglePause = (connector: ConnectorData) => {
    updateConnector(
      {
        knowledgeBaseId,
        connectorId: connector.id,
        updates: {
          status:
            connector.status === 'paused' || connector.status === 'disabled' ? 'active' : 'paused',
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

  const deletingMembersConnector =
    connectors.find((connector) => connector.id === deleteTarget)?.accessMode === 'members'

  const handleDeleteConnector = () => {
    if (!deleteTarget) return
    deleteConnector(
      {
        knowledgeBaseId,
        connectorId: deleteTarget,
        /** Documents synced per member have no meaning without their members. */
        deleteDocuments: deleteDocuments || deletingMembersConnector,
      },
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

  if (connectors.length === 0 && !canEdit && !isLoading) return null

  return (
    <div className={cn('mt-4', className)}>
      {error && <p className='mt-2 text-[var(--text-error)] text-caption leading-tight'>{error}</p>}

      {isLoading ? (
        <div className='mt-2' />
      ) : connectors.length === 0 ? (
        <p className='mt-2 text-[var(--text-muted)] text-small'>
          No connected sources yet. Connect an external source to automatically sync documents.
        </p>
      ) : (
        <div className='mt-2 flex flex-col gap-0.5'>
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              scope={scope}
              knowledgeBaseId={knowledgeBaseId}
              canEdit={canEdit}
              isSearchIndex={isSearchIndex}
              /**
               * The optimistic status flip relabels this control Pause -> Resume
               * immediately, so without a guard a second click would send
               * `active` before the first pause settles and resume a connector
               * the user meant to pause. Read from the mutation rather than a
               * local id set: React Query already knows which row is in flight.
               */
              isUpdating={isUpdatingConnector && updatingVariables?.connectorId === connector.id}
              onSync={(rehydrate) => handleSync(connector.id, rehydrate)}
              onTogglePause={() => handleTogglePause(connector)}
              onEdit={() => setEditingConnector(connector)}
              onDelete={() => setDeleteTarget(connector.id)}
            />
          ))}
        </div>
      )}

      {editingConnector && (
        <EditConnectorModal
          scope={scope}
          open={editingConnector !== null}
          onOpenChange={(val) => !val && setEditingConnector(null)}
          knowledgeBaseId={knowledgeBaseId}
          isSearchIndex={isSearchIndex}
          connector={editingConnector}
        />
      )}

      <ChipConfirmModal
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeDeleteModal()
        }}
        srTitle='Remove Connector'
        title='Remove Connector'
        text={
          deletingMembersConnector
            ? 'This will disconnect the source, stop future syncs, and delete the documents it synced per member.'
            : 'This will disconnect the source and stop future syncs. Documents already synced will remain in the knowledge base unless you choose to delete them.'
        }
        confirm={{
          label: 'Remove',
          onClick: handleDeleteConnector,
          pending: isDeleting,
          pendingLabel: 'Removing...',
        }}
      >
        {!deletingMembersConnector && (
          <div className='flex items-center gap-2 px-2'>
            <Checkbox
              id={deleteDocumentsId}
              checked={deleteDocuments}
              onCheckedChange={(checked) => setDeleteDocuments(checked === true)}
            />
            <label
              htmlFor={deleteDocumentsId}
              className='cursor-pointer text-[var(--text-secondary)] text-small'
            >
              Also delete all synced documents
            </label>
          </div>
        )}
      </ChipConfirmModal>
    </div>
  )
}

interface ConnectorCardProps {
  connector: ConnectorData
  scope: ResourceScope
  knowledgeBaseId: string
  canEdit: boolean
  isSearchIndex: boolean
  isUpdating: boolean
  onSync: (rehydrate?: boolean) => void
  onEdit: () => void
  onTogglePause: () => void
  onDelete: () => void
}

function ConnectorCard({
  connector,
  scope,
  knowledgeBaseId,
  canEdit,
  isSearchIndex,
  isUpdating,
  onSync,
  onEdit,
  onTogglePause,
  onDelete,
}: ConnectorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)

  const connectorDef = CONNECTOR_META_REGISTRY[connector.connectorType]
  const docsUrl = isSearchIndex ? connectorDef?.searchDocsUrl : undefined
  const sourceDescription = connectorDef
    ? describeSearchSource(connectorDef, connector.sourceConfig)
    : ''
  const Icon = connectorDef?.icon
  /**
   * A members-mode connector's content status stays `active` while the member
   * engine does the work, so its badge reads the member engine's status. A
   * paused or disabled content status still wins: the user set it.
   */
  const effectiveStatus =
    connector.accessMode === 'members' && connector.status === 'active'
      ? MEMBER_SYNC_STATUS_AS_CONNECTOR_STATUS[connector.memberSyncStatus]
      : connector.status
  const statusConfig =
    STATUS_CONFIG[effectiveStatus as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.active

  const serviceId = connectorDef?.auth.mode === 'oauth' ? connectorDef.auth.provider : undefined
  const providerId = serviceId ? getProviderIdFromServiceId(serviceId) : undefined
  const requiredScopes =
    connectorDef?.auth.mode === 'oauth'
      ? (connectorDef.auth.requiredScopes ?? EMPTY_REQUIRED_SCOPES)
      : EMPTY_REQUIRED_SCOPES

  const {
    data: credentials,
    isFetching: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(providerId, {
    ...resourceScopeFields(scope),
  })

  const selectedCredential = useMemo(() => {
    if (!credentials || !connector.credentialId) return undefined
    return credentials.find((credential) => credential.id === connector.credentialId)
  }, [credentials, connector.credentialId])

  useCredentialRefreshTriggers(
    refetchCredentials,
    selectedCredential?.provider ?? providerId ?? '',
    scope
  )

  const missingScopes = useMemo(
    () => (selectedCredential ? getMissingRequiredScopes(selectedCredential, requiredScopes) : []),
    [selectedCredential, requiredScopes]
  )

  useEffect(() => {
    if (showOAuthModal && connector.credentialId && !selectedCredential && !credentialsLoading) {
      consumeOAuthReturnContext()
      setShowOAuthModal(false)
    }
  }, [showOAuthModal, connector.credentialId, selectedCredential, credentialsLoading])

  const { data: detail, isLoading: detailLoading } = useConnectorDetail(
    expanded ? knowledgeBaseId : undefined,
    expanded ? connector.id : undefined
  )
  const syncLogs = detail?.syncLogs ?? []
  const memberSyncLogs = detail?.memberSyncLogs ?? []
  const members = detail?.members

  const syncsPerMember = connector.accessMode === 'members'
  /** A per-member connector re-hydrates through its members; the content resync has no meaning there. */
  const canFullResync = Boolean(connectorDef?.rehydrateOnFullSync) && !syncsPerMember
  const syncInFlight = isConnectorSyncingOrPending(connector)
  const isPaused = connector.status === 'paused'
  const memberSyncDisabled = syncsPerMember && connector.memberSyncStatus === 'disabled'
  /**
   * A queued sync is what stops a second one being dispatched — the server
   * rejects it as a conflict anyway, so the button reflects that rather than
   * running a client-side cooldown timer alongside it.
   */
  const syncDisabled =
    syncInFlight || connector.status === 'disabled' || isPaused || memberSyncDisabled
  const syncTooltip =
    SYNC_IN_FLIGHT_TOOLTIP[connector.status as keyof typeof SYNC_IN_FLIGHT_TOOLTIP] ??
    (syncsPerMember ? MEMBER_SYNC_IN_FLIGHT_TOOLTIP[connector.memberSyncStatus] : undefined) ??
    (isPaused
      ? 'Resume to sync'
      : memberSyncDisabled
        ? 'Member sync is disabled'
        : canFullResync
          ? 'Sync'
          : syncsPerMember
            ? 'Sync members now'
            : 'Sync now')
  const lastSyncAt = syncsPerMember ? connector.lastMemberSyncAt : connector.lastSyncAt
  const nextSyncAt = syncsPerMember ? connector.nextMemberSyncAt : connector.nextSyncAt
  const lastSyncError = syncsPerMember
    ? (connector.lastMemberSyncError ?? connector.lastSyncError)
    : connector.lastSyncError

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-transparent transition-colors duration-100',
        expanded
          ? 'border-[var(--border-muted)] bg-[var(--surface-2)]'
          : 'hover-hover:bg-[var(--surface-active)]'
      )}
    >
      <div className='flex items-center justify-between gap-2 px-2 py-2'>
        <div className='flex min-w-0 items-center gap-2.5'>
          {Icon && <IntegrationTile blockType={connector.connectorType} icon={Icon} />}
          <div className='flex min-w-0 flex-col gap-0.5'>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='flex min-w-0 items-center gap-1.5 text-[var(--text-primary)] text-small'>
                <OverflowText label={connectorDef?.name || connector.connectorType} />
                {syncInFlight && <Loader className='size-3 text-[var(--text-muted)]' animate />}
              </span>
              <Badge variant={statusConfig.variant} size='sm' dot className='shrink-0'>
                {statusConfig.label}
              </Badge>
              {syncsPerMember && (
                <Badge variant='gray' size='sm' icon={Users} className='shrink-0'>
                  Per member
                </Badge>
              )}
            </div>
            {sourceDescription && (
              <span className='min-w-0 text-[var(--text-muted)] text-xs'>
                <OverflowText label={sourceDescription} />
              </span>
            )}
            <div className='flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[var(--text-muted)] text-xs'>
              {lastSyncAt && (
                <span>Last sync: {format(new Date(lastSyncAt), 'MMM d, h:mm a')}</span>
              )}
              {!syncsPerMember && connector.lastSyncDocCount !== null && (
                <>
                  <span>·</span>
                  <span>{connector.lastSyncDocCount} docs</span>
                </>
              )}
              {nextSyncAt && connector.status === 'active' && !syncInFlight && (
                <>
                  <span>·</span>
                  <span>
                    Next sync:{' '}
                    {isPast(new Date(nextSyncAt))
                      ? 'pending'
                      : formatDistanceToNow(new Date(nextSyncAt), { addSuffix: true })}
                  </span>
                </>
              )}
              {lastSyncError && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <CircleAlert className='size-3 text-[var(--text-error)]' />
                  </Tooltip.Trigger>
                  <Tooltip.Content>{lastSyncError}</Tooltip.Content>
                </Tooltip.Root>
              )}
              {connector.accessRewritePending && (
                <>
                  <span>·</span>
                  <span className='flex items-center gap-1'>
                    <Loader className='size-3' animate />
                    Updating access
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-0.5'>
          {canEdit && (
            <>
              {canFullResync ? (
                <DropdownMenu>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      {/* span keeps the tooltip hoverable while the trigger button is disabled */}
                      <span className='inline-flex'>
                        <DropdownMenuTrigger asChild>
                          <Chip
                            aria-label='Sync options'
                            disabled={syncDisabled}
                            leftIcon={RefreshCw}
                          />
                        </DropdownMenuTrigger>
                      </span>
                    </Tooltip.Trigger>
                    <Tooltip.Content>{syncTooltip}</Tooltip.Content>
                  </Tooltip.Root>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem onSelect={() => onSync(false)}>Sync now</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onSync(true)}>Full resync</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    {/* span keeps the tooltip hoverable while the button is disabled */}
                    <span className='inline-flex'>
                      <Chip
                        aria-label='Sync now'
                        disabled={syncDisabled}
                        onClick={() => onSync(false)}
                        leftIcon={RefreshCw}
                      />
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content>{syncTooltip}</Tooltip.Content>
                </Tooltip.Root>
              )}

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Chip onClick={onEdit} aria-label='Settings' leftIcon={Settings} />
                </Tooltip.Trigger>
                <Tooltip.Content>Settings</Tooltip.Content>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Chip
                    onClick={onTogglePause}
                    disabled={isUpdating}
                    aria-label={
                      connector.status === 'paused' || connector.status === 'disabled'
                        ? 'Resume'
                        : 'Pause'
                    }
                    leftIcon={
                      connector.status === 'paused' || connector.status === 'disabled'
                        ? Play
                        : Pause
                    }
                  />
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {connector.status === 'paused' || connector.status === 'disabled'
                    ? 'Resume'
                    : 'Pause'}
                </Tooltip.Content>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Chip onClick={onDelete} aria-label='Delete' leftIcon={Trash} />
                </Tooltip.Trigger>
                <Tooltip.Content>Delete</Tooltip.Content>
              </Tooltip.Root>
            </>
          )}

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Chip
                onClick={() => setExpanded((prev) => !prev)}
                aria-label={expanded ? 'Hide history' : 'Sync history'}
                aria-expanded={expanded}
                leftIcon={expanded ? ChevronUp : ChevronDown}
              />
            </Tooltip.Trigger>
            <Tooltip.Content>{expanded ? 'Hide history' : 'Sync history'}</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>

      {syncsPerMember && connector.memberSyncStatus === 'disabled' && (
        <div className='border-[var(--border-muted)] border-t px-2 py-2'>
          <div className='flex flex-col gap-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-3)] px-2.5 py-2'>
            <div className='flex items-center gap-1.5 text-[var(--text-primary)] text-caption'>
              <TriangleAlert className='size-3 shrink-0 text-[var(--caution)]' />
              Per-member sync is disabled
            </div>
            <p className='text-[var(--text-muted)] text-caption leading-snug'>
              {connector.lastMemberSyncError ?? 'The connector can no longer sync per member.'}{' '}
              Members keep no access until it is fixed; switch the connector's access to re-enable
              it.
            </p>
          </div>
        </div>
      )}

      {connector.status === 'disabled' && (
        <div className='border-[var(--border-muted)] border-t px-2 py-2'>
          <div className='flex flex-col gap-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-3)] px-2.5 py-2'>
            <div className='flex items-center gap-1.5 text-[var(--text-primary)] text-caption'>
              <TriangleAlert className='size-3 shrink-0 text-[var(--caution)]' />
              Connector disabled after repeated sync failures
            </div>
            <p className='text-[var(--text-muted)] text-caption leading-snug'>
              Syncing has been paused due to {connector.consecutiveFailures} consecutive failures.
              {serviceId
                ? ' Reconnect your account to resume syncing.'
                : ' Use the resume button to re-enable syncing.'}
            </p>
            {canEdit && serviceId && providerId && (
              <Chip
                variant='primary'
                disabled={Boolean(connector.credentialId && !selectedCredential)}
                onClick={() => {
                  if (connector.credentialId) {
                    if (!selectedCredential) return
                    writeOAuthReturnContext({
                      origin: 'kb-connectors',
                      knowledgeBaseId,
                      displayName: connectorDef?.name ?? connector.connectorType,
                      providerId: selectedCredential.provider,
                      preCount: credentials?.length ?? 0,
                      ...resourceScopeFields(scope),
                      reconnect: true,
                      requestedAt: Date.now(),
                    })
                  }
                  setShowOAuthModal(true)
                }}
                fullWidth
              >
                Reconnect
              </Chip>
            )}
          </div>
        </div>
      )}

      {missingScopes.length > 0 && connector.status !== 'disabled' && (
        <div className='border-[var(--border-muted)] border-t px-2 py-2'>
          <div className='flex flex-col gap-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-3)] px-2.5 py-2'>
            <div className='flex items-center text-[var(--text-primary)] text-caption'>
              <span className='mr-1.5 inline-block size-[6px] rounded-xs bg-[var(--caution)]' />
              Additional permissions required
            </div>
            {canEdit && (
              <Chip
                variant='primary'
                onClick={() => {
                  if (connector.credentialId) {
                    if (!selectedCredential) return
                    writeOAuthReturnContext({
                      origin: 'kb-connectors',
                      knowledgeBaseId,
                      displayName: connectorDef?.name ?? connector.connectorType,
                      providerId: selectedCredential.provider,
                      preCount: credentials?.length ?? 0,
                      ...resourceScopeFields(scope),
                      reconnect: true,
                      requestedAt: Date.now(),
                    })
                  }
                  setShowOAuthModal(true)
                }}
                fullWidth
              >
                Update access
              </Chip>
            )}
          </div>
        </div>
      )}

      {expanded && (
        <div className='border-[var(--border-muted)] border-t px-2 py-2'>
          {syncsPerMember ? (
            <MemberSyncHistory logs={memberSyncLogs} members={members} isLoading={detailLoading} />
          ) : (
            <SyncHistory logs={syncLogs} isLoading={detailLoading} />
          )}
        </div>
      )}

      {showOAuthModal && serviceId && providerId && !connector.credentialId && (
        <ConnectOAuthModal
          mode='connect'
          origin='kb-connectors'
          open={showOAuthModal}
          onOpenChange={(open) => {
            if (!open) {
              consumeOAuthReturnContext()
              setShowOAuthModal(false)
            }
          }}
          serviceId={serviceId}
          providerId={providerId}
          docsUrl={docsUrl}
          requiredScopes={getCanonicalScopesForProvider(providerId)}
          {...resourceScopeFields(scope)}
          knowledgeBaseId={knowledgeBaseId}
        />
      )}

      {showOAuthModal &&
        serviceId &&
        providerId &&
        connector.credentialId &&
        selectedCredential && (
          <ConnectOAuthModal
            mode='reauthorize'
            open={showOAuthModal}
            onOpenChange={(open) => {
              if (!open) {
                consumeOAuthReturnContext()
                setShowOAuthModal(false)
              }
            }}
            toolName={connectorDef?.name ?? connector.connectorType}
            requiredScopes={getCanonicalScopesForProvider(providerId)}
            newScopes={missingScopes}
            serviceId={serviceId}
            providerId={selectedCredential.provider}
            docsUrl={docsUrl}
            reconnectTarget={{
              ...resourceScopeFields(scope),
              credentialId: selectedCredential.id,
              displayName: selectedCredential.name,
            }}
          />
        )}
    </div>
  )
}

/**
 * How a sync-log row should read to a user.
 *
 * `interrupted` has no status of its own: the scheduler reclaims a stale
 * `syncing` lock by flipping the *connector* to `error`, and never rewrites the
 * log row, so a run killed mid-flight (deploy, OOM) stays `started` forever.
 * Past the stale-lock TTL that row is a crashed run, not a live one.
 *
 * Treating the TTL as a hard ceiling is a deliberate policy choice, not an
 * assumption that no run can outlive it. The in-process fallback sync runs
 * unawaited in the web process with no duration limit, so it genuinely can —
 * but nothing writes to the row between lock acquisition and completion, so a
 * live run past the TTL and a dead one are byte-identical to this component.
 * Rendering it as still running is the failure this state exists to fix; the
 * same TTL already governs the reclaim that takes its lock away.
 */
type SyncLogState = 'running' | 'interrupted' | 'failed' | 'completed' | 'partial'

function getSyncLogState(log: SyncLogData, now: number): SyncLogState {
  switch (log.status) {
    case 'completed':
      return 'completed'
    case 'partial':
      return 'partial'
    case 'failed':
      return 'failed'
    case 'started': {
      const ageMs = now - new Date(log.startedAt).getTime()
      return ageMs > CONNECTOR_SYNC_STALE_LOCK_TTL_MS ? 'interrupted' : 'running'
    }
    default: {
      const exhaustive: never = log.status
      return exhaustive
    }
  }
}

interface SyncHistoryProps {
  logs: SyncLogData[]
  isLoading: boolean
}

export function SyncHistory({ logs, isLoading }: SyncHistoryProps) {
  if (isLoading) {
    return (
      <div className='flex items-center gap-2 rounded-md bg-[var(--surface-3)] px-2 py-2 text-[var(--text-muted)] text-xs'>
        <Loader className='size-3' animate />
        Loading sync history…
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <p className='rounded-md bg-[var(--surface-3)] px-2 py-2 text-[var(--text-muted)] text-xs'>
        No sync history yet.
      </p>
    )
  }

  const now = Date.now()

  return (
    <div className='flex flex-col gap-0.5'>
      {logs.map((log) => {
        const state = getSyncLogState(log, now)
        const totalChanges =
          log.docsAdded +
          log.docsUpdated +
          log.docsDeleted +
          log.docsSkipped +
          (log.docsFailed ?? 0)

        return (
          <div key={log.id} className='flex items-start gap-2 rounded-md px-2 py-1.5 text-xs'>
            <div className='mt-[1px] shrink-0'>
              {state === 'running' ? (
                <Loader className='size-3 text-[var(--text-muted)]' animate />
              ) : state === 'interrupted' || state === 'partial' ? (
                <TriangleAlert className='size-3 text-[var(--caution)]' />
              ) : state === 'failed' ? (
                <CircleX className='size-3 text-[var(--text-error)]' />
              ) : (
                <CircleCheck className='size-3 text-[var(--success)]' />
              )}
            </div>

            <div className='flex min-w-0 flex-1 flex-col gap-[1px]'>
              <div className='flex items-center gap-1.5'>
                <span className='text-[var(--text-muted)]'>
                  {format(new Date(log.startedAt), 'MMM d, h:mm a')}
                </span>
                {(state === 'completed' || state === 'partial') && (
                  <span className='text-[var(--text-muted)]'>
                    {totalChanges > 0 ? (
                      <>
                        {log.docsAdded > 0 && (
                          <span className='text-[var(--success)]'>+{log.docsAdded}</span>
                        )}
                        {log.docsUpdated > 0 && (
                          <>
                            {log.docsAdded > 0 && ' '}
                            <span className='text-[var(--caution)]'>~{log.docsUpdated}</span>
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
                        {log.docsSkipped > 0 && (
                          <>
                            {(log.docsAdded > 0 ||
                              log.docsUpdated > 0 ||
                              log.docsDeleted > 0 ||
                              log.docsFailed > 0) &&
                              ' '}
                            <span className='text-[var(--caution)]'>⊘{log.docsSkipped}</span>
                          </>
                        )}
                      </>
                    ) : (
                      'No changes'
                    )}
                  </span>
                )}
                {state === 'partial' && <span className='text-[var(--caution)]'>Partial</span>}
                {state === 'running' && (
                  <span className='text-[var(--text-muted)]'>In progress…</span>
                )}
                {state === 'interrupted' && (
                  <span className='text-[var(--caution)]'>Interrupted</span>
                )}
              </div>

              {state === 'failed' && log.errorMessage && (
                <span className='truncate text-[var(--text-error)]'>{log.errorMessage}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function getMemberSyncLogState(log: MemberSyncLogData, now: number): SyncLogState {
  switch (log.status) {
    case 'completed':
      return 'completed'
    case 'partial':
      return 'partial'
    case 'failed':
      return 'failed'
    case 'started': {
      const ageMs = now - new Date(log.startedAt).getTime()
      return ageMs > MEMBER_SYNC_STALE_LOCK_TTL_MS ? 'interrupted' : 'running'
    }
    default: {
      const exhaustive: never = log.status
      return exhaustive
    }
  }
}

interface MemberSyncHistoryProps {
  logs: MemberSyncLogData[]
  members: ConnectorMemberSummary | undefined
  isLoading: boolean
}

/**
 * The per-member run history: who was crawled, what changed, and how the
 * membership stands. A run that ended with members still due re-dispatches
 * itself, so several short rows in a row are one drain, not a fault.
 */
function MemberSyncHistory({ logs, members, isLoading }: MemberSyncHistoryProps) {
  if (isLoading) {
    return (
      <div className='flex items-center gap-2 rounded-md bg-[var(--surface-3)] px-2 py-2 text-[var(--text-muted)] text-xs'>
        <Loader className='size-3' animate />
        Loading member sync history…
      </div>
    )
  }

  const now = Date.now()

  return (
    <div className='flex flex-col gap-1.5'>
      {members && (
        <div className='flex flex-wrap items-center gap-x-1.5 rounded-md bg-[var(--surface-3)] px-2 py-1.5 text-[var(--text-muted)] text-xs'>
          <Users className='size-3' />
          <span>
            {members.active} connected
            {members.suspended > 0 && ` · ${members.suspended} need reconnecting`}
            {members.stale > 0 && ` · ${members.stale} not synced recently`}
          </span>
        </div>
      )}
      {logs.length === 0 ? (
        <p className='rounded-md bg-[var(--surface-3)] px-2 py-2 text-[var(--text-muted)] text-xs'>
          No member sync history yet.
        </p>
      ) : (
        <div className='flex flex-col gap-0.5'>
          {logs.map((log) => {
            const state = getMemberSyncLogState(log, now)
            const changes = log.docsAdded + log.docsUpdated + log.docsTombstoned + log.docsPurged
            return (
              <div key={log.id} className='flex items-start gap-2 rounded-md px-2 py-1.5 text-xs'>
                <div className='mt-[1px] shrink-0'>
                  {state === 'running' ? (
                    <Loader className='size-3 text-[var(--text-muted)]' animate />
                  ) : state === 'interrupted' || state === 'partial' ? (
                    <TriangleAlert className='size-3 text-[var(--caution)]' />
                  ) : state === 'failed' ? (
                    <CircleX className='size-3 text-[var(--text-error)]' />
                  ) : (
                    <CircleCheck className='size-3 text-[var(--success)]' />
                  )}
                </div>
                <div className='flex min-w-0 flex-1 flex-col gap-[1px]'>
                  <div className='flex flex-wrap items-center gap-1.5 text-[var(--text-muted)]'>
                    <span>{format(new Date(log.startedAt), 'MMM d, h:mm a')}</span>
                    {(state === 'completed' || state === 'partial') && (
                      <span>
                        {log.membersCompleted + log.membersIncomplete + log.membersFailed} member
                        {log.membersCompleted + log.membersIncomplete + log.membersFailed === 1
                          ? ''
                          : 's'}
                        {log.membersFailed > 0 && (
                          <span className='text-[var(--text-error)]'>
                            {' '}
                            · {log.membersFailed} failed
                          </span>
                        )}
                        {changes > 0 ? (
                          <>
                            {log.docsAdded > 0 && (
                              <span className='text-[var(--success)]'> +{log.docsAdded}</span>
                            )}
                            {log.docsUpdated > 0 && (
                              <span className='text-[var(--caution)]'> ~{log.docsUpdated}</span>
                            )}
                            {log.docsTombstoned + log.docsPurged > 0 && (
                              <span className='text-[var(--text-error)]'>
                                {' '}
                                -{log.docsTombstoned + log.docsPurged}
                              </span>
                            )}
                          </>
                        ) : (
                          ' · no changes'
                        )}
                      </span>
                    )}
                    {state === 'partial' && <span className='text-[var(--caution)]'>Partial</span>}
                    {state === 'running' && <span>In progress…</span>}
                    {state === 'interrupted' && (
                      <span className='text-[var(--caution)]'>Interrupted</span>
                    )}
                  </div>
                  {state === 'failed' && log.errorMessage && (
                    <span className='truncate text-[var(--text-error)]'>{log.errorMessage}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
