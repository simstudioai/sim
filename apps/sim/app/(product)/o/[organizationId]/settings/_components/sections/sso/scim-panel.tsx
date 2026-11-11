'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyField } from '@sim/emcn/field/value-fields'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  ActionRow,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import { GroupMappings } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/group-mappings'
import { useMinuteClock } from '@/platform/lib/data/clock'
import {
  CREDENTIAL_EXPIRY_OPTIONS,
  type CredentialExpiry,
  type ScimConnectionView,
  SETTING_TOGGLES,
  useConfigureScimConnection,
  useIssueScimCredential,
  useReconcileScimConnection,
  useRevokeScimCredential,
  useScimActivity,
  useScimConnection,
} from '@/platform/lib/data/scim'
import {
  useSettingsNavigationBlocked,
  useSettingsUnsavedGuard,
} from '@/platform/lib/data/settings-guard'
import { plural } from '@/platform/shared/plural'
import { formatCalendarDate, formatRelativeTime } from '@/platform/shared/time'

function formatInstant(iso: string | null, now: number | null): string {
  return iso ? formatRelativeTime(new Date(iso).getTime(), now) : 'never'
}

function formatExpiry(iso: string): string {
  return formatCalendarDate(iso.slice(0, 10), 'full')
}

function ActivityList({ organizationId }: { organizationId: string }) {
  const activity = useScimActivity(organizationId)
  const now = useMinuteClock()
  return (
    <SettingsRead query={activity} failureMessage='Failed to load directory activity'>
      {(entries) => (
        <SettingsList
          title='Activity'
          empty={
            entries.length === 0
              ? {
                  title: 'No requests yet',
                  description: 'Requests from your identity provider, including errors',
                }
              : undefined
          }
        >
          {entries.map((entry) => {
            const failed = entry.status >= 400
            return (
              <SettingsRow
                key={entry.id}
                label={`${entry.method} ${entry.path}`}
                description={
                  failed && entry.detail
                    ? `${entry.scimType ? `${entry.scimType}: ` : ''}${entry.detail}`
                    : formatInstant(entry.createdAt, now)
                }
              >
                <StatusTag label={String(entry.status)} intent={failed ? 'danger' : 'neutral'} />
              </SettingsRow>
            )
          })}
        </SettingsList>
      )}
    </SettingsRead>
  )
}

interface ConnectionDetailsProps {
  organizationId: string
  connection: ScimConnectionView
}

