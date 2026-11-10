'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { CopyField } from '@sim/emcn/field/value-fields'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import {
  ActionRow,
  FieldStack,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { GroupMappings } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/group-mappings'
import { useMinuteClock } from '@/hooks/use-minute-clock'
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

function ActivityList({ organizationId, active }: { organizationId: string; active: boolean }) {
  const { data, isLoading, isError, error, isFetching, refetch } = useScimActivity(
    organizationId,
    active
  )
  const now = useMinuteClock()
  if (isLoading) return null
  if (data === undefined && isError) {
    return (
      <FailureNotice
        message={getErrorMessage(error, 'Failed to load directory activity')}
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    )
  }
  if (!data || data.length === 0) return <Muted>No requests yet.</Muted>
  return (
    <>
      {data.map((entry) => {
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
    </>
  )
}

interface ConnectionDetailsProps {
  organizationId: string
  active: boolean
  connection: ScimConnectionView
}

function ConnectionDetails({ organizationId, active, connection }: ConnectionDetailsProps) {
  const configure = useConfigureScimConnection()
  const issueCredential = useIssueScimCredential()
  const revokeCredential = useRevokeScimCredential()
  const reconcile = useReconcileScimConnection()
  const now = useMinuteClock()
  const [showRules, setShowRules] = useState(false)
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
          ? `Checked ${report.reconciledUsers} members. Review Group mappings for assignment status.`
          : `Checked ${report.reconciledUsers} members; corrected ${plural(corrections, 'grant')}`
      )
    } catch (error) {
      toast.error(getErrorMessage(error, 'Reconciliation failed'))
    }
  }

  return (
    <>
      <SettingsSection title='Connection'>
        <FieldStack>
          <CopyField
            label='Base URL'
            value={connection.baseUrl}
            hint='Enter this as the tenant or connector URL in your identity provider.'
          />
          <Muted>
            {plural(connection.userCount, 'provisioned member')},{' '}
            {plural(connection.groupCount, 'group')}. Last request{' '}
            {formatInstant(connection.lastRequestAt, now)}; last reconciled{' '}
            {formatInstant(connection.reconciledAt, now)}.
          </Muted>
        </FieldStack>
      </SettingsSection>

      <SettingsSection title='Tokens'>
        <FieldStack>
          <Muted>Shown once. Keep up to two active tokens for rotation.</Muted>
          {connection.credentials.length === 0 && <Muted>No tokens yet.</Muted>}
        </FieldStack>
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
        <FieldStack>
          <ActionRow>
            <Select
              label='Token expiry'
              disabled={issueCredential.isPending}
              options={CREDENTIAL_EXPIRY_OPTIONS}
              value={expiry}
              onValueChange={(value) => setExpiry(value as CredentialExpiry)}
            />
            <Button
              variant='primary'
              disabled={issueCredential.isPending || connection.credentials.length >= 2}
              onClick={() => void issue()}
            >
              {issueCredential.isPending ? 'Issuing…' : 'Issue token'}
            </Button>
          </ActionRow>
        </FieldStack>
      </SettingsSection>

      <SettingsSection title='Provisioning rules'>
        <Disclosure
          label='Control managed membership, first sign-in, and automatic group matching.'
          open={showRules}
          onOpenChange={setShowRules}
        >
          {SETTING_TOGGLES.map((toggle) => (
            <SettingsRow key={toggle.key} label={toggle.label} description={toggle.description}>
              <Switch
                label={toggle.label}
                checked={connection.settings[toggle.key] ?? false}
                disabled={configure.isPending}
                onCheckedChange={(checked) => void toggleSetting(toggle.key, checked)}
              />
            </SettingsRow>
          ))}
        </Disclosure>
      </SettingsSection>

      <SettingsSection title='Group mappings'>
        <FieldStack>
          <Muted>
            Map directory groups to permission groups, workspaces, or the organization admin role.
          </Muted>
        </FieldStack>
        <GroupMappings
          organizationId={organizationId}
          active={active}
          autoMapByName={connection.settings.autoMapPermissionGroupsByName === true}
          onReconcile={runReconcile}
          reconciling={reconcile.isPending}
        />
      </SettingsSection>

      <SettingsSection title='Activity'>
        <FieldStack>
          <Muted>Requests from your identity provider, including errors.</Muted>
        </FieldStack>
        <ActivityList organizationId={organizationId} active={active} />
        <FieldStack>
          <ActionRow>
            <Button
              size='compact'
              disabled={reconcile.isPending}
              onClick={() => void runReconcile()}
            >
              {reconcile.isPending ? 'Reconciling…' : 'Reconcile now'}
            </Button>
          </ActionRow>
        </FieldStack>
      </SettingsSection>

      <Modal
        variant='feedback'
        open={active && issuedSecret !== null}
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
      <Modal
        variant='confirm'
        destructive
        open={active && pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevokeId(null)
        }}
        title='Revoke token'
        description={`Revoke ${pendingRevoke?.tokenPrefix ?? ''}? Your identity provider stops syncing the moment it next uses this token. Issue a new token first if you are rotating.`}
        confirmLabel={revokeCredential.isPending ? 'Revoking…' : 'Revoke'}
        onConfirm={async () => {
          if (!pendingRevoke) return
          await revokeCredential.mutateAsync({ organizationId, credentialId: pendingRevoke.id })
          toast.success('Token revoked')
        }}
      />
    </>
  )
}

interface ScimPanelProps {
  organizationId: string
  active: boolean
  onOpenDomains: () => void
}

/** The SCIM connection. The section renders this only with the deployment's `scim` feature on. */
export function ScimPanel({ organizationId, active, onOpenDomains }: ScimPanelProps) {
  const { data, isLoading, isError, error, isFetching, refetch } = useScimConnection(
    organizationId,
    active
  )
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
        <SettingsRow
          label='Enable directory provisioning'
          description='Create, update, and deactivate members from your identity provider with SCIM 2.0.'
        >
          <Switch
            label='Enable directory provisioning'
            checked={enabled}
            disabled={isLoading || configure.isPending || navigationBlocked}
            onCheckedChange={(checked) => void updateEnabled(checked)}
          />
        </SettingsRow>
        {!enabled && (
          <SettingsRow label='Verify an email domain, then enable provisioning to connect your directory.'>
            <Button size='compact' onClick={onOpenDomains}>
              Manage domains
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
      {connection && enabled && (
        <ConnectionDetails
          organizationId={organizationId}
          active={active}
          connection={connection}
        />
      )}
    </SectionStack>
  )
}
