'use client'

import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { supportsConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import { connectorMemberProvider } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import type { ConnectorMeta } from '@/connectors/types'
import { useSourceAccounts } from '@/hooks/queries/source-accounts'

interface ConnectorAccessFieldOptions {
  workspaceId?: string
  scope?: ResourceScope
  connectorConfig: ConnectorMeta
  value: { accessMode: ConnectorAccessMode }
  canAdmin: boolean
  lockAccessMode: boolean
  allowMembers: boolean
  allowAdmin: boolean
  allowWorkspace: boolean
}

/** Which connection methods a source offers the viewer, and whether its Slack setup is ready. */
export function useConnectorAccessField({
  workspaceId,
  scope: explicitScope,
  connectorConfig,
  value,
  canAdmin,
  lockAccessMode,
  allowMembers,
  allowAdmin,
  allowWorkspace,
}: ConnectorAccessFieldOptions) {
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
  const modes: { mode: ConnectorAccessMode; label: string; allowed: boolean }[] = [
    { mode: 'workspace', label: 'Workspace', allowed: allowWorkspace },
    { mode: 'members', label: 'Member accounts', allowed: membersSupported && allowMembers },
    {
      mode: 'admin',
      label:
        !lockAccessMode && isConnectorCredentialTypeAllowed(connectorConfig.auth, 'admin', 'oauth')
          ? 'Admin or service account'
          : 'Service account',
      allowed: adminSupported && allowAdmin,
    },
  ]
  for (const entry of modes)
    entry.allowed &&= supportsConnectorAccessMode(connectorConfig, entry.mode)
  const hidden =
    value.accessMode === 'workspace' && (!canAdmin || (!membersSupported && !adminSupported))
  const singleMode =
    connectorConfig.supportedAccessModes?.filter((mode) => allowWorkspace || mode !== 'workspace')
      .length === 1 && modes.some((entry) => entry.mode === value.accessMode && entry.allowed)
  /** Keep a retired current method visible so an admin can select an available replacement. */
  const visibleModes = modes.filter((entry) => entry.allowed || entry.mode === value.accessMode)
  const currentMode = modes.find((entry) => entry.mode === value.accessMode)
  const showModeSelector =
    canAdmin && visibleModes.some((entry) => entry.allowed && entry.mode !== value.accessMode)
  return {
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
  }
}
