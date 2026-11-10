'use client'

import { type ReactNode, useState } from 'react'
import { Modal } from '@sim/emcn/modal'
import { ConnectionAccess } from '@/app/(product)/o/[organizationId]/integrations/_components/connection-access/connection-access'
import { CredentialDetail } from '@/app/(product)/o/[organizationId]/integrations/_components/credential-detail/credential-detail'
import { WorkspaceCapabilities } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-capabilities/workspace-capabilities'
import {
  type ConnectMethod,
  LiveIntegrationDetails,
} from '@/app/(product)/o/[organizationId]/integrations/_components/live-integration-details/live-integration-details'
import {
  useWorkspaceAppCredentials,
  WorkspaceAppDialogs,
  type WorkspaceAppScope,
  WorkspaceCredentialPage,
} from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/workspace-app-credentials'
import { useIntegrationViewer } from '@/platform/lib/data/integration-credentials'
import { toMemberAccountCredential } from '@/platform/lib/data/integration-credentials-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import { UNCONFIGURED_APP_REASON } from '@/platform/lib/integrations/workspace-catalog'
import { isConnectable, type OrganizationIntegration } from '@/platform/shared/integrations'

interface IntegrationDetailsProps {
  /** The member's own accounts for this app, where the organization keeps member accounts. */
  integration?: OrganizationIntegration
  /**
   * The app in the chosen workspace's catalog, whose credentials the page lists too. The page shows
   * an app from either source, so it renders nothing with neither.
   */
  workspaceApp?: WorkspaceAppScope
  accountId: string | null
  integrationHref: string
  /** A credential's own page on this app. */
  accountHref: (credentialId: string) => string
  pending: boolean
  onConnect: () => void
  onReconnect: (accountId: string) => void
  /** Removes a member account or a workspace credential, whichever the id names. */
  onDisconnect: (credentialId: string) => Promise<unknown>
  /** Back to the app once the viewer leaves an open workspace credential. */
  onLeave: () => void
  renderToolPermissions: (accountId: string) => ReactNode
}

/**
 * An app's page: the member's own accounts and the chosen workspace's credentials in one list, each
 * opening to its details, access and tool permissions, the ways to connect either, and the
 * workspace's suggested skills and templates for the app.
 */
export function IntegrationDetails({
  integration,
  workspaceApp,
  accountId,
  integrationHref,
  accountHref,
  pending,
  onConnect,
  onReconnect,
  onDisconnect,
  onLeave,
  renderToolPermissions,
}: IntegrationDetailsProps) {
  const viewer = useIntegrationViewer()
  const workspace = useWorkspaceAppCredentials(workspaceApp, accountId)
  const [connecting, setConnecting] = useState(false)
  const accounts = integration?.accounts ?? []
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const memberCredentials = integration
    ? viewer &&
      accounts.map((account) =>
        toMemberAccountCredential(account, {
          appId: integration.id,
          providerId: integration.providerId,
          viewerId: viewer.id,
        })
      )
    : []
  const credentials =
    memberCredentials && workspace.credentials
      ? [...memberCredentials, ...workspace.credentials]
      : undefined
  const memberMethods: ConnectMethod[] =
    integration?.connectionTarget && isConnectable(integration)
      ? [
          {
            id: 'member-account',
            label: 'Personal account',
            oauth: !('savedProviderId' in integration.connectionTarget),
            onSelect: () => setConnecting(true),
          },
        ]
      : []
  const workspaceMethods: ConnectMethod[] = workspace.methods.map((method) => ({
    ...method,
    label:
      memberMethods.length && workspaceApp
        ? `${method.label} (${workspaceApp.workspace.name})`
        : method.label,
  }))
  const memberReason =
    integration?.availability === 'managed'
      ? `Managed by your organization. ${integration.accessDescription}`
      : integration?.status
  const app = integration
    ? {
        providerId: integration.providerId,
        icon: integration.icon,
        name: integration.name,
        description: integration.description,
        docsUrl: integration.setupGuideUrl,
      }
    : workspaceApp && {
        providerId: workspaceApp.app.id,
        name: workspaceApp.app.name,
        description: workspaceApp.app.description,
        docsUrl: workspaceApp.app.docsUrl,
      }
  if (!app) return null

  const renderCredential = (credential: IntegrationCredential, disconnect: () => void) => {
    const account = accountById.get(credential.id)
    if (account && viewer)
      return (
        <CredentialDetail
          key={credential.id}
          credential={credential}
          integrationName={app.name}
          providerId={app.providerId}
          viewer={viewer}
          onReconnect={account.canReconnect ? () => onReconnect(account.id) : undefined}
          onDisconnect={disconnect}
          permissions={account.hasToolPermissions ? renderToolPermissions(account.id) : undefined}
          sites={account.sites}
        />
      )
    if (!workspaceApp) return null
    return (
      <WorkspaceCredentialPage
        key={credential.id}
        workspaceId={workspaceApp.workspace.id}
        credential={credential}
        appName={workspaceApp.app.name}
        providerId={workspaceApp.app.id}
        onReconnect={credential.canReconnect ? () => workspace.reconnect(credential) : undefined}
        onDisconnect={disconnect}
        onLeft={onLeave}
      />
    )
  }

  return (
    <>
      <LiveIntegrationDetails
        app={{
          ...app,
          example:
            workspaceApp?.app.example ??
            `${app.description.replace(/[.!?]+$/, '')}. Bring that context into your next conversation with Sim.`,
        }}
        credentials={credentials}
        accountId={accountId}
        integrationHref={integrationHref}
        credentialHref={(credential) => accountHref(credential.id)}
        methods={[...memberMethods, ...workspaceMethods]}
        unavailableReason={
          integration
            ? integration.connectionTarget && memberReason
            : workspaceUnavailableReason(workspaceApp?.app)
        }
        emptyNotice={
          integration && !isConnectable(integration) && !workspaceMethods.length
            ? memberReason
            : undefined
        }
        pending={pending}
        renderCredential={renderCredential}
        onDisconnect={(credential) => onDisconnect(credential.id)}
        capabilities={
          workspaceApp && (
            <WorkspaceCapabilities
              workspaceId={workspaceApp.workspace.id}
              skills={workspaceApp.app.skills}
              templates={workspaceApp.app.templates}
            />
          )
        }
      />
      {workspaceApp && (
        <WorkspaceAppDialogs
          app={workspaceApp.app}
          workspaceId={workspaceApp.workspace.id}
          dialogs={workspace.dialogs}
        />
      )}
      {integration && connecting && (
        <Modal
          open
          title={`Connect ${app.name}`}
          confirmLabel='Continue'
          confirmDisabled={pending || !isConnectable(integration)}
          onOpenChange={setConnecting}
          onConfirm={onConnect}
        >
          <ConnectionAccess
            permissions={integration.requestedScopes ?? integration.searchReads}
            title={
              integration.requestedScopes?.length ? 'Requested permissions' : 'Connection access'
            }
          />
        </Modal>
      )}
    </>
  )
}

/**
 * Why a workspace app offers no way to connect, on its disabled Connect: one this deployment has not
 * configured, or one whose catalog lists connections this page cannot complete. An app the catalog
 * lists no connection for has nothing to connect, so no Connect shows at all.
 */
function workspaceUnavailableReason(app: WorkspaceAppScope['app'] | undefined) {
  if (app?.access === 'unconfigured') return UNCONFIGURED_APP_REASON
  return app?.credentialProviders.length
    ? 'This app has no connection you can add here.'
    : undefined
}
