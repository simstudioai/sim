'use client'

import { useEffect, useState } from 'react'
import { Chip } from '@sim/emcn'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import { getCanonicalScopesForProvider, getProviderIdFromServiceId } from '@/lib/oauth'
import { getMissingRequiredScopes } from '@/lib/oauth/utils'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'

interface ConnectorRecoveryProps {
  connector: ConnectorData
  scope: ResourceScope
  knowledgeBaseId: string
  isSearchIndex?: boolean
  canEdit: boolean
  disabled?: boolean
  onEdit?: () => void
}

export function ConnectorRecovery({
  connector,
  scope,
  knowledgeBaseId,
  isSearchIndex = false,
  canEdit,
  disabled = false,
  onEdit,
}: ConnectorRecoveryProps) {
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const connectorDef = CONNECTOR_META_REGISTRY[connector.connectorType]
  const serviceId = connectorDef?.auth.mode === 'oauth' ? connectorDef.auth.provider : undefined
  const providerId = serviceId ? getProviderIdFromServiceId(serviceId) : undefined
  const requiredScopes =
    connectorDef?.auth.mode === 'oauth' ? (connectorDef.auth.requiredScopes ?? []) : []
  const {
    data: credentials,
    isFetching: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(providerId, resourceScopeFields(scope))
  const selectedCredential = credentials?.find((item) => item.id === connector.credentialId)
  const requiresAccountSettings =
    (connectorDef &&
      !isConnectorCredentialTypeAllowed(connectorDef.auth, connector.accessMode, 'oauth')) ||
    selectedCredential?.type === 'service_account'
  const missingScopes = selectedCredential
    ? getMissingRequiredScopes(selectedCredential, requiredScopes)
    : []

  useCredentialRefreshTriggers(
    refetchCredentials,
    selectedCredential?.provider ?? providerId ?? '',
    scope
  )

  useEffect(() => {
    if (
      showOAuthModal &&
      (requiresAccountSettings ||
        (connector.credentialId && !selectedCredential && !credentialsLoading))
    ) {
      setShowOAuthModal(false)
    }
  }, [
    showOAuthModal,
    connector.credentialId,
    selectedCredential,
    credentialsLoading,
    requiresAccountSettings,
  ])

  function openReconnect() {
    if (!canEdit || disabled || requiresAccountSettings) return
    if (connector.credentialId && !selectedCredential) return
    setShowOAuthModal(true)
  }

  function onOAuthOpenChange(open: boolean) {
    if (!open) {
      setShowOAuthModal(false)
    }
  }

  const docsUrl = isSearchIndex ? connectorDef?.searchDocsUrl : undefined

  return (
    <>
      {connector.accessMode === 'members' && connector.memberSyncStatus === 'disabled' && (
        <SettingsResourceRow
          title='Member sync is disabled'
          description={
            connector.lastMemberSyncError ??
            'Members cannot search this source until its access settings are fixed.'
          }
        />
      )}
      {connector.status === 'disabled' ? (
        <SettingsResourceRow
          title='Sync paused after repeated failures'
          description={
            requiresAccountSettings
              ? 'Update the source account in Settings, then resume syncing.'
              : serviceId
                ? 'Reconnect the source account to resume syncing.'
                : 'Resume the source to retry syncing.'
          }
          trailing={
            canEdit && requiresAccountSettings && onEdit ? (
              <Chip disabled={disabled} onClick={onEdit}>
                Settings
              </Chip>
            ) : canEdit && !requiresAccountSettings && serviceId && providerId ? (
              <Chip
                disabled={disabled || Boolean(connector.credentialId && !selectedCredential)}
                onClick={openReconnect}
              >
                Reconnect
              </Chip>
            ) : undefined
          }
        />
      ) : missingScopes.length > 0 ? (
        <SettingsResourceRow
          title='Additional permissions required'
          trailing={
            canEdit ? (
              <Chip disabled={disabled} onClick={openReconnect}>
                Update access
              </Chip>
            ) : undefined
          }
        />
      ) : null}
      {showOAuthModal &&
        !requiresAccountSettings &&
        canEdit &&
        serviceId &&
        providerId &&
        !connector.credentialId && (
          <ConnectOAuthModal
            mode='connect'
            origin='kb-connectors'
            open
            onOpenChange={onOAuthOpenChange}
            serviceId={serviceId}
            providerId={providerId}
            docsUrl={docsUrl}
            requiredScopes={getCanonicalScopesForProvider(providerId)}
            {...resourceScopeFields(scope)}
            knowledgeBaseId={knowledgeBaseId}
            connectorId={connector.id}
            connectorType={connector.connectorType}
          />
        )}
      {showOAuthModal &&
        !requiresAccountSettings &&
        canEdit &&
        serviceId &&
        providerId &&
        selectedCredential && (
          <ConnectOAuthModal
            mode='reauthorize'
            open
            onOpenChange={onOAuthOpenChange}
            toolName={connectorDef?.name ?? connector.connectorType}
            requiredScopes={getCanonicalScopesForProvider(providerId)}
            newScopes={missingScopes}
            serviceId={serviceId}
            providerId={selectedCredential.provider}
            docsUrl={docsUrl}
            reconnectTarget={{
              ...resourceScopeFields(scope),
              credentialId: selectedCredential.id,
              displayName: selectedCredential.name,
            }}
            returnContext={{
              origin: 'kb-connectors',
              knowledgeBaseId,
              connectorId: connector.id,
              connectorType: connector.connectorType,
            }}
          />
        )}
    </>
  )
}
