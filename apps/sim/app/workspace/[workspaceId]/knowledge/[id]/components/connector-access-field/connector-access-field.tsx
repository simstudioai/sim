'use client'

import { type ReactNode, useMemo, useState } from 'react'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  ChipCombobox,
  ChipModalField,
  type ComboboxOption,
} from '@sim/emcn'
import Link from 'next/link'
import {
  type CredentialGroupStandardOAuthProvider,
  getCredentialGroupProviderId,
  getCredentialGroupStandardOAuthProviderFromProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import type { ConnectorMeta } from '@/connectors/types'
import { useCreateCredentialGroup, useCredentialGroups } from '@/hooks/queries/credential-groups'

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

/** The credential-group provider that collects accounts for this connector, if any. */
function credentialGroupProviderFor(
  connectorConfig: ConnectorMeta
): CredentialGroupStandardOAuthProvider | null {
  if (connectorConfig.auth.mode !== 'oauth' || !connectorConfig.permissionScopedListing) return null
  try {
    return getCredentialGroupStandardOAuthProviderFromProviderId(connectorConfig.auth.provider)
  } catch {
    return null
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
  /** Whether per-member access may be chosen; false leaves only the way back to workspace access. */
  allowMembers?: boolean
  /** Rendered under the selection, for a caller that applies the change with its own control. */
  footer?: ReactNode
}

/**
 * The Access section of a connector's settings: sync as the workspace, or
 * crawl once per Credential Group member so each person sees only what the
 * source lets them read. Rendered only for connectors whose listing reflects
 * who may read each document. An admin with no group collecting the
 * connector's accounts can create one here; members are then invited from
 * Settings.
 */
export function ConnectorAccessField({
  workspaceId,
  connectorConfig,
  value,
  onChange,
  canAdmin,
  disabled = false,
  allowMembers = true,
  footer,
}: ConnectorAccessFieldProps) {
  const { features } = useWorkspaceHostContext()
  const provider = credentialGroupProviderFor(connectorConfig)
  const providerId = provider ? getCredentialGroupProviderId(provider) : null
  const credentialGroupsAvailable = features?.credentialGroups === true
  const [createError, setCreateError] = useState<string | null>(null)

  const {
    data: settings,
    isLoading,
    error: loadError,
  } = useCredentialGroups(
    canAdmin && provider && credentialGroupsAvailable ? workspaceId : undefined
  )
  const { mutate: createCredentialGroup, isPending: isCreatingGroup } = useCreateCredentialGroup()

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

  if (!provider) return null

  const selectedValue =
    value.accessMode === 'members' && value.credentialGroupId && value.credentialGroupOptionId
      ? optionValue(value.credentialGroupId, value.credentialGroupOptionId)
      : undefined

  if (!canAdmin) {
    if (value.accessMode !== 'members') return null
    return (
      <ChipModalField type='custom' title='Access'>
        <ButtonGroup value='members' onValueChange={() => undefined}>
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

  /** Only a loaded, empty list means there is no group to pick; a disabled query says nothing. */
  const noGroupYet = settings !== undefined && options.length === 0
  const settingsHref = `/workspace/${workspaceId}/settings/credential-groups`

  const handleCreateGroup = () => {
    setCreateError(null)
    createCredentialGroup(
      {
        workspaceId,
        body: {
          name: `${connectorConfig.name} access`,
          options: [{ provider, label: connectorConfig.name, required: true }],
        },
      },
      {
        onSuccess: ({ credentialGroup }) => {
          const option = credentialGroup.options[0]
          if (!option) return
          onChange({
            accessMode: 'members',
            credentialGroupId: credentialGroup.id,
            credentialGroupOptionId: option.id,
          })
        },
        onError: (error) => setCreateError(error.message),
      }
    )
  }

  return (
    <ChipModalField
      type='custom'
      title='Access'
      error={createError ?? loadError?.message ?? undefined}
      hint={
        value.accessMode === 'members'
          ? 'Each member sees only the documents their own account can open. Scheduled, API, and chat runs see workspace-visible documents only.'
          : !credentialGroupsAvailable
            ? 'Per-member access needs Credential Groups, which are not available on this plan.'
            : undefined
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
          <ButtonGroupItem
            value='members'
            disabled={disabled || !allowMembers || !credentialGroupsAvailable}
          >
            Per member
          </ButtonGroupItem>
        </ButtonGroup>

        {value.accessMode === 'members' && (
          <>
            {noGroupYet ? (
              <Button
                variant='outline'
                size='sm'
                onClick={handleCreateGroup}
                disabled={disabled || isCreatingGroup}
              >
                {isCreatingGroup
                  ? 'Creating…'
                  : `Create a credential group for ${connectorConfig.name}`}
              </Button>
            ) : (
              <ChipCombobox
                options={options}
                value={selectedValue}
                onChange={(next) => {
                  const parsed = parseOptionValue(next)
                  if (parsed) onChange(parsed)
                }}
                placeholder='Select a credential group'
                isLoading={isLoading}
                disabled={disabled || Boolean(loadError)}
              />
            )}
            <p className='text-[var(--text-muted)] text-caption leading-snug'>
              Members connect their own {connectorConfig.name} account after you invite them in{' '}
              <Link
                href={settingsHref}
                className='text-[var(--text-primary)] underline underline-offset-2'
              >
                Settings
              </Link>
              .
            </p>
          </>
        )}

        {footer}
      </div>
    </ChipModalField>
  )
}
