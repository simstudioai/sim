'use client'

import type { ReactNode } from 'react'
import {
  ButtonGroup,
  ButtonGroupItem,
  ChipCombobox,
  ChipLink,
  ChipModalField,
  type ComboboxOption,
} from '@sim/emcn'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { slackSearchSetupHref } from '@/lib/sim-search/setup-navigation'
import { connectorMemberProvider } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import type { ConnectorMeta } from '@/connectors/types'
import { useSourceAccounts } from '@/hooks/queries/source-accounts'

export interface ConnectorAccessSelection {
  accessMode: ConnectorAccessMode
}

interface ConnectorContentCredentialFieldProps {
  credentialId: string | null
  onChange: (credentialId: string | null) => void
  options: ComboboxOption[]
  isLoading: boolean
  disabled?: boolean
}

/** A dedicated source account supplies content; member accounts supply visibility only. */
export function ConnectorContentCredentialField({
  credentialId,
  onChange,
  options,
  isLoading,
  disabled,
}: ConnectorContentCredentialFieldProps) {
  return (
    <ChipModalField
      type='custom'
      title='Sync documents with'
      hint={
        credentialId
          ? 'Sync documents from this account. Members connect their own accounts to confirm which documents they can access.'
          : 'Sync documents from connected members. Each person sees only documents they can open in the source.'
      }
    >
      <ChipCombobox
        value={credentialId ?? '__connected_members__'}
        options={[{ value: '__connected_members__', label: 'Connected members' }, ...options]}
        onChange={(value) => onChange(value === '__connected_members__' ? null : value)}
        isLoading={isLoading}
        disabled={disabled}
        placeholder='Choose an account'
      />
    </ChipModalField>
  )
}

interface ConnectorAccessFieldProps {
  workspaceId?: string
  scope?: ResourceScope
  connectorConfig: ConnectorMeta
  value: ConnectorAccessSelection
  onChange: (value: ConnectorAccessSelection) => void
  /** Only an admin may move a connector out of workspace mode. */
  canAdmin: boolean
  disabled?: boolean
  /** Whether member accounts may be chosen; an existing selection remains visible for recovery. */
  allowMembers?: boolean
  /** Whether administrator access may be chosen; it needs a connector that mirrors source permissions. */
  allowAdmin?: boolean
  allowWorkspace?: boolean
  /** Rendered under the selection, for a caller that applies the change with its own control. */
  footer?: ReactNode
  searchSetupSource?: 'slack'
  onSetupNavigate?: () => void
}

function accessHint(mode: ConnectorAccessMode, connectorConfig: ConnectorMeta): string {
  const sourceName = connectorConfig.name
  if (mode === 'members') {
    return (
      connectorConfig.memberSetupHint ??
      `Each teammate connects their ${sourceName} account. They see only documents they can open there.`
    )
  }
  if (mode === 'admin') {
    const identityHint = connectorConfig.requiresMemberIdentity
      ? ` Teammates still connect their ${sourceName} accounts to confirm their identity.`
      : ''
    return `${connectorConfig.adminSetupHint ?? 'An admin or service account syncs documents and permissions.'}${identityHint} Each person sees only documents they can open in ${sourceName}.`
  }
  return 'Everyone in this workspace can search these documents.'
}

