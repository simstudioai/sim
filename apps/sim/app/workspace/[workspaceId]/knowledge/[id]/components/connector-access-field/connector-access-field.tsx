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
import { isConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import { connectorMemberProvider } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import type { ConnectorMeta } from '@/connectors/types'
import { useWorkspaceAccounts } from '@/hooks/queries/credential-groups'

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
  workspaceId: string
  connectorConfig: ConnectorMeta
  value: ConnectorAccessSelection
  onChange: (value: ConnectorAccessSelection) => void
  /** Only an admin may move a connector out of workspace mode. */
  canAdmin: boolean
  disabled?: boolean
  /** Whether per-member access may be chosen; false leaves only the way back to workspace access. */
  allowMembers?: boolean
  /** Whether administrator access may be chosen; it needs a connector that mirrors source permissions. */
  allowAdmin?: boolean
  allowWorkspace?: boolean
  /** Rendered under the selection, for a caller that applies the change with its own control. */
  footer?: ReactNode
}

/**
 * Each mode decides who can read the indexed documents, which the three labels
 * cannot say on their own.
 */
function accessHint(mode: ConnectorAccessMode, sourceName: string): string {
  if (mode === 'members') {
    return `Members connect their ${sourceName} accounts and see only documents they can open there.`
  }
  if (mode === 'admin') {
    return `An administrator or service account syncs documents and permissions. Each person sees only documents they can open in ${sourceName}.`
  }
  return 'Everyone in this workspace can search these documents.'
}

/**
 * Chooses workspace access, member accounts, or source-managed permissions.
 */
export function ConnectorAccessField({
  workspaceId,
  connectorConfig,
  value,
  onChange,
  canAdmin,
  disabled = false,
  allowMembers = true,
  allowAdmin = false,
  allowWorkspace = true,
  footer,
}: ConnectorAccessFieldProps) {
  /**
   * Member access needs a supported sign-in provider. Source permissions may
   * also be available for providers authenticated with an API key.
   */
  const provider = connectorMemberProvider(connectorConfig)
  const membersSupported = provider !== null
  const { data, isLoading, error } = useWorkspaceAccounts(
    canAdmin && provider && value.accessMode === 'members' ? workspaceId : undefined
  )
  const accounts = data?.credentialGroup
  const configured =
    accounts?.status === 'active' &&
    accounts.options.some(
      (option) =>
        option.provider === provider &&
        option.status === 'active' &&
        option.configurationStatus === 'ready'
    )
  const showAdmin =
    Boolean(connectorConfig.mirrorsSourceAcls) && (allowAdmin || value.accessMode === 'admin')
  if (!membersSupported && !showAdmin) return null

  /** One ordered list, rendered by both the read-only and the editable branch. */
  const modes: { mode: ConnectorAccessMode; label: string; shown: boolean }[] = [
    { mode: 'workspace', label: 'Workspace', shown: allowWorkspace },
    { mode: 'members', label: 'Member accounts', shown: membersSupported },
    { mode: 'admin', label: 'Source permissions', shown: showAdmin },
  ]
  const modeItems = (isDisabled: (mode: ConnectorAccessMode) => boolean) =>
    modes
      .filter((entry) => entry.shown)
      .map((entry) => (
        <ButtonGroupItem key={entry.mode} value={entry.mode} disabled={isDisabled(entry.mode)}>
          {entry.label}
        </ButtonGroupItem>
      ))

  if (!canAdmin) {
    if (value.accessMode === 'workspace') return null
    return (
      <ChipModalField
        type='custom'
        title='Access'
        hint={accessHint(value.accessMode, connectorConfig.name)}
      >
        <ButtonGroup value={value.accessMode}>{modeItems(() => true)}</ButtonGroup>
      </ChipModalField>
    )
  }

  return (
    <ChipModalField
      type='custom'
      title='Access'
      error={error?.message}
      hint={accessHint(value.accessMode, connectorConfig.name)}
    >
      <div className='flex flex-col gap-2'>
        <ButtonGroup
          value={value.accessMode}
          onValueChange={(mode) => {
            if (isConnectorAccessMode(mode) && (mode !== 'workspace' || allowWorkspace)) {
              onChange({ accessMode: mode })
            }
          }}
        >
          {modeItems(
            (mode) =>
              disabled || (mode === 'members' && !allowMembers) || (mode === 'admin' && !allowAdmin)
          )}
        </ButtonGroup>

        {value.accessMode === 'members' &&
          connectorConfig.id === 'slack' &&
          !isLoading &&
          !configured && <SlackMemberSetup workspaceId={workspaceId} />}

        {footer}
      </div>
    </ChipModalField>
  )
}

interface SlackMemberSetupProps {
  workspaceId: string
}

/** Uses the existing app and credential-group setup to collect Slack user authorization. */
export function SlackMemberSetup({ workspaceId }: SlackMemberSetupProps) {
  return (
    <div className='flex flex-col items-start gap-2'>
      <p className='text-[var(--text-muted)] text-caption leading-snug'>
        Set up a Slack app, then enable member sign-in in Connected accounts. Each member connects
        their own Slack account.
      </p>
      <div className='flex flex-wrap items-center gap-2'>
        <ChipLink href={`/workspace/${workspaceId}/integrations/slack`}>Set up Slack app</ChipLink>
        <ChipLink href={`/workspace/${workspaceId}/settings/credential-groups`}>
          Configure member sign-in
        </ChipLink>
      </div>
    </div>
  )
}
