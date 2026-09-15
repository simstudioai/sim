'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { useMothershipChatEvents } from '@/hooks/use-mothership-chat-events'
import { useSeedDeploymentShape } from '@/hooks/use-seed-deployment-shape'

const OrganizationContextValue = createContext<OrganizationSurfaceContext | null>(null)

interface OrganizationProviderProps {
  children: ReactNode
  context: OrganizationSurfaceContext
}

/**
 * Provides the route-resolved organization and the viewer's standing in it to the
 * organization surface, and seeds the context's deployment shape before any child
 * renders, as the workspace host provider does for workspace routes. The layout
 * resolves the context on the server, so the first paint already knows the
 * organization's name, logo, and which features this deployment serves.
 */
export function OrganizationProvider({ children, context }: OrganizationProviderProps) {
  useSeedDeploymentShape(context.deployment)
  useMothershipChatEvents(
    context.searchAccess.memberScoped ? { organizationId: context.organization.id } : undefined,
    context.deployment.chatEnabled
  )
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
