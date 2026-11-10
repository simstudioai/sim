'use client'

import type { ReactNode } from 'react'
import { WorkspaceAccessDenied } from '@/components/workspace-access-denied'
import { WorkspaceHostContextValue } from '@/components/workspace-providers/workspace-host-context'
import { isApiClientError } from '@/lib/api/client/errors'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'
import { useSeedDeploymentShape } from '@/hooks/use-seed-deployment-shape'

interface WorkspaceHostProviderProps {
  children: ReactNode
  workspaceId: string
  initialContext: WorkspaceHostContext
}

/**
 * Provides route-derived workspace host identity and entitlements to workspace
 * UI, and seeds the server-resolved deployment shape for readers outside React
 * before any workspace child renders. A later 403 (for example after access is
 * revoked) replaces the workspace tree with an explicit denial instead of
 * navigating to another workspace.
 */
export function WorkspaceHostProvider({
  children,
  workspaceId,
  initialContext,
}: WorkspaceHostProviderProps) {
  const { data, error } = useWorkspaceHostContextQuery(workspaceId)
  const context = data ?? initialContext
  useSeedDeploymentShape(context.deployment)

  if (isApiClientError(error) && error.status === 403) {
    return <WorkspaceAccessDenied />
  }

  return (
    <WorkspaceHostContextValue.Provider value={context}>
      {children}
    </WorkspaceHostContextValue.Provider>
  )
}
