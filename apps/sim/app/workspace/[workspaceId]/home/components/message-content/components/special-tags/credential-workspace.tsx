'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { useParams } from 'next/navigation'
import { ResourceWorkspaceHost } from '@/app/workspace/[workspaceId]/home/components/resource-workspace-host'

const CredentialWorkspaceContext = createContext<string | undefined>(undefined)

/** Only an authorized card host may override the workspace route. */
export function useCredentialWorkspaceId(): string {
  const explicit = useContext(CredentialWorkspaceContext)
  const params = useParams<{ workspaceId?: string; organizationId?: string }>()
  return explicit ?? (params.organizationId ? '' : (params.workspaceId ?? ''))
}

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