/** Chooses how a source connects while preserving its document permissions. */
export function ConnectorAccessField({
  workspaceId,
  scope: explicitScope,
  connectorConfig,
  value,
  onChange,
  canAdmin,
  disabled = false,
  allowMembers = true,
  allowAdmin = false,
  allowWorkspace = true,
  footer,
  searchSetupSource,
  onSetupNavigate,
}: ConnectorAccessFieldProps) {
  const scope = explicitScope ?? resourceScopeFromOwner({ workspaceId })
  /**
   * Member access needs a supported sign-in provider. Source permissions may
   * also be available for providers authenticated with an API key.
   */
  const provider = connectorMemberProvider(connectorConfig)
  const membersSupported = provider !== null
  const accountsQuery = useSourceAccounts(
    canAdmin && provider && value.accessMode === 'members' ? scope : undefined
  )
  const accounts = accountsQuery.data?.credentialGroup
  const showSlackSetup =
    canAdmin && value.accessMode === 'members' && connectorConfig.id === 'slack'
  const configured =
    accounts?.status === 'active' &&
    accounts.options.some(
      (option) =>
        option.provider === provider &&
        option.status === 'active' &&
        option.configurationStatus === 'ready'
    )
  const adminSupported = Boolean(connectorConfig.mirrorsSourceAcls)
  if (!membersSupported && !adminSupported && value.accessMode === 'workspace') return null

  const modes: { mode: ConnectorAccessMode; label: string; allowed: boolean }[] = [
    { mode: 'workspace', label: 'Workspace', allowed: allowWorkspace },
    { mode: 'members', label: 'Member accounts', allowed: membersSupported && allowMembers },
    {
      mode: 'admin',
      label: isConnectorCredentialTypeAllowed(connectorConfig.auth, 'admin', 'oauth')
        ? 'Admin or service account'
        : 'Service account',
      allowed: adminSupported && allowAdmin,
    },
  ]
  /** Keep a retired current method visible so an admin can select an available replacement. */
  const visibleModes = modes.filter((entry) => entry.allowed || entry.mode === value.accessMode)
  const showModeSelector =
    canAdmin && visibleModes.some((entry) => entry.allowed && entry.mode !== value.accessMode)

  if (!canAdmin && value.accessMode === 'workspace') return null

  return (
    <ChipModalField
      type='custom'
      title='Connection method'
      error={canAdmin && !showSlackSetup ? accountsQuery.error?.message : undefined}
      hint={
        canAdmin && !modes.find((entry) => entry.mode === value.accessMode)?.allowed
          ? `This connection method is not available in this ${scope.kind}.`
          : accessHint(value.accessMode, connectorConfig)
      }
    >
      <div className='flex flex-col gap-2'>
        {showModeSelector ? (
          <ButtonGroup
            value={value.accessMode}
            disabled={disabled}
            onValueChange={(mode) => {
              const selection = modes.find((entry) => entry.mode === mode && entry.allowed)
              if (!disabled && selection) onChange({ accessMode: selection.mode })
            }}
          >
            {visibleModes.map((entry) => (
              <ButtonGroupItem key={entry.mode} value={entry.mode} disabled={!entry.allowed}>
                {entry.label}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
        ) : (
          <p className='text-[var(--text-body)] text-small'>
            {modes.find((entry) => entry.mode === value.accessMode)?.label}
          </p>
        )}

        {showSlackSetup &&
          (accountsQuery.isError ? (
            <SettingsQueryErrorState
              error={accountsQuery.error}
              fallback='Could not check Slack setup'
              isRetrying={accountsQuery.isFetching}
              onRetry={() => void accountsQuery.refetch()}
              variant='inline'
            />
          ) : accountsQuery.isPending ? (
            <SettingsEmptyState variant='inline'>Checking Slack setup…</SettingsEmptyState>
          ) : accountsQuery.isSuccess && !configured ? (
            <SlackMemberSetup
              scope={scope}
              searchSetupSource={searchSetupSource}
              onNavigate={onSetupNavigate}
            />
          ) : null)}

        {canAdmin && footer}
      </div>
    </ChipModalField>
  )
}

interface SlackMemberSetupProps {
  workspaceId?: string
  scope?: ResourceScope
  searchSetupSource?: 'slack' | 'search'
  onNavigate?: () => void
}

/** Uses the existing app and credential-group setup to collect Slack user authorization. */
export function SlackMemberSetup({
  workspaceId,
  scope: explicitScope,
  searchSetupSource,
  onNavigate,
}: SlackMemberSetupProps) {
  const scope = explicitScope ?? resourceScopeFromOwner({ workspaceId })
  const href =
    scope.kind === 'organization' || searchSetupSource
      ? slackSearchSetupHref(scope, searchSetupSource ?? 'search')
      : `/workspace/${scope.workspaceId}/settings/credential-groups`
  return (
    <div className='flex flex-col items-start gap-2'>
      <p className='text-[var(--text-muted)] text-caption leading-snug'>
        Set up your Slack app to continue.
      </p>
      <div className='flex flex-wrap items-center gap-2'>
        <ChipLink href={href} onClick={onNavigate}>
          Set up Slack
        </ChipLink>
      </div>
    </div>
  )
}
