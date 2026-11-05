'use client'

import { useState } from 'react'
import { formatDateTime } from '@sim/utils/formatting'
import Link from 'next/link'
import { isOrganizationSettingsSectionAvailable } from '@/components/settings/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { serializeSsoSettings } from '@/ee/sso/search-params'
import styles from '@/platform/app/(shell)/people/_components/directory-sync/directory-sync.module.css'
import { canUseProvisioning } from '@/platform/app/(shell)/people/_components/import/import-modal'
import {
  Button,
  FailureNotice,
  InlineNotice,
  Modal,
  PropertyList,
  SecretField,
  SelectField,
  StatusTag,
  TextField,
} from '@/platform/design-system/components'
import {
  type SyncDraft,
  type SyncFieldErrors,
  type SyncSource,
  type SyncStatus,
  useDirectorySync,
  useProvisioningConnection,
} from '@/platform/lib/data/people'

const SOURCE_NAMES: Record<SyncSource, string> = {
  okta: 'Okta',
  entra: 'Microsoft Entra ID',
  scim: 'SCIM provisioning',
}
const SOURCE_HINTS: Record<SyncSource, string> = {
  okta: 'Connect with an API token',
  entra: 'Connect with an app registration',
  scim: 'Use your active provisioning connection',
}
const STATES = {
  scheduled: { label: 'Connected', intent: 'success' },
  syncing: { label: 'Syncing', intent: 'warning' },
  queued: { label: 'Queued', intent: 'warning' },
  failed: { label: 'Sync failed', intent: 'danger' },
  paused: { label: 'Paused', intent: 'warning' },
} as const
const PHASE_LABELS = {
  users: 'Reading people',
  relationships: 'Reading reporting lines',
  publish: 'Validating and publishing',
} as const

function syncTag(sync: SyncStatus) {
  if (sync.state !== 'paused' && sync.retryBlocked && sync.state !== 'syncing')
    return { label: 'Waiting to retry', intent: 'warning' as const }
  if (sync.progress && sync.state === 'queued')
    return { label: 'Refresh in progress', intent: 'info' as const }
  return STATES[sync.state]
}

function formatInstant(value: string | null): string {
  return value ? formatDateTime(new Date(value)) : '—'
}

function syncLabel(sync: SyncStatus, syncing: boolean): string {
  if (sync.state === 'paused') return 'Sync paused'
  if (syncing) return 'Syncing…'
  if (sync.retryBlocked) return 'Waiting to retry'
  if (sync.state === 'failed') return 'Retry sync'
  return sync.progress ? 'Continue sync' : 'Sync now'
}

interface SyncDetailsProps {
  sync: SyncStatus
}

function SyncDetails({ sync }: SyncDetailsProps) {
  const paused = sync.state === 'paused'
  const tag = syncTag(sync)
  return (
    <>
      <div className={styles.connection}>
        <span data-type='T060'>
          {SOURCE_NAMES[sync.source]}
          {sync.domain && ` · ${sync.domain}`}
        </span>
        <StatusTag label={tag.label} intent={tag.intent} live />
      </div>
      {sync.progress && !paused && (
        <div className={styles.progress} aria-live='polite'>
          <p data-type='T060'>
            {PHASE_LABELS[sync.progress.phase]} · {sync.progress.usersRead.toLocaleString()} users
            read
          </p>
          <p className={styles.secondary} data-type='T060'>
            The chart updates after the full directory has been validated.
          </p>
        </div>
      )}
      <PropertyList
        title='Activity'
        properties={[
          {
            id: 'attempt',
            label: 'Last attempted',
            kind: 'text',
            value: formatInstant(sync.lastAttemptAt),
          },
          {
            id: 'success',
            label: 'Last successful sync',
            kind: 'text',
            value: formatInstant(sync.lastSuccessAt),
          },
          ...(sync.lastFailedAt
            ? [
                {
                  id: 'failed',
                  label: 'Last failed sync',
                  kind: 'text' as const,
                  value: formatInstant(sync.lastFailedAt),
                },
              ]
            : []),
          ...(paused
            ? []
            : [
                sync.retryAt
                  ? {
                      id: 'next',
                      label: 'Next retry',
                      kind: 'text' as const,
                      value: formatInstant(sync.retryAt),
                    }
                  : {
                      id: 'next',
                      label: 'Next scheduled sync',
                      kind: 'text' as const,
                      value: formatInstant(sync.nextSyncAt),
                    },
              ]),
        ]}
      />
      {sync.lastError &&
        (paused ? (
          <p className={styles.secondary} data-type='T060'>
            Last sync error: {sync.lastError}
          </p>
        ) : (
          <InlineNotice intent='danger' message={sync.lastError} />
        ))}
    </>
  )
}

interface ConnectFieldsProps {
  source: SyncSource
  draft: SyncDraft
  onChange: (change: Partial<SyncDraft>) => void
  errors: SyncFieldErrors
  current: SyncStatus | null
  disabled: boolean
}

