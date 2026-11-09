'use client'

import { useState } from 'react'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import {
  derivedAclCapFieldIds,
  isConnectorFieldRequired,
} from '@/lib/knowledge/connectors/access-fields'
import { getProviderIdFromServiceId, type OAuthProvider } from '@/lib/oauth'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import { liveSearchSourceMeta } from '@/lib/sim-search/live/source-settings'
import type { SourceSelectionLabel, SourceSelectionLabels } from '@/lib/sim-search/source-identity'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import type { GitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/hooks/kb/connectors/use-connector-config-fields'
import { useOAuthCredentials } from '@/hooks/queries/oauth/credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
import { useGitHubInstallationSetup } from '@/hooks/use-github-installation-setup'

export const CONNECTOR_SWITCH_NOTICE: Record<ConnectorAccessMode, string> = {
  workspace: 'Every workspace member can read every synced document once the next sync completes.',
  members:
    'Teammates are invited to connect their accounts. Documents become available after their next sync. Item limits are removed.',
  admin:
    'Documents become available after the next sync updates their source permissions. Item limits are removed.',
}

interface ConnectorSettingsFieldsOptions {
  gitlabPermissions?: GitLabPermissionForm
  isSearchIndex: boolean
  usesGitHubInstallation: boolean
  connectorConfig: ConnectorMeta | null
  sourceConfig: ConfigFieldMap
  selectionLabels: SourceSelectionLabels
  credentialId: string | null
  canonicalGroups: Map<string, ConnectorConfigField[]>
  canonicalModes: Record<string, 'basic' | 'advanced'>
  onToggleCanonicalMode: (canonicalId: string) => void
  onFieldChange: (
    fieldId: string,
    value: ConfigFieldValue,
    selectedOptions?: SourceSelectionLabel[]
  ) => void
  isSaving: boolean
  access: { accessMode: ConnectorAccessMode }
  canAdmin: boolean
  allowAdmin: boolean
  accessDirty: boolean
  accessModeChanged: boolean
  scope: ResourceScope
  needsWorkspaceCredential: boolean
  workspaceCredentialId: string | null
  contentCredentialId: string | null
  onContentCredentialChange: (credentialId: string | null) => void
}

/** The accounts and visibility an existing connector's settings form draws from. */
export function useConnectorSettingsFields({
  gitlabPermissions,
  isSearchIndex,
  usesGitHubInstallation,
  connectorConfig: originalConfig,
  sourceConfig,
  selectionLabels,
  credentialId,
  canonicalGroups,
  canonicalModes,
  onToggleCanonicalMode,
  onFieldChange,
  isSaving,
  access,
  canAdmin,
  allowAdmin,
  accessDirty,
  accessModeChanged,
  scope,
  needsWorkspaceCredential,
  workspaceCredentialId,
  contentCredentialId,
  onContentCredentialChange,
}: ConnectorSettingsFieldsOptions) {
  const liveSearch = isSearchIndex
  const connectorConfig = liveSearchSourceMeta(originalConfig, Boolean(liveSearch), {
    githubInstallation: usesGitHubInstallation && scope.kind === 'organization',
  })
  const providerId =
    connectorConfig?.auth.mode === 'oauth'
      ? (getProviderIdFromServiceId(connectorConfig.auth.provider) as OAuthProvider)
      : null
  const syncsPerMember = access.accessMode === 'members'
  const isGitHubInstallationSource =
    usesGitHubInstallation &&
    isSearchIndex &&
    scope.kind === 'organization' &&
    connectorConfig?.id === 'github' &&
    syncsPerMember
  const requiresServiceAccount = Boolean(
    connectorConfig &&
      !isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, 'oauth')
  )
  const githubSetup = useGitHubInstallationSetup({
    organizationId:
      isGitHubInstallationSource && canAdmin && scope.kind === 'organization'
        ? scope.organizationId
        : undefined,
    onConnected: onContentCredentialChange,
  })
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const isContentCredentialChange = accessDirty && !accessModeChanged
  const {
    data: rawCredentials = [],
    isLoading: credentialsLoading,
    isFetching: credentialsFetching,
    error: credentialsError,
    refetch: refetchCredentials,
  } = useOAuthCredentials(providerId ?? undefined, {
    enabled: (needsWorkspaceCredential || syncsPerMember) && Boolean(providerId),
    purpose: syncsPerMember ? 'browsing' : undefined,
    ...resourceScopeFields(scope),
  })
  useCredentialRefreshTriggers(refetchCredentials, providerId ?? '', scope)
  const [browseCredentialId, setBrowseCredentialId] = useState<string | null>(null)
  const selectorCredentialId = isGitHubInstallationSource
    ? contentCredentialId
    : syncsPerMember
      ? browseCredentialId
      : (workspaceCredentialId ?? credentialId)
  const selectorCredential = rawCredentials.find((item) => item.id === selectorCredentialId)
  const installations = rawCredentials.filter(
    (credential) => credential.provider === GITHUB_INSTALLATION_PROVIDER_ID
  )
  const credentialOptions = rawCredentials
    .filter(
      (credential) =>
        !connectorConfig ||
        isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, credential.type)
    )
    .map((credential) => ({
      label: credential.name || credential.provider,
      value: credential.id,
    }))

  const hideFixedAccessMode = isSearchIndex && needsWorkspaceCredential && canAdmin && allowAdmin
  const hiddenCapFieldIds = derivedAclCapFieldIds(connectorConfig, access.accessMode)
  const isOptionalSetupField = (field: ConnectorConfigField) =>
    Boolean(
      gitlabPermissions &&
        connectorConfig &&
        field.setupGroup === 'options' &&
        !isConnectorFieldRequired(field, connectorConfig, access.accessMode)
    )
  const configFieldsProps = connectorConfig
    ? {
        scope,
        accessMode: access.accessMode,
        connectorConfig,
        sourceConfig,
        selectionLabels,
        credentialId: selectorCredential?.id ?? null,
        credentialType: selectorCredential?.type,
        canonicalGroups,
        canonicalModes,
        onFieldChange,
        onToggleCanonicalMode,
        disabled: isSaving,
      }
    : null

  return {
    browseCredentialId,
    configFieldsProps,
    connectorConfig,
    credentialOptions,
    credentialsError,
    credentialsFetching,
    credentialsLoading,
    githubSetup,
    hiddenCapFieldIds,
    hideFixedAccessMode,
    installations,
    isContentCredentialChange,
    isGitHubInstallationSource,
    isOptionalSetupField,
    rawCredentials,
    refetchCredentials,
    requiresServiceAccount,
    setBrowseCredentialId,
    setShowMoreOptions,
    showMoreOptions,
    syncsPerMember,
  }
}
