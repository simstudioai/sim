import { useState } from 'react'
import {
  Badge,
  Chip,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import type { PeopleSyncConfig, PeopleSyncStatus } from '@/lib/api/contracts/people-sync'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { DirectorySyncForm } from '@/app/o/[organizationId]/people/directory-sync-form'
import { IMPORT_SOURCES } from '@/app/o/[organizationId]/people/import-source'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  isDirectorySyncAccessError,
  usePeopleSyncActions,
  usePeopleSyncStatus,
} from '@/hooks/queries/people-sync'

const SOURCES = {
  okta: IMPORT_SOURCES.okta,
  entra: IMPORT_SOURCES.entra,
  scim: IMPORT_SOURCES.directory,
} as const
const STATES = {
  scheduled: { label: 'Connected', variant: 'green' },
  syncing: { label: 'Syncing', variant: 'amber' },
  queued: { label: 'Queued', variant: 'amber' },
  failed: { label: 'Sync failed', variant: 'red' },
  paused: { label: 'Paused', variant: 'orange' },
} as const
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const PHASE_LABELS = {
  users: 'Reading people',
  relationships: 'Reading reporting lines',
  publish: 'Validating and publishing',
} as const

interface DirectorySyncModalProps {
  organizationId: string
  onClose: () => void
}

