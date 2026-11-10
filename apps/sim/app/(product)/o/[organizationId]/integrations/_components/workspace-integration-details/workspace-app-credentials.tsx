'use client'

import { useState } from 'react'
import { OAuthConnectModal } from '@/app/(product)/_components/oauth-connect-modal/oauth-connect-modal'
import { ServiceAccountModal } from '@/app/(product)/_components/service-account-modal/service-account-modal'
import { CredentialDetail } from '@/app/(product)/o/[organizationId]/integrations/_components/credential-detail/credential-detail'
import { PersonalTokenModal } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/personal-token-modal'
import {
  canReconnectServiceAccount,
  hasServiceAccountForm,
  useDataverseReconnect,
  type WorkspaceCredential,
} from '@/platform/lib/data/credentials'
import { useWorkspaceCredentialAccess } from '@/platform/lib/data/integration-credentials'
import { toWorkspaceIntegrationCredential } from '@/platform/lib/data/integration-credentials-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import {
  appCredentials,
  GITLAB_TOKEN_CONNECTION,
  type WorkspaceAppConnection,
  type WorkspaceAppDetail,
} from '@/platform/lib/integrations/workspace-catalog'

export interface WorkspaceAppScope {
  app: WorkspaceAppDetail
  workspace: { id: string; name: string }
  /** The workspace's credentials; absent until they load. */
  credentials: readonly WorkspaceCredential[] | undefined
}

/**
 * One app's credentials in one workspace: the
 * methods this deployment can complete, which dialog is open, and each connected credential in the
 * credential page's vocabulary. `WorkspaceAppDialogs` renders the dialogs it opens.
 */
export function useWorkspaceAppCredentials(
  scope: WorkspaceAppScope | undefined,
  accountId: string | null
) {
  const [connecting, setConnecting] = useState<WorkspaceAppConnection | null>(null)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  const [replacingTokenId, setReplacingTokenId] = useState<string | null>(null)
  const connected = scope ? scope.credentials && appCredentials(scope.app, scope.credentials) : []
  const selected = connected?.find((credential) => credential.id === accountId)
  const dataverse = useDataverseReconnect(selected)
  const connections = scope?.app.connections ?? []
  const oauthFor = (providerId: string | null) =>
    connections.find(
      (connection) => connection.kind === 'oauth' && connection.providerId === providerId
    )
  const reconnectable = (credential: WorkspaceCredential) =>
    (credential.type === 'personal_token' && credential.providerId === 'gitlab') ||
    (credential.type === 'service_account' && canReconnectServiceAccount(credential.providerId)) ||
    (Boolean(oauthFor(credential.providerId)) &&
      (credential.id !== selected?.id || (!dataverse.pending && !dataverse.blockedReason)))

  return {
    credentials: connected?.flatMap((credential) => {
      if (!scope) return []
      const projected = toWorkspaceIntegrationCredential(credential, {
        appId: scope.app.id,
        workspace: scope.workspace,
        canReconnect: reconnectable(credential),
        instanceLabel: credential.providerId
          ? scope.app.instanceLabels[credential.providerId]
          : undefined,
      })
      return projected ? [projected] : []
    }),
    methods: connections
      .filter(
        (connection) =>
          connection.kind === 'oauth' ||
          connection.id === GITLAB_TOKEN_CONNECTION ||
          hasServiceAccountForm(connection.providerId)
      )
      .map((connection) => ({
        id: connection.id,
        label: connection.label,
        oauth: connection.kind === 'oauth',
        onSelect: () => setConnecting(connection),
      })),
    reconnect(credential: IntegrationCredential) {
      if (credential.type === 'personal_token') setReplacingTokenId(credential.id)
      else setReconnectingId(credential.id)
    },
    dialogs: {
      connecting,
      reconnecting: connected?.find((credential) => credential.id === reconnectingId),
      replacingToken: connected?.find((credential) => credential.id === replacingTokenId),
      requiredScopes: (providerId: string) =>
        oauthFor(providerId)?.requiredScopes?.map((requested) => requested.id),
      dataverseEnvironmentUrl: dataverse.environmentUrl,
      close() {
        setConnecting(null)
        setReconnectingId(null)
        setReplacingTokenId(null)
      },
    },
  }
}

