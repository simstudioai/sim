'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { SocketProvider } from '@/components/workspace-providers/socket-provider'
import { useSession } from '@/lib/auth/client'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { SourceHistoryProvider } from '@/hooks/sim-search/source-history'
import { useMothershipChatEvents } from '@/hooks/use-mothership-chat-events'
import { useSeedDeploymentShape } from '@/hooks/use-seed-deployment-shape'
import { connectWorkflowStores } from '@/stores/workflows/state-port/connect-stores'

// The socket provider and the organization chat read workflow state through its port.
connectWorkflowStores()

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
  const { data: session } = useSession()
  useSeedDeploymentShape(context.deployment)
  useMothershipChatEvents(
    context.mothershipAvailable || context.searchAccess.memberScoped
      ? { organizationId: context.organization.id }
      : undefined,
    context.deployment.chatEnabled
  )
  return (
    <OrganizationContextValue.Provider value={context}>
      <SocketProvider
        user={
          session?.user
            ? {
                id: session.user.id,
                name: session.user.name ?? undefined,
                email: session.user.email,
              }
            : undefined
        }
      >
        <SourceHistoryProvider
          organizationId={context.searchAccess.memberScoped ? context.organization.id : undefined}
          userId={session?.user?.id}
        >
          {children}
        </SourceHistoryProvider>
      </SocketProvider>
    </OrganizationContextValue.Provider>
  )
}

export function useOrganization(): OrganizationSurfaceContext {
  const context = useContext(OrganizationContextValue)
  if (!context) {
    throw new Error('useOrganization must be used within OrganizationProvider')
  }
  return context
}

export function useOptionalOrganization(): OrganizationSurfaceContext | null {
  return useContext(OrganizationContextValue)
}