interface SyncStatusProps {
  sync: PeopleSyncStatus
}
function SyncStatus({ sync }: SyncStatusProps) {
  const paused = sync.state === 'paused'
  const { label, variant } =
    !paused && sync.retryBlocked && sync.state !== 'syncing'
      ? { label: 'Waiting to retry', variant: 'amber' as const }
      : sync.progress && sync.state === 'queued'
        ? { label: 'Refresh in progress', variant: 'blue' as const }
        : STATES[sync.state]
  const { progress } = sync
  const dates = [
    ['Last attempted', sync.lastAttemptAt],
    ['Last successful sync', sync.lastSuccessAt],
    ...(sync.lastFailedAt ? [['Last failed sync', sync.lastFailedAt]] : []),
    ...(!paused
      ? [sync.retryAt ? ['Next retry', sync.retryAt] : ['Next scheduled sync', sync.nextSyncAt]]
      : []),
  ] as const
  return (
    <>
      <ChipModalField type='custom' title='Connection'>
        {() => (
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='min-w-0 break-words text-[var(--text-body)] text-small'>
              {SOURCES[sync.source].name}
              {sync.domain && ` · ${sync.domain}`}
            </span>
            <span aria-live='polite'>
              <Badge variant={variant} dot>
                {label}
              </Badge>
            </span>
          </div>
        )}
      </ChipModalField>
      {progress && !paused && (
        <ChipModalField type='custom' title='Current refresh'>
          {() => (
            <div aria-live='polite' className='flex flex-col gap-1 text-small'>
              <p className='text-[var(--text-body)]'>
                {PHASE_LABELS[progress.phase]} · {progress.usersRead.toLocaleString()} users read
              </p>
              <p className='text-[var(--text-muted)]'>
                The chart updates after the full directory has been validated.
              </p>
            </div>
          )}
        </ChipModalField>
      )}
      <ChipModalField type='custom' title='Activity'>
        {() => (
          <dl className='flex flex-col gap-2 text-small'>
            {dates.map(([label, value]) => (
              <div className='flex flex-wrap justify-between gap-x-3 gap-y-1' key={label}>
                <dt className='text-[var(--text-muted)]'>{label}</dt>
                <dd className='text-[var(--text-body)]'>
                  {value ? <time dateTime={value}>{dateFormat.format(new Date(value))}</time> : '—'}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </ChipModalField>
      {sync.lastError &&
        (paused ? (
          <ChipModalDescription>Last sync error: {sync.lastError}</ChipModalDescription>
        ) : (
          <ChipModalError>{sync.lastError}</ChipModalError>
        ))}
    </>
  )
}

export function DirectorySyncModal({ organizationId, onClose }: DirectorySyncModalProps) {
  const { settingsFeatures } = useOrganizationContext()
  const { features, hosted } = useDeploymentShape()
  const canProvision = features.scim && (!hosted || settingsFeatures.hasEnterprisePlan)
  const query = usePeopleSyncStatus(organizationId)
  const actions = usePeopleSyncActions(organizationId)
  const [mode, setMode] = useState<PeopleSyncConfig['source'] | 'disconnect' | null>(null)
  const status = isDirectorySyncAccessError(query.error) ? undefined : query.data
  const sync = status?.sync ?? null
  const activeMode = status ? mode : null
  const goBack = () => {
    setMode(null)
    actions.reset()
  }
  if (activeMode === 'disconnect')
    return (
      <ChipConfirmModal
        open
        onOpenChange={(open) => !open && goBack()}
        title='Disconnect directory'
        text='Disconnecting removes the profile details and reporting lines supplied by this directory. Sim keeps organization memberships and manually recorded profiles.'
        confirm={{
          label: 'Disconnect',
          pending: actions.pending,
          pendingLabel: 'Disconnecting…',
          onClick: () => actions.disconnect(goBack),
        }}
      >
        <ChipModalError>{actions.error?.message}</ChipModalError>
      </ChipConfirmModal>
    )
  if (activeMode)
    return (
      <DirectorySyncForm
        key={activeMode}
        organizationId={organizationId}
        source={activeMode}
        name={SOURCES[activeMode].name}
        current={sync}
        actions={actions}
        onBack={goBack}
        onClose={onClose}
      />
    )
  const title = 'Directory sync'
  const syncing = sync?.state === 'syncing' || actions.pending
  const paused = sync?.state === 'paused'
  const waitingToRetry = Boolean(sync?.retryBlocked)
  return (
    <ChipModal open onOpenChange={(open) => !open && onClose()} srTitle={title}>
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        {query.isPending ? (
          <ChipModalDescription>Loading directory connection…</ChipModalDescription>
        ) : query.isError && !status ? (
          <>
            <ChipModalError>{query.error.message}</ChipModalError>
            <div className='px-2'>
              <Chip disabled={query.isFetching} onClick={() => void query.refetch()}>
                Retry connection
              </Chip>
            </div>
          </>
        ) : sync ? (
          <>
            <ChipModalDescription>
              {paused
                ? 'SCIM provisioning is disabled. Re-enable it in organization settings to resume updates. Your last published chart remains available.'
                : 'People updates from this directory automatically. You can also start a sync now.'}
            </ChipModalDescription>
            <SyncStatus sync={sync} />
            <div className='flex flex-wrap gap-1 px-2'>
              {sync.source !== 'scim' && (
                <Chip
                  disabled={syncing}
                  onClick={() => {
                    actions.reset()
                    setMode(sync.source)
                  }}
                >
                  Update credentials
                </Chip>
              )}
              <Chip
                disabled={actions.pending}
                onClick={() => {
                  actions.reset()
                  setMode('disconnect')
                }}
              >
                Disconnect
              </Chip>
            </div>
            {actions.action === 'run' && !paused && (
              <ChipModalDescription>
                Sync is running. You can close this window and return for the result.
              </ChipModalDescription>
            )}
            <ChipModalError>{actions.error?.message}</ChipModalError>
          </>
        ) : (
          <>
            <ChipModalDescription>
              Connect a directory to keep profiles and reporting lines up to date.
            </ChipModalDescription>
            <ChipModalField type='custom' title='Source'>
              {() => (
                <div className={RESOURCE_LIST_STACK}>
                  {(['okta', 'entra', 'scim'] as const).map((source) => {
                    if (source === 'scim' && !canProvision) return null
                    const { name, icon: Icon } = SOURCES[source]
                    return (
                      <SettingsResourceRow
                        key={source}
                        title={name}
                        description={
                          source === 'okta'
                            ? 'Connect with an API token'
                            : source === 'entra'
                              ? 'Connect with an app registration'
                              : 'Use your active provisioning connection'
                        }
                        icon={<Icon aria-hidden />}
                        clickLabel={`Connect ${name}`}
                        onClick={() => setMode(source)}
                        navigable
                      />
                    )
                  })}
                </div>
              )}
            </ChipModalField>
          </>
        )}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        cancelLabel='Close'
        defaultAction='none'
        primaryAction={
          sync
            ? {
                label: paused
                  ? 'Sync paused'
                  : syncing
                    ? 'Syncing…'
                    : waitingToRetry
                      ? 'Waiting to retry'
                      : sync.state === 'failed'
                        ? 'Retry sync'
                        : sync.progress
                          ? 'Continue sync'
                          : 'Sync now',
                disabled: paused || syncing || waitingToRetry,
                onClick: actions.run,
              }
            : undefined
        }
      />
    </ChipModal>
  )
}
