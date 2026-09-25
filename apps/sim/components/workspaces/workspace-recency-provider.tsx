'use client'

import { createContext, useContext } from 'react'

const EMPTY_RECENT_WORKSPACE_IDS: readonly string[] = []

const WorkspaceRecencyContext = createContext<readonly string[]>(EMPTY_RECENT_WORKSPACE_IDS)

interface WorkspaceRecencyProviderProps {
  /** Most-recent-first workspace ids read from the recency cookie by the layout. */
  recentWorkspaceIds: readonly string[]
  children: React.ReactNode
}

/**
 * Hands the server-read visit order to the workspace lists so server render and
 * hydration agree with the order the browser's visit history applies after it.
 */
export function WorkspaceRecencyProvider({
  recentWorkspaceIds,
  children,
}: WorkspaceRecencyProviderProps) {
  return (
    <WorkspaceRecencyContext.Provider value={recentWorkspaceIds}>
      {children}
    </WorkspaceRecencyContext.Provider>
  )
}

export function useInitialRecentWorkspaceIds(): readonly string[] {
  return useContext(WorkspaceRecencyContext)
}
