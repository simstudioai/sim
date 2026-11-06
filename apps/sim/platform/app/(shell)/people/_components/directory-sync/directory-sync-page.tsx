'use client'

import { useState } from 'react'
import { formatDateTime } from '@sim/utils/formatting'
import {
  DirectorySources,
  ImportPrompt,
  SOURCE_MARKS,
} from '@/platform/app/(shell)/people/_components/directory-sync/directory-sources'
import styles from '@/platform/app/(shell)/people/_components/directory-sync/directory-sync.module.css'
import { PeopleStatus } from '@/platform/app/(shell)/people/_components/people-page/people-status'
import {
  Button,
  FailureNotice,
  InlineNotice,
  Modal,
  PageColumn,
  StatusTag,
} from '@/platform/design-system/components'
import {
  SYNC_SOURCE_NAMES,
  type SyncSource,
  type SyncStatus,
  useDirectorySync,
  usePeopleViewer,
} from '@/platform/lib/data/people'

const PHASE_TITLES = {
  users: 'Reading people',
  relationships: 'Reading reporting lines',
  publish: 'Validating and publishing',
} as const

type SyncIntent = 'info' | 'success' | 'warning' | 'danger'

/** What the card says about a connection: a heading for its state, and its tag. */
function describeSync(sync: SyncStatus): { title: string; tag: string; intent: SyncIntent } {
  if (sync.state === 'paused')
    return { title: 'SCIM provisioning is disabled', tag: 'Paused', intent: 'warning' }
  if (sync.retryBlocked && sync.state !== 'syncing')
    return {
      title: `${SYNC_SOURCE_NAMES[sync.source]} asked us to slow down`,
      tag: 'Waiting to retry',
      intent: 'warning',
    }
  if (sync.state === 'failed')
    return { title: 'Couldn’t refresh the directory', tag: 'Sync failed', intent: 'danger' }
  if (sync.progress?.phase === 'publish')
    return { title: 'Finishing your refresh', tag: 'Publishing', intent: 'info' }
  if (sync.state === 'syncing')
    return {
      title: sync.lastSuccessAt ? 'Refreshing your directory' : 'Reading your directory',
      tag: sync.lastSuccessAt ? 'Syncing' : 'First sync',
      intent: 'info',
    }
  if (sync.state === 'queued')
    return {
      title: sync.progress ? 'Refresh in progress' : 'Sync queued',
      tag: sync.progress ? 'Refresh in progress' : 'Queued',
      intent: 'info',
    }
  return { title: 'Directory is up to date', tag: 'Connected', intent: 'success' }
}

function syncActionLabel(sync: SyncStatus, syncing: boolean): string {
  if (sync.state === 'paused') return 'Sync paused'
  if (syncing) return 'Sync in progress'
  if (sync.retryBlocked) return 'Waiting to retry'
  if (sync.state === 'failed') return 'Retry sync'
  return sync.progress ? 'Continue sync' : 'Sync now'
}

function formatInstant(value: string | null): string {
  return value ? formatDateTime(new Date(value)) : '—'
}

interface SyncCardProps {
  sync: SyncStatus
  syncing: boolean
  running: boolean
  onUpdate: () => void
  onRun: () => void
}

function SyncCard({ sync, syncing, running, onUpdate, onRun }: SyncCardProps) {
  const paused = sync.state === 'paused'
  const { title, tag, intent } = describeSync(sync)
  const { progress } = sync
  const facts: [label: string, value: string | null][] = [
    ['Last successful sync', sync.lastSuccessAt],
    [syncing ? 'Current attempt started' : 'Last attempted', sync.lastAttemptAt],
  ]
  if (sync.lastFailedAt) facts.push(['Last failed sync', sync.lastFailedAt])
  if (!paused)
    facts.push(
      sync.retryAt ? ['Next retry', sync.retryAt] : ['Next scheduled sync', sync.nextSyncAt]
    )
  return (
    <section className={styles.card} aria-label='Directory connection'>
      <header className={styles.cardHeader}>
        <span className={styles.mark} aria-hidden='true' data-type='T023'>
          {SOURCE_MARKS[sync.source]}
        </span>
        <span className={styles.sourceCopy}>
          <span data-type='T042'>{SYNC_SOURCE_NAMES[sync.source]}</span>
          {sync.domain && (
            <span className={styles.secondary} data-type='T050'>
              {sync.domain}
            </span>
          )}
        </span>
        <StatusTag label={tag} intent={intent} live />
      </header>
      <div className={styles.summary}>
        <h2 data-type='T042'>{title}</h2>
        {paused && (
          <p className={styles.secondary} data-type='T043'>
            Re-enable provisioning in organization settings to resume. Your last published chart
            remains available.
          </p>
        )}
      </div>
      {progress && !paused && (
        <InlineNotice
          title={PHASE_TITLES[progress.phase]}
          message={
            sync.lastSuccessAt
              ? 'Your current chart stays available until this refresh is complete.'
              : 'Your chart will appear when the first sync finishes.'
          }
          action={
            <span aria-live='polite' data-type='T005'>
              {progress.usersRead.toLocaleString()} read
            </span>
          }
        />
      )}
      {sync.lastError &&
        (paused ? (
          <p className={styles.secondary} data-type='T043'>
            Last sync error: {sync.lastError}
          </p>
        ) : (
          <InlineNotice
            intent='danger'
            message={
              sync.lastSuccessAt
                ? `${sync.lastError} Your last published chart remains available.`
                : sync.lastError
            }
          />
        ))}
      <dl className={styles.facts}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.fact}>
            <dt className={styles.secondary} data-type='T043'>
              {label}
            </dt>
            <dd data-type='T043'>{formatInstant(value)}</dd>
          </div>
        ))}
      </dl>
      {running && !paused && (
        <p className={styles.secondary} data-type='T043'>
          Sync is running. You can leave this page and return for the result.
        </p>
      )}
      <footer className={styles.cardFooter}>
        {sync.source !== 'scim' && (
          <Button disabled={syncing} onClick={onUpdate}>
            Update connection
          </Button>
        )}
        <div className={styles.run}>
          <Button disabled={paused || syncing || sync.retryBlocked} onClick={onRun}>
            {syncActionLabel(sync, syncing)}
          </Button>
        </div>
      </footer>
    </section>
  )
}

