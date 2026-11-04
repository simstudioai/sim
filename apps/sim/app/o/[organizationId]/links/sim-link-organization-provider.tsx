'use client'

import { createContext, type ReactNode, useContext } from 'react'

const SimLinkOrganizationContext = createContext<string | null>(null)

interface SimLinkOrganizationProviderProps {
  /** Where `sim/<name>` resolves for this session, or null when it resolves nowhere. */
  organizationId: string | null
  children: ReactNode
}

/** Scopes Sim link shortcuts to the organization whose links `sim/` opens for the viewer. */
export function SimLinkOrganizationProvider({
  organizationId,
  children,
}: SimLinkOrganizationProviderProps) {
  return (
    <SimLinkOrganizationContext.Provider value={organizationId}>
      {children}
    </SimLinkOrganizationContext.Provider>
  )
}

/** The organization a new or copied Sim link belongs to; null hides every Sim link shortcut. */
export function useSimLinkOrganizationId(): string | null {
  return useContext(SimLinkOrganizationContext)
}
