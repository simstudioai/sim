'use client'

import { type ReactNode, useState } from 'react'
import { OAuthConnectModal } from '@/app/(product)/_components/oauth-connect-modal/oauth-connect-modal'
import { ServiceAccountModal } from '@/app/(product)/_components/service-account-modal/service-account-modal'
import { CredentialDetail } from '@/app/(product)/o/[organizationId]/integrations/_components/credential-detail/credential-detail'
import type { ConnectMethod } from '@/app/(product)/o/[organizationId]/integrations/_components/live-integration-details/live-integration-details'
import { PersonalTokenModal } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/personal-token-modal'
import {
  hasServiceAccountForm,
  type ResourceScope,
  useDataverseReconnect,
} from '@/platform/lib/data/credentials'
import { useWorkspaceCredentialAccess } from '@/platform/lib/data/integration-credentials'
import {
  type AppWorkspaceCredential,
  toWorkspaceIntegrationCredential,
} from '@/platform/lib/data/integration-credentials-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import {
  appCredentials,
  type WorkspaceAppConnection,
  type WorkspaceAppDetail,
} from '@/platform/lib/integrations/workspace-catalog'

interface WorkspaceAppCredentialsOptions {
  /** The app in the workspace's catalog; absent where the workspace cannot use it. */
  app: WorkspaceAppDetail | undefined
  workspace: { id: string; name: string } | undefined
  /** The workspace's credentials; absent until they load. */
  credentials: readonly AppWorkspaceCredential[] | undefined
  /** The credential the URL opens, whose Dataverse binding decides whether it reconnects. */
  accountId: string | null
}

/**
 * One app's credentials in one workspace, as legacy's workspace integration page served them: the
 * methods this deployment can complete, the dialogs they open, and each connected credential's
 * page with its details, access and reconnection.
 */
export function useWorkspaceAppCredentials({
  app,
  workspace,
  credentials,
  accountId,
}: WorkspaceAppCredentialsOptions) {
  const [connecting, setConnecting] = useState<WorkspaceAppConnection | null>(null)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  const [replacingTokenId, setReplacingTokenId] = useState<string | null>(null)
  const connected =
    app && workspace ? (credentials ? appCredentials(app, credentials) : undefined) : []
  const selected = connected?.find((credential) => credential.id === accountId)
  const dataverse = useDataverseReconnect(selected)
  const connections = app?.connections ?? []
  const oauthFor = (providerId: string | null) =>
    connections.find(
      (connection) => connection.kind === 'oauth' && connection.providerId === providerId
    )
  const usable = connections.filter(
    (connection) =>
      connection.kind === 'oauth' ||
      connection.kind === 'personal_token' ||
      hasServiceAccountForm(connection.providerId)
  )
  const reconnectable = (credential: AppWorkspaceCredential) =>
    credential.type === 'personal_token' ||
    (Boolean(oauthFor(credential.providerId)) &&
      (credential.id !== selected?.id || (!dataverse.pending && !dataverse.blockedReason)))
  const mapped = connected?.flatMap((credential) => {
    if (!app || !workspace) return []
    const projected = toWorkspaceIntegrationCredential(credential, {
      appId: app.id,
      workspace,
      canReconnect: reconnectable(credential),
    })
    return projected ? [projected] : []
  })
  const reconnecting = connected?.find((credential) => credential.id === reconnectingId)
  const replacingToken = connected?.find((credential) => credential.id === replacingTokenId)

  const methods: ConnectMethod[] = usable.map((connection) => ({
    id: connection.id,
    label: connection.label,
    oauth: connection.kind === 'oauth',
    onSelect: () => setConnecting(connection),
  }))

  function renderCredential(
    credential: IntegrationCredential,
    disconnect: () => void,
    onLeft: () => void
  ): ReactNode {
    if (!app || !workspace) return null
    return (
      <WorkspaceCredentialPage
        key={credential.id}
        workspaceId={workspace.id}
        credential={credential}
        appName={app.name}
        providerId={app.id}
        onReconnect={
          credential.canReconnect
            ? () =>
                credential.type === 'personal_token'
                  ? setReplacingTokenId(credential.id)
                  : setReconnectingId(credential.id)
            : undefined
        }
        onDisconnect={disconnect}
        onLeft={onLeft}
      />
    )
  }

  const scope: ResourceScope | undefined = workspace && {
    kind: 'workspace',
    workspaceId: workspace.id,
  }
  const dialogs = app && workspace && scope && (
    <>
      {connecting?.kind === 'oauth' && (
        <OAuthConnectModal
          open
          onOpenChange={(open) => {
            if (!open) setConnecting(null)
          }}
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
      {connecting?.kind === 'personal_token' && (
        <PersonalTokenModal workspaceId={workspace.id} onClose={() => setConnecting(null)} />
      )}
      {connecting?.kind === 'service_account' && (
        <ServiceAccountModal
          open
          onOpenChange={(open) => {
            if (!open) setConnecting(null)
          }}
          scope={scope}
          serviceAccountProviderId={connecting.providerId}
          atlassianProduct={app.id === 'confluence' ? 'confluence' : 'jira'}
          serviceName={app.name}
          onCreated={() => setConnecting(null)}
        />
      )}
      {replacingToken && (
        <PersonalTokenModal
          workspaceId={workspace.id}
          replacing={{ credentialId: replacingToken.id, instanceUrl: replacingToken.instanceUrl }}
          onClose={() => setReplacingTokenId(null)}
        />
      )}
      {reconnecting?.providerId && (
        <OAuthConnectModal
          open
          onOpenChange={(open) => {
            if (!open) setReconnectingId(null)
          }}
          mode='reauthorize'
          scope={scope}
          providerId={reconnecting.providerId}
          serviceName={app.name}
          requiredScopes={oauthFor(reconnecting.providerId)?.requiredScopes?.map(
            (requested) => requested.id
          )}
          reconnectTarget={{
            credentialId: reconnecting.id,
            displayName: reconnecting.displayName,
          }}
          requireDataverseEnvironment={Boolean(dataverse.environmentUrl)}
          dataverseEnvironmentUrl={dataverse.environmentUrl}
          returnTo={{ origin: 'integrations' }}
          docsUrl={app.docsUrl}
        />
      )}
    </>
  )

  return {
    credentials: mapped,
    methods,
    unavailableReason:
      app?.access === 'unconfigured'
        ? 'Unavailable in this deployment. Contact your administrator.'
        : 'This app has no connection you can add here.',
    renderCredential,
    dialogs,
  }
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
function WorkspaceCredentialPage({
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
      people={access.people}
      onChange={access.save}
      onReconnect={onReconnect}
      onDisconnect={onDisconnect}
      onLeave={() => access.leave(onLeft)}
    />
  )
}