interface DirectorySyncPageProps {
  organizationId: string
  onBack: () => void
  onConnect: (source: SyncSource) => void
  onImport: () => void
}

/**
 * The connection's status and its administration. A sync can outlast this page, so nothing here
 * holds it open: the actions report through the hook's state, and status polling shows the result.
 */
export function DirectorySyncPage({
  organizationId,
  onBack,
  onConnect,
  onImport,
}: DirectorySyncPageProps) {
  const { canProvision } = usePeopleViewer()
  const directory = useDirectorySync(organizationId)
  const { sync } = directory
  const [disconnecting, setDisconnecting] = useState(false)
  const syncing = sync?.state === 'syncing' || directory.pending
  return (
    <PageColumn>
      <main className={styles.page}>
        <div className={styles.back}>
          <Button variant='quiet' icon='I093' onClick={onBack}>
            Back to people
          </Button>
        </div>
        <header className={styles.heading}>
          <h1 data-type='T076'>Directory sync</h1>
          <p className={styles.secondary} data-type='T043'>
            Keep people, roles, and reporting lines up to date from your identity provider.
          </p>
        </header>
        {directory.loading ? (
          <PeopleStatus>Loading directory connection…</PeopleStatus>
        ) : directory.loadError ? (
          <FailureNotice
            message={directory.loadError.message}
            retrying={directory.fetching}
            onRetry={directory.retry}
          />
        ) : sync ? (
          <div className={styles.columns}>
            <div className={styles.main}>
              <SyncCard
                sync={sync}
                syncing={syncing}
                running={directory.running}
                onUpdate={() => {
                  directory.reset()
                  onConnect(sync.source)
                }}
                onRun={directory.run}
              />
              {directory.actionError && !disconnecting && (
                <InlineNotice intent='danger' message={directory.actionError.message} />
              )}
              <section className={styles.disconnect} aria-labelledby='directory-disconnect'>
                <h2 id='directory-disconnect' data-type='T042'>
                  Disconnect directory
                </h2>
                <p className={styles.secondary} data-type='T043'>
                  Remove synced profiles and reporting lines. Existing Sim memberships stay
                  unchanged.
                </p>
                <div>
                  <Button
                    variant='destructive'
                    disabled={directory.pending}
                    onClick={() => {
                      directory.reset()
                      setDisconnecting(true)
                    }}
                  >
                    {`Disconnect ${SYNC_SOURCE_NAMES[sync.source]}`}
                  </Button>
                </div>
              </section>
            </div>
            <aside className={styles.notes}>
              <div className={styles.note}>
                <h2 data-type='T042'>One directory for your organization</h2>
                <p className={styles.secondary} data-type='T043'>
                  Names, titles, departments, locations, and managers come from{' '}
                  {SYNC_SOURCE_NAMES[sync.source]}. Update these details at the source.
                </p>
              </div>
              <div className={styles.note}>
                <h2 data-type='T042'>Include everyone</h2>
                <p className={styles.secondary} data-type='T043'>
                  People can appear before they have a Sim account. Directory sync does not grant
                  access or assign a seat.
                </p>
              </div>
            </aside>
            {disconnecting && (
              <Modal
                open
                onOpenChange={() => setDisconnecting(false)}
                title='Disconnect directory'
                confirmLabel='Disconnect'
                destructive
                onConfirm={directory.disconnect}
              >
                <p data-type='T060'>
                  Disconnecting removes the profile details and reporting lines supplied by this
                  directory. Sim keeps organization memberships and manually recorded profiles.
                </p>
              </Modal>
            )}
          </div>
        ) : (
          <div className={styles.unconnected}>
            <DirectorySources canProvision={canProvision} onConnect={onConnect} />
            <ImportPrompt onImport={onImport} />
          </div>
        )}
      </main>
    </PageColumn>
  )
}
