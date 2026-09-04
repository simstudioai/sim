'use client'

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { isApiClientError } from '@/lib/api/client/errors'
import type { DeploymentShape, WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { seedDeploymentShape } from '@/lib/core/config/deployment-shape'
import { WorkspaceAccessDenied } from '@/app/workspace/[workspaceId]/components/workspace-access-denied'
import { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'

const WorkspaceHostContextValue = createContext<WorkspaceHostContext | null>(null)

/**
 * Seeds from the provider's own render, ahead of any child, so the first workspace
 * paint already reads the server value; the effect then follows the host context as
 * it refetches. The lazy initializer is React's once-per-mount hook for work that must
 * precede children. Lives here rather than with the reader because block definitions
 * import the reader into React Server Component graphs, where React hooks are rejected.
 */
function useSeedDeploymentShape(shape: DeploymentShape | undefined): void {
  useState(() => seedDeploymentShape(shape))
  useEffect(() => {
    seedDeploymentShape(shape)
  }, [shape])
}

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

export function useWorkspaceHostContext(): WorkspaceHostContext {
  const context = useContext(WorkspaceHostContextValue)
  if (!context) {
    throw new Error('useWorkspaceHostContext must be used within a WorkspaceHostProvider')
  }
  return context
}

/** Returns route-derived host context when called inside a workspace route. */
export function useOptionalWorkspaceHostContext(): WorkspaceHostContext | null {
  return useContext(WorkspaceHostContextValue)
}
