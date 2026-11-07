'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { EmptyState } from '@sim/emcn/empty-state'
import { CopyField } from '@sim/emcn/field/value-fields'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { errorMessageOr, LoadingRows, QueryBoundary } from '@sim/emcn/status/query-boundary'
import { Switch } from '@sim/emcn/switch'
import type { ScimConnectionView } from '@/lib/api/contracts/organization-scim'
import {
  CREDENTIAL_EXPIRY_OPTIONS,
  type CredentialExpiry,
  SETTING_TOGGLES,
} from '@/ee/scim/components/options'
import { formatRelative } from '@/ee/scim/lib/relative-time'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  ActionRow,
  FieldStack,
  Muted,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { GroupMappings } from '@/platform/embedded/app/(shell)/settings/_components/sections/sso/group-mappings'
import { useSettingsNavigationBlocked } from '@/platform/embedded/lib/data/settings-guard'
import {
  useScimActivityFeed,
  useScimConnectionActions,
  useScimProvisioning,
} from '@/platform/embedded/lib/data/sso/scim'
import { plural } from '@/platform/shared/plural'
import { formatRelativeTime } from '@/platform/shared/time'

function formatInstant(iso: string | null, now: number): string {
  return iso ? formatRelativeTime(new Date(iso).getTime(), now) : 'never'
}

function ActivityList({ organizationId, active }: { organizationId: string; active: boolean }) {
  const activity = useScimActivityFeed(organizationId, active)
  const { data } = activity
  if (!data) {
    return (
      <QueryBoundary
        query={activity}
        failure={errorMessageOr('Failed to load directory activity')}
        loadingLabel='Loading activity…'
      >
        {() => null}
      </QueryBoundary>
    )
  }
  if (data.length === 0) return <EmptyState title='No requests yet' />
  const now = Date.now()
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
                ? `${formatInstant(entry.createdAt, now)} · ${entry.scimType ? `${entry.scimType}: ` : ''}${entry.detail}`
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
  /** Held by the panel, so a draft survives turning provisioning off and on. */
  expiry: CredentialExpiry
  setExpiry: (expiry: CredentialExpiry) => void
  organizationId: string
  active: boolean
  connection: ScimConnectionView
}

function ConnectionDetails({
  organizationId,
  active,
  connection,
  expiry,
  setExpiry,
}: ConnectionDetailsProps) {
  const actions = useScimConnectionActions(organizationId)
  const [showRules, setShowRules] = useState(false)
  /** The one moment the token exists outside its digest. Held only in this state, never persisted. */
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null)
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null)
  const pendingRevoke =
    connection.credentials.find((credential) => credential.id === pendingRevokeId) ?? null
  useSettingsUnsavedGuard({
    isDirty: expiry !== 'never' || issuedSecret !== null,
    navigationBlocked: actions.issuing,
    onDiscard: () => {
      setExpiry('never')
      setIssuedSecret(null)
    },
  })

  function issue() {
    return actions.issue(expiry, (secret) => {
      setIssuedSecret(secret)
      setExpiry('never')
    })
  }

  const now = Date.now()
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
          {connection.credentials.length === 0 && <EmptyState title='No tokens yet.' />}
        </FieldStack>
        {connection.credentials.map((credential) => (
          <SettingsRow
            key={credential.id}
            label={`${credential.tokenPrefix}…`}
            description={`Last used ${formatRelative(credential.lastUsedAt)} · ${
              credential.expiresAt ? `expires ${formatRelative(credential.expiresAt)}` : 'no expiry'
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
              disabled={actions.issuing}
              options={CREDENTIAL_EXPIRY_OPTIONS}
              value={expiry}
              onValueChange={(value) => setExpiry(value as CredentialExpiry)}
            />
            <Button
              variant='primary'
              disabled={actions.issuing || connection.credentials.length >= 2}
              onClick={() => void issue()}
            >
              {actions.issuing ? 'Issuing…' : 'Issue token'}
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
                disabled={actions.updatingSetting}
                onCheckedChange={(checked) => void actions.updateSetting(toggle.key, checked)}
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
          onReconcile={actions.reconcile}
          reconciling={actions.reconciling}
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
              disabled={actions.reconciling}
              onClick={() => void actions.reconcile()}
            >
              {actions.reconciling ? 'Reconciling…' : 'Reconcile now'}
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
      <ConfirmDialog
        target={active && pendingRevoke !== null}
        onClose={() => setPendingRevokeId(null)}
        title='Revoke token'
        description={`Revoke ${pendingRevoke?.tokenPrefix ?? ''}? Your identity provider stops syncing the moment it next uses this token. Issue a new token first if you are rotating.`}
        confirmLabel='Revoke'
        pendingLabel='Revoking…'
        onConfirm={async () => {
          if (!pendingRevoke) return
          await actions.revoke(pendingRevoke.id)
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
  const provisioning = useScimProvisioning(organizationId, active)
  const navigationBlocked = useSettingsNavigationBlocked()
  const [expiry, setExpiry] = useState<CredentialExpiry>('never')

  if (provisioning.failure) {
    return (
      <SettingsSection title='Directory provisioning'>
        <FieldStack>
          <FailureNotice
            message={provisioning.failure.message}
            retrying={provisioning.failure.retrying}
            onRetry={provisioning.failure.retry}
          />
        </FieldStack>
      </SettingsSection>
    )
  }

  const { connection, enabled, isLoading } = provisioning

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
            disabled={isLoading || provisioning.updating || navigationBlocked}
            onCheckedChange={(checked) => void provisioning.setEnabled(checked)}
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
      {isLoading && <LoadingRows label='Loading directory provisioning…' />}
      {connection && enabled && (
        <ConnectionDetails
          organizationId={organizationId}
          active={active}
          connection={connection}
          expiry={expiry}
          setExpiry={setExpiry}
        />
      )}
    </SectionStack>
  )
}