interface WorkspaceAppDialogsProps {
  app: WorkspaceAppDetail
  workspaceId: string
  dialogs: ReturnType<typeof useWorkspaceAppCredentials>['dialogs']
}

/** The connect and reconnect dialogs `useWorkspaceAppCredentials` opens. */
export function WorkspaceAppDialogs({ app, workspaceId, dialogs }: WorkspaceAppDialogsProps) {
  const { connecting, reconnecting, replacingToken, close } = dialogs
  const scope = { kind: 'workspace' as const, workspaceId }
  const onOpenChange = (open: boolean) => {
    if (!open) close()
  }
  return (
    <>
      {connecting?.kind === 'oauth' && (
        <OAuthConnectModal
          open
          onOpenChange={onOpenChange}
          mode='connect'
          scope={scope}
          providerId={connecting.providerId}
          serviceName={app.name}
          requiredScopes={connecting.requiredScopes?.map((requested) => requested.id)}
          requireDataverseEnvironment={connecting.providerId === 'microsoft-dataverse'}
          returnTo={{ origin: 'integrations' }}
          docsUrl={app.docsUrl}
        />
      )}
      {connecting?.id === GITLAB_TOKEN_CONNECTION && (
        <PersonalTokenModal workspaceId={workspaceId} onClose={close} />
      )}
      {connecting?.kind === 'service_account' && (
        <ServiceAccountModal
          open
          onOpenChange={onOpenChange}
          scope={scope}
          serviceAccountProviderId={connecting.providerId}
          atlassianProduct={connecting.atlassianProduct}
          serviceName={app.name}
          onCreated={close}
        />
      )}
      {replacingToken && (
        <PersonalTokenModal
          workspaceId={workspaceId}
          replacing={{ credentialId: replacingToken.id, instanceUrl: replacingToken.instanceUrl }}
          onClose={close}
        />
      )}
      {reconnecting?.type === 'service_account' && reconnecting.providerId && (
        <ServiceAccountModal
          open
          onOpenChange={onOpenChange}
          scope={scope}
          serviceAccountProviderId={reconnecting.providerId}
          serviceName={app.name}
          onCreated={close}
          replacedAccount={{
            credentialId: reconnecting.id,
            displayName: reconnecting.displayName,
            description: reconnecting.description ?? undefined,
          }}
        />
      )}
      {reconnecting?.type !== 'service_account' && reconnecting?.providerId && (
        <OAuthConnectModal
          open
          onOpenChange={onOpenChange}
          mode='reauthorize'
          scope={scope}
          providerId={reconnecting.providerId}
          serviceName={app.name}
          requiredScopes={dialogs.requiredScopes(reconnecting.providerId)}
          reconnectTarget={{
            credentialId: reconnecting.id,
            displayName: reconnecting.displayName,
          }}
          requireDataverseEnvironment={Boolean(dialogs.dataverseEnvironmentUrl)}
          dataverseEnvironmentUrl={dialogs.dataverseEnvironmentUrl}
          returnTo={{ origin: 'integrations' }}
          docsUrl={app.docsUrl}
        />
      )}
    </>
  )
}

interface WorkspaceCredentialPageProps {
  workspaceId: string
  credential: IntegrationCredential
  appName: string
  providerId: string
  onReconnect?: () => void
  onDisconnect: () => void
  /** Back to the app once the viewer gives up their own access. */
  onLeft: () => void
}

/** A workspace credential's own page: details its admins rename, and who can use it. */
export function WorkspaceCredentialPage({
  workspaceId,
  credential,
  appName,
  providerId,
  onReconnect,
  onDisconnect,
  onLeft,
}: WorkspaceCredentialPageProps) {
  const access = useWorkspaceCredentialAccess(workspaceId, credential)
  if (!access.credential || !access.viewer) return null
  return (
    <CredentialDetail
      credential={access.credential}
      integrationName={appName}
      providerId={providerId}
      viewer={access.viewer}
      onSaveDetails={access.saveDetails}
      access={{
        people: access.people,
        onChange: access.saveAccess,
        onLeave: () => access.leave(onLeft),
      }}
      onReconnect={onReconnect}
      onDisconnect={onDisconnect}
    />
  )
}
