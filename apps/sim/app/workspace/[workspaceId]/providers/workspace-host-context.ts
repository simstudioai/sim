'use client'

import { createContext, useContext } from 'react'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'

export const WorkspaceHostContextValue = createContext<WorkspaceHostContext | null>(null)

/** Returns route-derived host context when called inside a workspace route. */
export function useOptionalWorkspaceHostContext(): WorkspaceHostContext | null {
  return useContext(WorkspaceHostContextValue)
}
