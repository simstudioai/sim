'use client'

import type { ReactNode } from 'react'
import {
  ChipButtonGroup,
  ChipButtonGroupItem,
  ChipCombobox,
  ChipDropdown,
  ChipLink,
  ChipModalField,
  type ComboboxOption,
  Tooltip,
} from '@sim/emcn-legacy'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { slackSearchSetupHref } from '@/lib/sim-search/setup-navigation'
import { useConnectorAccessField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/use-connector-access-field'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { ConnectorMeta } from '@/connectors/types'

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
    <ChipModalField type='custom' title='Sync documents with'>
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
  /** Existing Search sources retain the sync method chosen during setup. */
  lockAccessMode?: boolean
  isAvailabilityReady?: boolean
  /** Whether member accounts may be chosen; an existing selection remains visible for recovery. */
  allowMembers?: boolean
  /** Whether administrator access may be chosen; it needs a connector that mirrors source permissions. */
  allowAdmin?: boolean
  allowWorkspace?: boolean
  /** Rendered under the selection, for a caller that applies the change with its own control. */
  footer?: ReactNode
  searchSetupSource?: 'slack'
  slackSetupOnly?: boolean
  onSetupNavigate?: () => void
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
  lockAccessMode = false,
  isAvailabilityReady = true,
  allowMembers = true,
  allowAdmin = false,
  allowWorkspace = true,
  footer,
  searchSetupSource,
  slackSetupOnly = false,
  onSetupNavigate,
}: ConnectorAccessFieldProps) {
  const {
    accountsQuery,
    configured,
    currentMode,
    hidden,
    modes,
    scope,
    showModeSelector,
    showSlackSetup,
    singleMode,
    visibleModes,
  } = useConnectorAccessField({
    workspaceId,
    scope: explicitScope,
    connectorConfig,
    value,
    canAdmin,
    lockAccessMode,
    allowMembers,
    allowAdmin,
    allowWorkspace,
  })
  if (hidden) return null
  if (singleMode) return canAdmin && footer ? <div className='px-2'>{footer}</div> : null

  return (
    <ChipModalField
      type='custom'
      title={slackSetupOnly ? 'Slack app' : allowWorkspace ? 'Connection method' : 'Sync using'}
      error={canAdmin && !showSlackSetup ? accountsQuery.error?.message : undefined}
      hint={
        canAdmin && isAvailabilityReady && !currentMode?.allowed
          ? `This connection method is not available in this ${scope.kind}.`
          : value.accessMode === 'workspace'
            ? 'Everyone in this workspace can search these documents.'
            : undefined
      }
    >
      <div className='flex flex-col gap-2'>
        {slackSetupOnly ? null : lockAccessMode ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild tabIndex={0}>
              <span className='inline-flex w-fit cursor-not-allowed'>
                <ChipDropdown
                  aria-label={`Sync using: ${currentMode?.label ?? 'Unavailable'}`}
                  value={value.accessMode}
                  options={visibleModes.map(({ mode, label }) => ({ value: mode, label }))}
                  disabled
                  className='pointer-events-none w-fit'
                />
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content>Add a new connection to change the sync method.</Tooltip.Content>
          </Tooltip.Root>
        ) : showModeSelector ? (
          <ChipButtonGroup
            value={value.accessMode}
            disabled={disabled}
            onValueChange={(mode) => {
              const selection = modes.find((entry) => entry.mode === mode && entry.allowed)
              if (!disabled && selection) onChange({ accessMode: selection.mode })
            }}
          >
            {visibleModes.map((entry) => (
              <ChipButtonGroupItem key={entry.mode} value={entry.mode} disabled={!entry.allowed}>
                {entry.label}
              </ChipButtonGroupItem>
            ))}
          </ChipButtonGroup>
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
    scope.kind === 'organization'
      ? slackSearchSetupHref(scope.organizationId, searchSetupSource ?? 'search')
      : `/workspace/${scope.workspaceId}/settings/credential-groups`
  return (
    <ChipLink href={href} onClick={onNavigate}>
      Set up Slack
    </ChipLink>
  )
}
