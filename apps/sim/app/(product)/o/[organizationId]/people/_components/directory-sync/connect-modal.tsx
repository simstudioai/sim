'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import Link from 'next/link'
import styles from '@/app/(product)/o/[organizationId]/people/_components/directory-sync/directory-sync.module.css'
import { ExternalLink } from '@/app/(product)/o/[organizationId]/people/_components/external-link/external-link'
import { usePeopleViewer } from '@/platform/lib/data/people'
import {
  SYNC_SOURCE_NAMES,
  type SyncDraft,
  type SyncFieldErrors,
  type SyncSource,
  useDirectorySync,
  useProvisioningConnection,
} from '@/platform/shared/people'

interface ConnectModalProps {
  organizationId: string
  source: SyncSource
  onClose: () => void
  onConnected: () => void
}

/**
 * Connects a directory, or replaces a connected one's credentials. Credentials stay in this
 * component's state; the action hook keeps them out of the mutation cache. A status poll that fails
 * keeps the draft, and one that says the viewer lost access takes the form away.
 */
export function ConnectModal({ organizationId, source, onClose, onConnected }: ConnectModalProps) {
  const { canOpenProvisioningSettings, provisioningSettingsHref } = usePeopleViewer()
  const directory = useDirectorySync(organizationId)
  const { sync } = directory
  const current = sync?.source === source ? sync : null
  const provisioning = useProvisioningConnection(organizationId, source === 'scim')
  const [draft, setDraft] = useState<SyncDraft>({
    domain: current?.domain ?? '',
    token: '',
    tenantId: current?.tenantId ?? '',
    clientId: current?.clientId ?? '',
    clientSecret: '',
  })
  const [errors, setErrors] = useState<SyncFieldErrors>({})
  const change = (next: Partial<SyncDraft>) => setDraft((previous) => ({ ...previous, ...next }))
  const name = SYNC_SOURCE_NAMES[source]
  const disabled = directory.pending
  const canConnect =
    source === 'scim'
      ? provisioning.ready
      : source === 'okta'
        ? Boolean(draft.token.trim() && draft.domain.trim())
        : Boolean(draft.clientSecret.trim() && draft.tenantId.trim() && draft.clientId.trim())

  if (directory.denied) return null

  return (
    <Modal
      open
      onOpenChange={onClose}
      title={current ? `Update ${name} credentials` : `Connect ${name}`}
      confirmLabel={disabled ? 'Syncing…' : current ? 'Save and sync' : 'Connect and sync'}
      confirmDisabled={disabled || !canConnect}
      onConfirm={() => {
        setErrors(directory.connect(source, draft, onConnected) ?? {})
        return false
      }}
    >
      {source === 'okta' && (
        <>
          <TextField
            label='Okta domain'
            placeholder='company.okta.com'
            autoComplete='off'
            value={draft.domain}
            error={errors.domain}
            disabled={disabled || Boolean(current?.domain)}
            onChange={(domain) => change({ domain })}
          />
          <SecretField
            label='API token'
            placeholder='Paste your API token'
            value={draft.token}
            error={errors.token}
            disabled={disabled}
            onChange={(token) => change({ token })}
          />
          <ExternalLink href='https://developer.okta.com/docs/guides/create-an-api-token/main/'>
            Create an Okta API token
          </ExternalLink>
        </>
      )}
      {source === 'entra' && (
        <>
          <TextField
            label='Tenant ID'
            placeholder='Directory (tenant) ID'
            autoComplete='off'
            value={draft.tenantId}
            error={errors.tenantId}
            disabled={disabled || Boolean(current?.tenantId)}
            onChange={(tenantId) => change({ tenantId })}
          />
          <TextField
            label='Client ID'
            placeholder='Application (client) ID'
            autoComplete='off'
            value={draft.clientId}
            error={errors.clientId}
            disabled={disabled}
            onChange={(clientId) => change({ clientId })}
          />
          <SecretField
            label='Client secret'
            placeholder='Client secret value'
            value={draft.clientSecret}
            error={errors.clientSecret}
            disabled={disabled}
            onChange={(clientSecret) => change({ clientSecret })}
          />
          <ExternalLink href='https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app'>
            Register an app with Graph User.Read.All
          </ExternalLink>
        </>
      )}
      {source === 'scim' && provisioning.failed && (
        <FailureNotice
          message='Could not read the provisioning connection.'
          retrying={provisioning.fetching}
          onRetry={provisioning.refresh}
        />
      )}
      {source === 'scim' && !provisioning.failed && (
        <div className={styles.provisioning} aria-live='polite'>
          {!provisioning.loading && (
            <p data-type='T060'>
              {provisioning.ready ? 'Active' : 'Enable provisioning before connecting this source.'}
            </p>
          )}
          <div className={styles.quietActions}>
            {canOpenProvisioningSettings && (
              <Button
                variant='quiet'
                size='compact'
                render={<Link href={provisioningSettingsHref} />}
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
      <InlineNotice message={`Profiles and managers will be managed by ${name}.`} />
      {disabled && (
        <p className={styles.secondary} data-type='T060'>
          Sync is running. You can close this window and return for the result.
        </p>
      )}
      {directory.actionError && (
        <InlineNotice intent='danger' message={directory.actionError.message} />
      )}
    </Modal>
  )
}
