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
import { useWorkspaceAppCredentials } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/workspace-app-credentials'
import { useIntegrationViewer } from '@/platform/lib/data/integration-credentials'
import {
  type AppWorkspaceCredential,
  toMemberAccountCredential,
} from '@/platform/lib/data/integration-credentials-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import type { WorkspaceAppDetail } from '@/platform/lib/integrations/workspace-catalog'
import { isConnectable, type OrganizationIntegration } from '@/platform/shared/integrations'

interface IntegrationDetailsProps {
  integration: OrganizationIntegration
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
  /** The app in the chosen workspace's catalog, whose credentials the page lists too. */
  workspaceApp?: WorkspaceAppProps
}

interface WorkspaceAppProps {
  app: WorkspaceAppDetail
  workspace: { id: string; name: string }
  credentials: readonly AppWorkspaceCredential[] | undefined
}

/**
 * A member integration's page: the member's own accounts, each opening to its details, access and
 * tool permissions, and, where the chosen workspace may use the app, that workspace's credentials.
 */
export function IntegrationDetails({
  integration,
  accountId,
  integrationHref,
  accountHref,
  pending,
  onConnect,
  onReconnect,
  onDisconnect,
  onLeave,
  renderToolPermissions,
  workspaceApp,
}: IntegrationDetailsProps) {
  const viewer = useIntegrationViewer()
  const workspace = useWorkspaceAppCredentials({
    app: workspaceApp?.app,
    workspace: workspaceApp?.workspace,
    credentials: workspaceApp?.credentials,
    accountId,
  })
  const [connecting, setConnecting] = useState(false)
  const { accounts, connectionTarget, name } = integration
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const memberCredentials = viewer
    ? accounts.map((account) =>
        toMemberAccountCredential(account, {
          appId: integration.id,
          providerId: integration.providerId,
          viewerId: viewer.id,
        })
      )
    : undefined
  const credentials =
    memberCredentials && workspace.credentials
      ? [...memberCredentials, ...workspace.credentials]
      : undefined
  const memberMethods: ConnectMethod[] =
    connectionTarget && isConnectable(integration)
      ? [
          {
            id: 'member-account',
            label: 'Personal account',
            oauth: !('savedProviderId' in connectionTarget),
            onSelect: () => setConnecting(true),
          },
        ]
      : []
  const workspaceMethods = workspace.methods.map((method) => ({
    id: method.id,
    label:
      memberMethods.length && workspaceApp
        ? `${method.label} (${workspaceApp.workspace.name})`
        : method.label,
    oauth: method.oauth,
    onSelect: method.onSelect,
  }))
  const reason =
    integration.availability === 'managed'
      ? `Managed by your organization. ${integration.accessDescription}`
      : integration.status

  function renderMemberAccount(credential: IntegrationCredential, disconnect: () => void) {
    const account = accountById.get(credential.id)
    if (!account || !viewer) return null
    return (
      <CredentialDetail
        key={credential.id}
        credential={credential}
        integrationName={name}
        providerId={integration.providerId}
        viewer={viewer}
        people={[]}
        // Only its owner holds a member account, so nothing here proposes an edit.
        onChange={() => undefined}
        onLeave={() => undefined}
        detailsReadOnly
        onReconnect={account.canReconnect ? () => onReconnect(account.id) : undefined}
        onDisconnect={disconnect}
        permissions={account.hasToolPermissions ? renderToolPermissions(account.id) : undefined}
      />
    )
  }

  return (
    <>
      <LiveIntegrationDetails
        app={{
          providerId: integration.providerId,
          icon: integration.icon,
          name,
          description: integration.description,
          docsUrl: integration.setupGuideUrl,
          example:
            workspaceApp?.app.example ??
            (integration.providerId === 'fireflies'
              ? 'Use Fireflies to remember the interests prospects mention on calls. Turn those details into thoughtful gifts and personal follow-ups.'
              : `${integration.description.replace(/[.!?]+$/, '')}. Bring that context into your next conversation with Sim.`),
        }}
        credentials={credentials}
        accountId={accountId}
        integrationHref={integrationHref}
        credentialHref={(credential) => accountHref(credential.id)}
        methods={[...memberMethods, ...workspaceMethods]}
        unavailableReason={connectionTarget ? reason : undefined}
        emptyNotice={isConnectable(integration) ? undefined : reason}
        pending={pending}
        renderCredential={(credential, disconnect) =>
          accountById.has(credential.id)
            ? renderMemberAccount(credential, disconnect)
            : workspace.renderCredential(credential, disconnect, onLeave)
        }
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
      {workspace.dialogs}
      {connecting && (
        <Modal
          open
          title={`Connect ${name}`}
          description={`Review access before continuing to ${name}.`}
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
