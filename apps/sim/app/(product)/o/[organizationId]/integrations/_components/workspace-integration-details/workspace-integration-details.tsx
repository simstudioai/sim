'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { useRouter } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { RequestAccessModal } from '@/app/(product)/_components/request-access-modal/request-access-modal'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import type { WorkspaceApp } from '@/platform/lib/integrations/workspace-catalog'

interface IntegrationAccessRequestProps {
  app: Pick<WorkspaceApp, 'type' | 'name'>
  workspaceId: string
  onClose: () => void
}

/** Asks a workspace's administrators for an app its permission group withholds. */
export function IntegrationAccessRequest({
  app,
  workspaceId,
  onClose,
}: IntegrationAccessRequestProps) {
  const router = useRouter()
  return (
    <RequestAccessModal
      scope={{ kind: 'workspace', workspaceId }}
      target={{ kind: 'integration', id: app.type }}
      label={app.name}
      onViewRequest={(requestId) =>
        router.push(
          workspacePath(workspaceId, `settings/requests?${new URLSearchParams({ requestId })}`)
        )
      }
      onClose={onClose}
    />
  )
}

interface RestrictedIntegrationProps {
  app: WorkspaceApp
  workspaceId: string
}

/** Why a restricted app cannot be used, with legacy's Request access. */
export function RestrictedIntegration({ app, workspaceId }: RestrictedIntegrationProps) {
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
        <IntegrationAccessRequest
          app={app}
          workspaceId={workspaceId}
          onClose={() => setRequesting(false)}
        />
      )}
    </>
  )
}