function ConnectionDetails({ organizationId, connection }: ConnectionDetailsProps) {
  const configure = useConfigureScimConnection()
  const issueCredential = useIssueScimCredential()
  const revokeCredential = useRevokeScimCredential()
  const reconcile = useReconcileScimConnection()
  const now = useMinuteClock()
  /** The one moment the token exists outside its digest. Held only in this state, never persisted. */
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null)
  const [expiry, setExpiry] = useState<CredentialExpiry>('never')
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null)
  const pendingRevoke =
    connection.credentials.find((credential) => credential.id === pendingRevokeId) ?? null
  useSettingsUnsavedGuard({
    isDirty: expiry !== 'never' || issuedSecret !== null,
    navigationBlocked: issueCredential.isPending,
    onDiscard: () => {
      setExpiry('never')
      setIssuedSecret(null)
    },
  })

  async function toggleSetting(key: (typeof SETTING_TOGGLES)[number]['key'], value: boolean) {
    try {
      // Only the changed key is sent; the server merges it, so a concurrent edit is not reverted.
      await configure.mutateAsync({ organizationId, settings: { [key]: value } })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update setting'))
    }
  }

  async function issue() {
    if (issueCredential.isPending) return
    try {
      const result = await issueCredential.mutateAsync({
        organizationId,
        ...(expiry === 'never' ? {} : { expiresInDays: Number(expiry) }),
      })
      setIssuedSecret(result.secret)
      setExpiry('never')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to issue token'))
    }
  }

  async function runReconcile() {
    try {
      const report = await reconcile.mutateAsync(organizationId)
      const corrections = report.grantsAdded + report.grantsRemoved
      toast.success(
        corrections === 0
          ? `Checked ${report.reconciledUsers} members. Review Group mappings for assignment status`
          : `Checked ${report.reconciledUsers} members; corrected ${plural(corrections, 'grant')}`
      )
    } catch (error) {
      toast.error(getErrorMessage(error, 'Reconciliation failed'))
    }
  }

  const issueControls = (
    <ActionRow>
      <Select
        label='Token expiry'
        disabled={issueCredential.isPending}
        options={CREDENTIAL_EXPIRY_OPTIONS}
        value={expiry}
        onValueChange={(value) => setExpiry(value as CredentialExpiry)}
      />
      <Button
        size='compact'
        icon='I074'
        disabled={issueCredential.isPending || connection.credentials.length >= 2}
        onClick={() => void issue()}
      >
        {issueCredential.isPending ? 'Issuing…' : 'Issue token'}
      </Button>
    </ActionRow>
  )

  return (
    <>
      <SettingsSection title='Connection'>
        <FieldStack>
          <CopyField label='Base URL' value={connection.baseUrl} />
        </FieldStack>
        <SettingsRow
          label='Directory'
          description={`${plural(connection.userCount, 'provisioned member')}, ${plural(connection.groupCount, 'group')} · Last request ${formatInstant(connection.lastRequestAt, now)} · Last reconciled ${formatInstant(connection.reconciledAt, now)}`}
        >
          <Button size='compact' disabled={reconcile.isPending} onClick={() => void runReconcile()}>
            {reconcile.isPending ? 'Reconciling…' : 'Reconcile now'}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsList
        title='Tokens'
        empty={
          connection.credentials.length === 0
            ? {
                title: 'No tokens yet',
                description: 'Shown once. Keep up to two active tokens for rotation',
                action: issueControls,
              }
            : undefined
        }
      >
        {connection.credentials.map((credential) => (
          <SettingsRow
            key={credential.id}
            label={`${credential.tokenPrefix}…`}
            description={`Last used ${formatInstant(credential.lastUsedAt, now)} · ${
              credential.expiresAt ? `expires ${formatExpiry(credential.expiresAt)}` : 'no expiry'
            }`}
          >
            <ActionMenu
              label={`${credential.tokenPrefix} actions`}
              icon='I108'
              actions={[
                {
                  id: 'revoke',
                  label: 'Revoke',
                  destructive: true,
                  onSelect: () => setPendingRevokeId(credential.id),
                },
              ]}
            />
          </SettingsRow>
        ))}
        <SettingsRow
          label='New token'
          description='Shown once. Keep up to two active tokens for rotation'
        >
          {issueControls}
        </SettingsRow>
      </SettingsList>

      <SettingsSection title='Provisioning rules'>
        {SETTING_TOGGLES.map((toggle) => (
          <SwitchRow
            key={toggle.key}
            label={toggle.label}
            description={toggle.description}
            checked={connection.settings[toggle.key] ?? false}
            disabled={configure.isPending}
            onCheckedChange={(checked) => void toggleSetting(toggle.key, checked)}
          />
        ))}
      </SettingsSection>

      <GroupMappings
        organizationId={organizationId}
        autoMapByName={connection.settings.autoMapPermissionGroupsByName === true}
        onReconcile={runReconcile}
        reconciling={reconcile.isPending}
      />

      <ActivityList organizationId={organizationId} />

      <Modal
        variant='feedback'
        open={issuedSecret !== null}
        onOpenChange={(open) => {
          if (!open) setIssuedSecret(null)
        }}
        title='Credential issued'
        confirmLabel='Done'
      >
        <CopyField
          label='Token'
          value={issuedSecret ?? ''}
          hint='Copy it into your identity provider now. Sim stores only a digest and cannot show it again.'
        />
      </Modal>
      <ConfirmDialog
        target={pendingRevoke}
        onClose={() => setPendingRevokeId(null)}
        title={`Revoke ${pendingRevoke?.tokenPrefix ?? 'token'}…`}
        description='Your identity provider stops syncing the moment it next uses this token. Issue a new token first if you are rotating'
        confirmLabel='Revoke'
        pendingLabel='Revoking…'
        onConfirm={async (credential) => {
          await revokeCredential.mutateAsync({ organizationId, credentialId: credential.id })
          toast.success('Token revoked')
        }}
      />
    </>
  )
}

interface ScimPanelProps {
  organizationId: string
  onOpenDomains: () => void
}

/** The SCIM connection. The section renders this only with the deployment's `scim` feature on. */
export function ScimPanel({ organizationId, onOpenDomains }: ScimPanelProps) {
  const { data, isLoading, isError, error, isFetching, refetch } = useScimConnection(organizationId)
  const configure = useConfigureScimConnection()
  const navigationBlocked = useSettingsNavigationBlocked()

  if (data === undefined && isError) {
    return (
      <SettingsSection title='Directory provisioning'>
        <FieldStack>
          <FailureNotice
            message={getErrorMessage(error, 'Failed to load directory provisioning settings')}
            retrying={isFetching}
            onRetry={() => void refetch()}
          />
        </FieldStack>
      </SettingsSection>
    )
  }

  const connection = data?.connection ?? null
  const enabled = connection?.status === 'active'

  async function updateEnabled(next: boolean) {
    try {
      await configure.mutateAsync({ organizationId, status: next ? 'active' : 'disabled' })
      toast.success(next ? 'Directory provisioning enabled' : 'Directory provisioning disabled')
    } catch (failure) {
      toast.error(getErrorMessage(failure, 'Failed to update directory provisioning'))
    }
  }

  return (
    <SectionStack>
      <SettingsSection title='Directory provisioning'>
        <SwitchRow
          label='Enable directory provisioning'
          description='Create, update and deactivate members from your identity provider with SCIM 2.0'
          checked={enabled}
          disabled={isLoading || configure.isPending || navigationBlocked}
          onCheckedChange={(checked) => void updateEnabled(checked)}
        />
        {!enabled && (
          <SettingsRow
            label='Verified domains'
            description='Verify an email domain, then enable provisioning to connect your directory'
          >
            <Button size='compact' onClick={onOpenDomains}>
              Manage domains
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
      {connection && enabled && (
        <ConnectionDetails organizationId={organizationId} connection={connection} />
      )}
    </SectionStack>
  )
}