function ConnectFields({ source, draft, onChange, errors, current, disabled }: ConnectFieldsProps) {
  if (source === 'okta')
    return (
      <>
        <p className={styles.secondary} data-type='T060'>
          Use an Okta API token with permission to list users in your organization.
        </p>
        <TextField
          label='Okta domain'
          placeholder='company.okta.com'
          autoComplete='off'
          value={draft.domain}
          error={errors.domain}
          disabled={disabled || Boolean(current?.domain)}
          onChange={(domain) => onChange({ domain })}
        />
        <SecretField
          label='API token'
          value={draft.token}
          error={errors.token}
          disabled={disabled}
          onChange={(token) => onChange({ token })}
        />
        <div>
          <Button
            variant='quiet'
            size='compact'
            render={
              <Link
                href='https://developer.okta.com/docs/guides/create-an-api-token/main/'
                target='_blank'
                rel='noreferrer'
              />
            }
          >
            Create an Okta API token
          </Button>
        </div>
      </>
    )
  if (source === 'entra')
    return (
      <>
        <p className={styles.secondary} data-type='T060'>
          Register an app in your Microsoft Entra tenant and grant administrator consent for the
          Microsoft Graph User.Read.All application permission. Use the client secret value.
        </p>
        <TextField
          label='Tenant ID'
          placeholder='Directory (tenant) ID'
          autoComplete='off'
          value={draft.tenantId}
          error={errors.tenantId}
          disabled={disabled || Boolean(current?.tenantId)}
          onChange={(tenantId) => onChange({ tenantId })}
        />
        <TextField
          label='Client ID'
          placeholder='Application (client) ID'
          autoComplete='off'
          value={draft.clientId}
          error={errors.clientId}
          disabled={disabled}
          onChange={(clientId) => onChange({ clientId })}
        />
        <SecretField
          label='Client secret'
          placeholder='Client secret value'
          value={draft.clientSecret}
          error={errors.clientSecret}
          disabled={disabled}
          onChange={(clientSecret) => onChange({ clientSecret })}
        />
        <div>
          <Button
            variant='quiet'
            size='compact'
            render={
              <Link
                href='https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app'
                target='_blank'
                rel='noreferrer'
              />
            }
          >
            Register an application
          </Button>
        </div>
      </>
    )
  return null
}

interface DirectorySyncModalProps {
  organization: OrganizationSurfaceContext
  onClose: () => void
}

type SyncMode = 'details' | 'update' | 'disconnect'

const EMPTY_DRAFT: SyncDraft = {
  source: 'okta',
  domain: '',
  token: '',
  tenantId: '',
  clientId: '',
  clientSecret: '',
}

/**
 * Status, connect, update and disconnect in one dialog. A sync can outlast this dialog, so nothing
 * here holds it open as pending: the actions report through the hook's state, and the viewer can
 * close and come back for the result, which the status polling then shows.
 */
