'use client'

import { useState } from 'react'
import { Button, Chip } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { OAuthConnectModal } from '@/app/(product)/_components/oauth-connect-modal/oauth-connect-modal'
import { RequestAccessModal } from '@/app/(product)/_components/request-access-modal/request-access-modal'
import { ServiceAccountModal } from '@/app/(product)/_components/service-account-modal/service-account-modal'
import { ConnectedCredential } from '@/app/(product)/o/[organizationId]/integrations/_components/connected-credential/connected-credential'
import { WorkspaceCapabilities } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-capabilities/workspace-capabilities'
import { IntegrationIdea } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-idea/integration-idea'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import { WorkspaceCredentialDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-credential-details/workspace-credential-details'
import { PersonalTokenModal } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/personal-token-modal'
import {
  hasServiceAccountForm,
  type ResourceScope,
  useDataverseReconnect,
} from '@/platform/lib/data/credentials'
import {
  appCredentials,
  type WorkspaceAppConnection,
  type WorkspaceAppDetail,
  type WorkspaceConnectedCredential,
} from '@/platform/lib/integrations/workspace-catalog'

interface WorkspaceIntegrationDetailsProps {
  app: WorkspaceAppDetail
  workspaceId: string
  workspaceName: string
  /** The workspace's credentials; absent until they load. */
  credentials: readonly WorkspaceConnectedCredential[] | undefined
  accountId: string | null
  integrationHref: string
  accountHref: (credentialId: string) => string
  pending: boolean
  onDisconnect: (credentialId: string) => Promise<unknown>
  /** Back to the app once the viewer leaves the open credential. */
  onLeave: () => void
}

interface RestrictedIntegrationProps {
  app: WorkspaceAppDetail
  workspaceId: string
}

/** Why a restricted app cannot be used, with legacy's Request access through the shared dialog. */
export function RestrictedIntegration({ app, workspaceId }: RestrictedIntegrationProps) {
  const router = useRouter()
  const [requesting, setRequesting] = useState(false)
  return (
    <>
      <ProviderHeading name={app.name} description={app.description} providerId={app.id} />
      <EmptyState
        title='Access required'
        description='Your organization restricts this integration. Ask an administrator for access.'
        action={
          <Button variant='secondary' size='compact' onClick={() => setRequesting(true)}>
            Request access
          </Button>
        }
      />
      {requesting && (
        <RequestAccessModal
          scope={{ kind: 'workspace', workspaceId }}
          target={{ kind: 'integration', id: app.type }}
          label={app.name}
          onViewRequest={(requestId) =>
            router.push(
              workspacePath(workspaceId, `settings/requests?${new URLSearchParams({ requestId })}`)
            )
          }
          onClose={() => setRequesting(false)}
        />
      )}
    </>
  )
}

/**
 * One app in a workspace, as legacy's workspace integration page served it: connect a credential
 * through the methods this deployment can complete, open a connected one to rename, share,
 * reconnect or disconnect it, and add the app's suggested skills or start from its templates.
 */
