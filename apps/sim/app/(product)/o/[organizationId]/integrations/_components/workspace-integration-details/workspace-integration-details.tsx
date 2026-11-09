'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { useRouter } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { RequestAccessModal } from '@/app/(product)/_components/request-access-modal/request-access-modal'
import { WorkspaceCapabilities } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-capabilities/workspace-capabilities'
import { LiveIntegrationDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/live-integration-details/live-integration-details'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import { useWorkspaceAppCredentials } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/workspace-app-credentials'
import type { AppWorkspaceCredential } from '@/platform/lib/data/integration-credentials-model'
import type { WorkspaceAppDetail } from '@/platform/lib/integrations/workspace-catalog'

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

interface WorkspaceIntegrationDetailsProps {
  app: WorkspaceAppDetail
  workspace: { id: string; name: string }
  /** The workspace's credentials; absent until they load. */
  credentials: readonly AppWorkspaceCredential[] | undefined
  accountId: string | null
  integrationHref: string
  onOpen: (credentialId: string) => void
  pending: boolean
  onDisconnect: (credentialId: string) => Promise<unknown>
  /** Back to the app once the viewer leaves the open credential. */
  onLeave: () => void
}

/**
 * One app in a workspace, as legacy's workspace integration page served it, in the example page's
 * anatomy: connect a credential through the methods this deployment can complete, open a connected
 * one to rename, share, reconnect or disconnect it, and add the app's suggested skills or start
 * from its templates.
 */
export function WorkspaceIntegrationDetails({
  app,
  workspace,
  credentials,
  accountId,
  integrationHref,
  onOpen,
  pending,
  onDisconnect,
  onLeave,
}: WorkspaceIntegrationDetailsProps) {
  const workspaceApp = useWorkspaceAppCredentials({ app, workspace, credentials, accountId })
  return (
    <>
      <LiveIntegrationDetails
        app={{ ...app, providerId: app.id }}
        credentials={workspaceApp.credentials}
        accountId={accountId}
        integrationHref={integrationHref}
        onOpen={(credential) => onOpen(credential.id)}
        methods={workspaceApp.methods}
        unavailableReason={workspaceApp.unavailableReason}
        pending={pending}
        renderCredential={(credential, disconnect) =>
          workspaceApp.renderCredential(credential, disconnect, onLeave)
        }
        onDisconnect={(credential) => onDisconnect(credential.id)}
        capabilities={
          <WorkspaceCapabilities
            workspaceId={workspace.id}
            skills={app.skills}
            templates={app.templates}
          />
        }
      />
      {workspaceApp.dialogs}
    </>
  )
}
