'use client'

import { useMemo } from 'react'
import type { ComboboxOption } from '@sim/emcn'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import {
  type CredentialGroupProvider,
  findCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import { aclIsDerived } from '@/lib/knowledge/connectors/access-modes'
import type { ConnectorMeta } from '@/connectors/types'
import { useCredentialGroups } from '@/hooks/queries/credential-groups'

/** Encodes a group and option pair as one combobox value. */
export function encodeConnectorMemberGroupOption(
  credentialGroupId: string,
  credentialGroupOptionId: string
): string {
  return `${credentialGroupId}:${credentialGroupOptionId}`
}

export function decodeConnectorMemberGroupOption(
  value: string
): { credentialGroupId: string; credentialGroupOptionId: string } | null {
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  return {
    credentialGroupId: value.slice(0, separator),
    credentialGroupOptionId: value.slice(separator + 1),
  }
}

/** The credential-group provider that collects accounts for this connector, if any. */
export function connectorMemberGroupProvider(
  connectorConfig: ConnectorMeta
): CredentialGroupProvider | null {
  if (connectorConfig.auth.mode !== 'oauth' || !connectorConfig.permissionScopedListing) return null
  return findCredentialGroupProviderFromProviderId(connectorConfig.auth.provider)
}

/** The config fields a per-member connector hides: its listing caps, which the server clears. */
export function derivedAclCapFieldIds(
  connectorConfig: ConnectorMeta | null,
  accessMode: ConnectorAccessMode
): ReadonlySet<string> {
  return new Set(
    aclIsDerived(accessMode) ? (connectorConfig?.permissionScopedListing?.capFieldIds ?? []) : []
  )
}

interface UseConnectorMemberGroupOptionsInput {
  workspaceId: string
  connectorConfig: ConnectorMeta | null
  /** False leaves the query off and reports no options, for a viewer who cannot choose anyway. */
  enabled: boolean
}

export interface ConnectorMemberGroupOptions {
  /** Every active option in the workspace collecting the connector's accounts, as combobox entries. */
  options: ComboboxOption[]
  /** Whether the connector's provider can be collected through a Credential Group at all. */
  supported: boolean
  /** More than one candidate: the admin has to say which, or the server refuses the ambiguity. */
  needsChoice: boolean
  isLoading: boolean
  error: Error | null
}

/**
 * The Credential Group options a per-member connector could sync through.
 * One source for the Access field, which renders them, and the modals, which
 * must not submit while a choice between several is still open.
 */
export function useConnectorMemberGroupOptions({
  workspaceId,
  connectorConfig,
  enabled,
}: UseConnectorMemberGroupOptionsInput): ConnectorMemberGroupOptions {
  const provider = connectorConfig ? connectorMemberGroupProvider(connectorConfig) : null
  const providerId = provider ? getCredentialGroupProviderId(provider) : null
  const {
    data: settings,
    isLoading,
    error,
  } = useCredentialGroups(enabled && provider ? workspaceId : undefined)

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
          value: encodeConnectorMemberGroupOption(group.id, option.id),
        })
      }
    }
    return entries
  }, [settings, providerId])

  return {
    options,
    supported: provider !== null,
    needsChoice: options.length > 1,
    isLoading,
    error: error ?? null,
  }
}
