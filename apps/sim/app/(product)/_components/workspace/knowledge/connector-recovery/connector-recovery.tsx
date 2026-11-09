'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { OAuthConnectModal } from '@/app/(product)/_components/oauth-connect-modal/oauth-connect-modal'
import styles from '@/app/(product)/_components/workspace/knowledge/connector-recovery/connector-recovery.module.css'
import {
  CONNECTOR_META_REGISTRY,
  type ConnectorData,
  CREDENTIAL_REMOVED_SYNC_ERROR,
  CREDENTIAL_REVOKED_SYNC_ERROR,
  getCanonicalScopesForProvider,
  getConnectorRequiredScopes,
  getMissingRequiredScopes,
  getProviderIdFromServiceId,
  isConnectorCredentialTypeAllowed,
  useConnectorScope,
  useCredentialRefreshTriggers,
  useOAuthCredentials,
  useStartConnectorMemberEnrollment,
  type ViewerConnectorMembership,
} from '@/platform/lib/data/knowledge/connectors'

interface NoticeProps {
  title: string
  detail?: string | null
  action?: { label: string; disabled?: boolean; onClick: () => void }
}

/** A condition that needs someone's attention, with the one action that resolves it. */
function Notice({ title, detail, action }: NoticeProps) {
  return (
    <div className={styles.notice} role='status'>
      <span className={styles.copy}>
        <span data-type='T060'>{title}</span>
        {detail && (
          <span className={styles.detail} data-type='T052'>
            {detail}
          </span>
        )}
      </span>
      {action && (
        <Button
          variant='secondary'
          size='compact'
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}

type UnconnectedMembership = Exclude<ViewerConnectorMembership, 'connected'>

/** Revoked and unverified viewers see the server's refusal, with nothing to retry. */
const MEMBERSHIP: Record<UnconnectedMembership, { title: string; action?: string }> = {
  not_enrolled: { title: 'Your account is not connected', action: 'Connect your account' },
  invited: { title: 'Your account is not connected', action: 'Connect your account' },
  needs_reauth: { title: 'Your account needs to be reconnected', action: 'Reconnect' },
  revoked: { title: 'An admin removed your access to Connected accounts' },
  unverified_email: { title: 'Verify your email address before connecting an account' },
}

interface MemberEnrollmentProps {
  knowledgeBaseId: string
  connectorId: string
  isSearchIndex: boolean
  membership: UnconnectedMembership
}

/** A per-member connector asks the viewer to connect their own account. */
export function MemberEnrollment({
  knowledgeBaseId,
  connectorId,
  isSearchIndex,
  membership,
}: MemberEnrollmentProps) {
  const enrollment = useStartConnectorMemberEnrollment()
  const { title, action } = MEMBERSHIP[membership]
  return (
    <Notice
      title={title}
      detail={enrollment.error?.message}
      action={
        action
          ? {
              label: action,
              disabled: enrollment.isPending,
              onClick: () =>
                enrollment.mutate({ knowledgeBaseId, connectorId, directOAuth: isSearchIndex }),
            }
          : undefined
      }
    />
  )
}

interface ConnectorRecoveryProps {
  workspaceId: string
  knowledgeBaseId: string
  connector: ConnectorData
  isSearchIndex: boolean
  canEdit: boolean
  /** Opens the connector's settings, where an account or credential is replaced. */
  onOpenSettings: () => void
}

/**
 * What stops a connector syncing and how to resume it: a disabled member sync, a credential that
 * was removed or revoked, repeated failures, or permissions the source now needs. A reconnect goes
 * through the provider; an account that needs replacing goes to the connector's settings.
 */
export function ConnectorRecovery({
  workspaceId,
  knowledgeBaseId,
  connector,
  isSearchIndex,
  canEdit,
  onOpenSettings,
}: ConnectorRecoveryProps) {
  const [reconnecting, setReconnecting] = useState(false)
  const { scope } = useConnectorScope(workspaceId)
  const meta = CONNECTOR_META_REGISTRY[connector.connectorType]
  const serviceId = meta?.auth.mode === 'oauth' ? meta.auth.provider : undefined
  const providerId = serviceId ? getProviderIdFromServiceId(serviceId) : undefined
  const requiredScopes = meta ? getConnectorRequiredScopes(meta.auth, connector.sourceConfig) : []
  const credentials = useOAuthCredentials(providerId, { workspaceId })
  const selected = credentials.data?.find((item) => item.id === connector.credentialId)
  useCredentialRefreshTriggers(credentials.refetch, selected?.provider ?? providerId ?? '', scope)
  const needsSettings =
    (meta && !isConnectorCredentialTypeAllowed(meta.auth, connector.accessMode, 'oauth')) ||
    selected?.type === 'service_account' ||
    Boolean(connector.credentialId && !selected && !credentials.isFetching)
  const missingScopes = selected ? getMissingRequiredScopes(selected, requiredScopes) : []
  const removed =
    connector.lastSyncError === CREDENTIAL_REMOVED_SYNC_ERROR && !connector.credentialId
  const revoked =
    connector.lastSyncError === CREDENTIAL_REVOKED_SYNC_ERROR && Boolean(connector.credentialId)
  const reconnectRequired = removed || revoked
  const pausedTitle = reconnectRequired
    ? 'Reconnect to resume syncing'
    : 'Sync paused after repeated failures'
  const canReconnect = canEdit && !needsSettings && Boolean(serviceId && providerId)
  const docsUrl = isSearchIndex ? meta?.searchDocsUrl : undefined

  return (
    <>
      {connector.accessMode === 'members' && connector.memberSyncStatus === 'disabled' && (
        <Notice
          title='Member sync is disabled'
          detail={
            connector.lastMemberSyncError ??
            'Members cannot search this source until its access settings are fixed.'
          }
        />
      )}
      {connector.status === 'disabled' || reconnectRequired ? (
        <Notice
          title={
            !canEdit
              ? pausedTitle
              : needsSettings
                ? 'Update the source account, then resume syncing'
                : serviceId
                  ? 'Reconnect to resume syncing'
                  : pausedTitle
          }
          action={
            canEdit && needsSettings
              ? { label: 'Settings', onClick: onOpenSettings }
              : canReconnect
                ? {
                    label: 'Reconnect',
                    disabled: Boolean(connector.credentialId && !selected),
                    onClick: () => setReconnecting(true),
                  }
                : undefined
          }
        />
      ) : missingScopes.length > 0 ? (
        <Notice
          title='Additional permissions required'
          action={
            canEdit ? { label: 'Update access', onClick: () => setReconnecting(true) } : undefined
          }
        />
      ) : null}
      {reconnecting && canReconnect && providerId && meta && (
        <OAuthConnectModal
          open
          onOpenChange={(open) => {
            if (!open) setReconnecting(false)
          }}
          mode={selected ? 'reauthorize' : 'connect'}
          scope={{ kind: 'workspace', workspaceId }}
          providerId={selected?.provider ?? providerId}
          serviceName={meta.name}
          docsUrl={docsUrl}
          requiredScopes={getCanonicalScopesForProvider(selected?.provider ?? providerId)}
          newScopes={selected ? missingScopes : undefined}
          reconnectTarget={
            selected ? { credentialId: selected.id, displayName: selected.name } : undefined
          }
          returnTo={{
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
