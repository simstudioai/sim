'use client'

import { createContext, useContext } from 'react'

/**
 * The organization the rendering shell belongs to, which the workspace list sends so its creation
 * policy and default workspace target the same organization the shell's server render seeded.
 * Unset outside a shell, where the list decides in the viewer's landing organization.
 */
export const WorkspaceListOrganizationContext = createContext<string | undefined>(undefined)

export function useWorkspaceListOrganizationId(): string | undefined {
  return useContext(WorkspaceListOrganizationContext)
}