export function WorkspaceIntegrationDetails({
  app,
  workspaceId,
  workspaceName,
  credentials,
  accountId,
  integrationHref,
  accountHref,
  pending,
  onDisconnect,
  onLeave,
}: WorkspaceIntegrationDetailsProps) {
  const [replacingTokenId, setReplacingTokenId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<WorkspaceAppConnection | null>(null)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const scope: ResourceScope = { kind: 'workspace', workspaceId }
  const connected = credentials ? appCredentials(app, credentials) : []
  const selected = accountId ? connected.find((credential) => credential.id === accountId) : null
  const reconnecting = connected.find((credential) => credential.id === reconnectingId)
  const disconnecting = connected.find((credential) => credential.id === disconnectingId)
  const replacingToken = connected.find((credential) => credential.id === replacingTokenId)
  const dataverse = useDataverseReconnect(selected)
  const methods = app.connections.filter(
    (connection) =>
      connection.kind === 'oauth' ||
      connection.kind === 'personal_token' ||
      hasServiceAccountForm(connection.providerId)
  )
  const oauthFor = (providerId: string | null) =>
    app.connections.find(
      (connection) => connection.kind === 'oauth' && connection.providerId === providerId
    )
  const unavailable =
    app.access === 'unconfigured'
      ? 'Unavailable in this deployment. Contact your administrator.'
      : 'This app has no connection you can add here.'

  return (
    <>
      <ProviderHeading
        name={selected?.displayName ?? app.name}
        description={selected ? app.name : app.description}
        providerId={app.id}
      />
      {!accountId && (
        <>
          <IntegrationIdea providerId={app.id} name={app.name} example={app.example} />
          <ControlBar>
            <Button
              variant='quiet'
              size='compact'
              icon='I082'
              render={
                <Link
                  href={app.docsUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  aria-label='Docs (opens in a new tab)'
                />
              }
            >
              Docs
            </Button>
            {methods.length > 1 ? (
              <ActionMenu
                label='Connect integration'
                icon={null}
                triggerVariant='secondary'
                triggerSize='compact'
                align='end'
                disabled={pending}
                actions={methods.map((connection) => ({
                  id: connection.id,
                  label: connection.label,
                  onSelect: () => setConnecting(connection),
                }))}
              />
            ) : (
              <Button
                variant='secondary'
                size='compact'
                icon='I074'
                disabled={pending || !methods[0]}
                disabledReason={methods[0] ? undefined : unavailable}
                onClick={() => setConnecting(methods[0] ?? null)}
              >
                Connect integration
              </Button>
            )}
          </ControlBar>
        </>
      )}
      {!credentials ? null : accountId && !selected ? (
        <EmptyState
          title='This account is no longer connected.'
          action={<Chip href={integrationHref}>View integration</Chip>}
        />
      ) : selected ? (
        <WorkspaceCredentialDetails
          workspaceId={workspaceId}
          credentialId={selected.id}
          appName={app.name}
          onLeft={onLeave}
          actions={
            <>
              <Button
                variant='quiet'
                size='compact'
                disabled={
                  pending ||
                  dataverse.pending ||
                  Boolean(dataverse.blockedReason) ||
                  (selected.type !== 'personal_token' && !oauthFor(selected.providerId))
                }
                disabledReason={
                  dataverse.blockedReason ??
                  (selected.type === 'personal_token' || oauthFor(selected.providerId)
                    ? undefined
                    : `Disconnect this account and connect ${app.name} again to replace it`)
                }
                onClick={() =>
                  selected.type === 'personal_token'
                    ? setReplacingTokenId(selected.id)
                    : setReconnectingId(selected.id)
                }
              >
                Reconnect
              </Button>
              <Button
                variant='quiet'
                destructive
                size='compact'
                disabled={pending}
                onClick={() => setDisconnectingId(selected.id)}
              >
                Disconnect
              </Button>
            </>
          }
        />
      ) : connected.length > 0 ? (
        <ConnectedCredential
          providerId={app.id}
          accounts={connected.map((credential) => ({
            id: credential.id,
            label: credential.displayName,
            description: credential.description ?? undefined,
            status: 'active',
            canReconnect: Boolean(oauthFor(credential.providerId)),
            hasToolPermissions: false,
            sites: [],
            href: accountHref(credential.id),
          }))}
        />
      ) : (
        <EmptyState
          title='No connected credentials'
          description={
            methods.length ? `Connect ${app.name} to use it in ${workspaceName}.` : unavailable
          }
        />
      )}
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
      {!accountId && (
        <WorkspaceCapabilities
          workspaceId={workspaceId}
          skills={app.skills}
          templates={app.templates}
        />
      )}
      {connecting?.kind === 'personal_token' && (
        <PersonalTokenModal workspaceId={workspaceId} onClose={() => setConnecting(null)} />
      )}
      {replacingToken && (
        <PersonalTokenModal
          workspaceId={workspaceId}
          replacing={{
            credentialId: replacingToken.id,
            instanceUrl: replacingToken.instanceUrl,
          }}
          onClose={() => setReplacingTokenId(null)}
        />
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
      {disconnecting && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setDisconnectingId(null)
          }}
          title={`Disconnect ${app.name}`}
          variant='confirm'
          destructive
          description={`Disconnect ${disconnecting.displayName} from ${workspaceName}. Workflows using this account will lose access. You can reconnect later.`}
          confirmLabel='Disconnect'
          onConfirm={() => onDisconnect(disconnecting.id)}
        />
      )}
    </>
  )
}
