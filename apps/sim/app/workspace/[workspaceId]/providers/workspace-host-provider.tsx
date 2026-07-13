'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { isApiClientError } from '@/lib/api/client/errors'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { WorkspaceAccessDenied } from '@/app/workspace/[workspaceId]/components/workspace-access-denied'
import { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'

const WorkspaceHostContextValue = createContext<WorkspaceHostContext | null>(null)

interface WorkspaceHostProviderProps {
  children: ReactNode
  workspaceId: string
  initialContext: WorkspaceHostContext
}

/**
 * Provides route-derived workspace host identity and entitlements to workspace
 * UI. A later 403 (for example after access is revoked) replaces the workspace
 * tree with an explicit denial instead of navigating to another workspace.
 */
export function WorkspaceHostProvider({
  children,
  workspaceId,
  initialContext,
}: WorkspaceHostProviderProps) {
  const { data, error } = useWorkspaceHostContextQuery(workspaceId)

  if (isApiClientError(error) && error.status === 403) {
    return <WorkspaceAccessDenied />
  }

  return (
    <WorkspaceHostContextValue.Provider value={data ?? initialContext}>
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
