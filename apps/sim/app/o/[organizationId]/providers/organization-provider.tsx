'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'

const OrganizationContextValue = createContext<OrganizationSurfaceContext | null>(null)

interface OrganizationProviderProps {
  children: ReactNode
  context: OrganizationSurfaceContext
}

/**
 * Provides the route-resolved organization and the viewer's standing in it to the
 * organization surface. The layout resolves both on the server, so the first paint
 * already knows the organization's name and logo.
 */
export function OrganizationProvider({ children, context }: OrganizationProviderProps) {
  return (
    <OrganizationContextValue.Provider value={context}>
      {children}
    </OrganizationContextValue.Provider>
  )
}

export function useOrganizationContext(): OrganizationSurfaceContext {
  const context = useContext(OrganizationContextValue)
  if (!context) {
    throw new Error('useOrganizationContext must be used within OrganizationProvider')
  }
  return context
}

export function useOptionalOrganizationContext(): OrganizationSurfaceContext | null {
  return useContext(OrganizationContextValue)
}