export function DirectorySyncModal({ organization, onClose }: DirectorySyncModalProps) {
  const organizationId = organization.organization.id
  const provisionable = canUseProvisioning(organization)
  const directory = useDirectorySync(organizationId)
  const { sync } = directory
  const [mode, setMode] = useState<SyncMode>('details')
  const [connectSource, setConnectSource] = useState<SyncSource>('okta')
  const [draft, setDraft] = useState<SyncDraft>(EMPTY_DRAFT)
  const [fieldErrors, setFieldErrors] = useState<SyncFieldErrors>({})
  const source = mode === 'update' && sync ? sync.source : connectSource
  const connecting = !sync || mode === 'update'
  const provisioning = useProvisioningConnection(organizationId, connecting && source === 'scim')
  const change = (next: Partial<SyncDraft>) => setDraft((current) => ({ ...current, ...next }))
  /** Every way out of the form forgets what it held, so a secret never outlives its form. */
  const backToDetails = () => {
    setMode('details')
    setDraft(EMPTY_DRAFT)
    setFieldErrors({})
    directory.reset()
  }
  const startUpdate = () => {
    if (!sync) return
    directory.reset()
    change({
      domain: sync.domain ?? '',
      tenantId: sync.tenantId ?? '',
      clientId: sync.clientId ?? '',
      token: '',
      clientSecret: '',
    })
    setMode('update')
  }
  const canConnect =
    source === 'scim'
      ? provisioning.ready
      : source === 'okta'
        ? Boolean(draft.token.trim() && draft.domain.trim())
        : Boolean(draft.clientSecret.trim() && draft.tenantId.trim() && draft.clientId.trim())
  const syncing = sync?.state === 'syncing' || directory.pending
  /** While a request runs the footer stays Cancel: closing is safe, resetting it mid-flight is not. */
  const steppedBack = mode !== 'details' && Boolean(sync) && !directory.pending

  const { title, label, disabled, destructive, confirm } = ((): {
    title: string
    label: string
    disabled: boolean
    destructive?: boolean
    confirm: () => void
  } => {
    if (mode === 'disconnect' && sync)
      return {
        title: 'Disconnect directory',
        label: directory.pending ? 'Disconnecting…' : 'Disconnect',
        disabled: directory.pending,
        destructive: true,
        confirm: () => directory.disconnect(backToDetails),
      }
    if (connecting)
      return {
        title: sync
          ? `Update ${SOURCE_NAMES[source]} credentials`
          : directory.loaded
            ? `Connect ${SOURCE_NAMES[source]}`
            : 'Directory sync',
        label: directory.pending ? 'Syncing…' : sync ? 'Save and sync' : 'Connect and sync',
        disabled: directory.pending || !directory.loaded || !canConnect,
        confirm: () => {
          const errors = directory.connect({ ...draft, source }, backToDetails)
          setFieldErrors(errors ?? {})
        },
      }
    return {
      title: 'Directory sync',
      label: syncLabel(sync, syncing),
      disabled: sync.state === 'paused' || syncing || sync.retryBlocked,
      confirm: directory.run,
    }
  })()

  return (
    <Modal
      open
      onOpenChange={onClose}
      title={title}
      confirmLabel={label}
      confirmDisabled={disabled}
      destructive={destructive}
      onBack={steppedBack ? backToDetails : undefined}
      onConfirm={() => {
        confirm()
        return false
      }}
    >
      {directory.loading ? (
        <p role='status' data-type='T060'>
          Loading directory connection…
        </p>
      ) : directory.loadError ? (
        <FailureNotice
          message={directory.loadError.message}
          retrying={directory.fetching}
          onRetry={directory.retry}
          retryLabel='Retry connection'
        />
      ) : mode === 'disconnect' && sync ? (
        <>
          <p data-type='T060'>
            Disconnecting removes the profile details and reporting lines supplied by this
            directory. Sim keeps organization memberships and manually recorded profiles.
          </p>
        </>
      ) : connecting ? (
        <>
          {!sync && (
            <>
              <p className={styles.secondary} data-type='T060'>
                Connect a directory to keep profiles and reporting lines up to date.
              </p>
              <SelectField
                label='Source'
                options={(Object.keys(SOURCE_NAMES) as SyncSource[])
                  .filter((key) => key !== 'scim' || provisionable)
                  .map((key) => ({ value: key, label: SOURCE_NAMES[key] }))}
                value={connectSource}
                hint={SOURCE_HINTS[connectSource]}
                disabled={directory.pending}
                onValueChange={(next) => {
                  setConnectSource(next as SyncSource)
                  setFieldErrors({})
                }}
              />
            </>
          )}
          <ConnectFields
            source={source}
            draft={draft}
            onChange={change}
            errors={fieldErrors}
            current={sync}
            disabled={directory.pending}
          />
          {source === 'scim' && (
            <div className={styles.progress} aria-live='polite'>
              <p data-type='T060'>
                {provisioning.loading
                  ? 'Checking provisioning…'
                  : provisioning.failed
                    ? 'Could not read the provisioning connection.'
                    : provisioning.ready
                      ? 'Active'
                      : 'Enable provisioning before connecting this source.'}
              </p>
              <div className={styles.actions}>
                {isOrganizationSettingsSectionAvailable('sso', organization.settingsFeatures) && (
                  <Button
                    variant='quiet'
                    size='compact'
                    render={
                      <Link
                        href={serializeSsoSettings(
                          organizationRoutes(organizationId).settingsSection('sso'),
                          { tab: 'provisioning' }
                        )}
                      />
                    }
                  >
                    Manage provisioning
                  </Button>
                )}
                {!provisioning.fetching && !provisioning.ready && (
                  <Button variant='quiet' size='compact' onClick={provisioning.refresh}>
                    Check again
                  </Button>
                )}
              </div>
            </div>
          )}
          {source !== 'scim' && (
            <p className={styles.secondary} data-type='T060'>
              Sim stores these credentials encrypted for scheduled syncs.
            </p>
          )}
          {directory.pending && (
            <p className={styles.secondary} data-type='T060'>
              Sync is running. You can close this window and return for the result.
            </p>
          )}
        </>
      ) : (
        sync && (
          <>
            <p className={styles.secondary} data-type='T060'>
              {sync.state === 'paused'
                ? 'SCIM provisioning is disabled. Re-enable it in organization settings to resume updates. Your last published chart remains available.'
                : 'People updates from this directory automatically. You can also start a sync now.'}
            </p>
            <SyncDetails sync={sync} />
            <div className={styles.actions}>
              {sync.source !== 'scim' && (
                <Button size='compact' disabled={syncing} onClick={startUpdate}>
                  Update credentials
                </Button>
              )}
              <Button
                size='compact'
                disabled={directory.pending}
                onClick={() => {
                  directory.reset()
                  setMode('disconnect')
                }}
              >
                Disconnect
              </Button>
            </div>
            {directory.running && sync.state !== 'paused' && (
              <p className={styles.secondary} data-type='T060'>
                Sync is running. You can close this window and return for the result.
              </p>
            )}
          </>
        )
      )}
      {directory.actionError && (
        <InlineNotice intent='danger' message={directory.actionError.message} />
      )}
    </Modal>
  )
}
