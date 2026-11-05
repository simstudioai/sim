'use client'

import type { ReactNode } from 'react'
import { CredentialWorkspaceContext } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/credential-workspace-context'
import { ResourceWorkspaceHost } from '@/app/workspace/[workspaceId]/home/components/resource-workspace-host'

export { useCredentialWorkspaceId } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/credential-workspace-context'

export function CredentialWorkspaceHost({
  workspaceId,
  organizationId,
  children,
}: {
  workspaceId: string
  organizationId: string
  children: ReactNode
}) {
  return (
    <ResourceWorkspaceHost workspaceId={workspaceId} organizationId={organizationId}>
      <CredentialWorkspaceContext.Provider value={workspaceId}>
        {children}
      </CredentialWorkspaceContext.Provider>
    </ResourceWorkspaceHost>
  )
}
