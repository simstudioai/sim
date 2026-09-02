'use client'

import { useMemo } from 'react'
import {
  ButtonGroup,
  ButtonGroupItem,
  ChipCombobox,
  ChipModalField,
  type ComboboxOption,
} from '@sim/emcn'
import Link from 'next/link'
import {
  getCredentialGroupProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import type { ConnectorMeta } from '@/connectors/types'
import { useCredentialGroups } from '@/hooks/queries/credential-groups'

/** What the caller chose; `members` needs the option the connector crawls with. */
export interface ConnectorAccessSelection {
  accessMode: 'workspace' | 'members'
  credentialGroupId?: string
  credentialGroupOptionId?: string
}

/** Encodes a group and option pair as one combobox value. */
function optionValue(credentialGroupId: string, credentialGroupOptionId: string): string {
  return `${credentialGroupId}:${credentialGroupOptionId}`
}

function parseOptionValue(value: string): ConnectorAccessSelection | null {
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  return {
    accessMode: 'members',
    credentialGroupId: value.slice(0, separator),
    credentialGroupOptionId: value.slice(separator + 1),
  }
}

interface ConnectorAccessFieldProps {
  workspaceId: string
  connectorConfig: ConnectorMeta
  value: ConnectorAccessSelection
  onChange: (value: ConnectorAccessSelection) => void
  /** Only an admin may put a connector into members mode. */
  canAdmin: boolean
  disabled?: boolean
}

/**
 * The Access section of a connector's settings: sync as the workspace, or
 * crawl once per Credential Group member so each person sees only what the
 * source lets them read. Rendered only for connectors whose listing reflects
 * who may read each document.
 */
export function ConnectorAccessField({
  workspaceId,
  connectorConfig,
  value,
  onChange,
  canAdmin,
  disabled = false,
}: ConnectorAccessFieldProps) {
  const supportsMembers =
    connectorConfig.auth.mode === 'oauth' && Boolean(connectorConfig.permissionScopedListing)
  const providerId = connectorConfig.auth.mode === 'oauth' ? connectorConfig.auth.provider : null

  const {
    data: settings,
    isLoading,
    isError,
  } = useCredentialGroups(canAdmin && supportsMembers ? workspaceId : undefined)

  const options = useMemo<ComboboxOption[]>(() => {
    if (!settings || !providerId) return []
    const entries: ComboboxOption[] = []
    for (const group of settings.credentialGroups) {
      if (group.status !== 'active') continue
      for (const option of group.options) {
        if (option.status !== 'active') continue
        if (!isCredentialGroupProvider(option.provider)) continue
        if (getCredentialGroupProviderId(option.provider) !== providerId) continue
        entries.push({
          label: `${group.name} · ${option.label}`,
          value: optionValue(group.id, option.id),
        })
      }
    }
    return entries
  }, [settings, providerId])

  if (!supportsMembers) return null

  const selectedValue =
    value.accessMode === 'members' && value.credentialGroupId && value.credentialGroupOptionId
      ? optionValue(value.credentialGroupId, value.credentialGroupOptionId)
      : undefined

  if (!canAdmin) {
    return (
      <ChipModalField
        type='custom'
        title='Access'
        hint={
          value.accessMode === 'members'
            ? 'Synced per member: each person sees the documents their own account can read. A workspace admin can change this.'
            : 'Synced as the workspace: every member can read every synced document. A workspace admin can change this.'
        }
      >
        <ButtonGroup value={value.accessMode} onValueChange={() => undefined}>
          <ButtonGroupItem value='workspace' disabled>
            Workspace
          </ButtonGroupItem>
          <ButtonGroupItem value='members' disabled>
            Per member
          </ButtonGroupItem>
        </ButtonGroup>
      </ChipModalField>
    )
  }

  const membersUnavailable = isError || (!isLoading && options.length === 0)

  return (
    <ChipModalField
      type='custom'
      title='Access'
      hint={
        value.accessMode === 'members'
          ? 'Each enrolled member connects their own account. Documents are visible only to the members whose account can open them; scheduled, API, and chat runs see workspace-visible documents only.'
          : 'Every workspace member can read every synced document.'
      }
    >
      <div className='flex flex-col gap-2'>
        <ButtonGroup
          value={value.accessMode}
          onValueChange={(mode) =>
            onChange(mode === 'members' ? { accessMode: 'members' } : { accessMode: 'workspace' })
          }
        >
          <ButtonGroupItem value='workspace' disabled={disabled}>
            Workspace
          </ButtonGroupItem>
          <ButtonGroupItem value='members' disabled={disabled}>
            Per member
          </ButtonGroupItem>
        </ButtonGroup>

        {value.accessMode === 'members' && (
          <>
            <ChipCombobox
              options={options}
              value={selectedValue}
              onChange={(next) => {
                const parsed = parseOptionValue(next)
                if (parsed) onChange(parsed)
              }}
              placeholder={
                membersUnavailable
                  ? `No credential group collects ${connectorConfig.name} accounts`
                  : 'Select a credential group option'
              }
              isLoading={isLoading}
              disabled={disabled || membersUnavailable}
            />
            <p className='text-[var(--text-muted)] text-caption leading-snug'>
              {membersUnavailable
                ? 'Create a credential group with a '
                : 'Members join through a credential group; manage them in '}
              <Link
                href={`/workspace/${workspaceId}/settings/credential-groups`}
                className='text-[var(--text-primary)] underline underline-offset-2'
              >
                {membersUnavailable ? `${connectorConfig.name} option in Settings` : 'Settings'}
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </ChipModalField>
  )
}
