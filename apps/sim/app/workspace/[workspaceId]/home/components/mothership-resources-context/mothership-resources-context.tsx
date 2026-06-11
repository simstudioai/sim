'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'

/**
 * Resource-management operations for the Mothership resource panel. Provided
 * by the home surface (which owns the resource state via `useChat`) and
 * consumed at the leaves (`ResourceTabs`, `MothershipView`) so the operations
 * do not have to be relayed through intermediate components.
 */
interface MothershipResourcesContextValue {
  /** Makes the given resource the active tab. */
  selectResource: (id: string) => void
  /** Adds a resource to the panel and activates it. */
  addResource: (resource: MothershipResource) => void
  /** Removes a resource from the panel. */
  removeResource: (resourceType: MothershipResourceType, resourceId: string) => void
  /** Replaces the resource list with a new ordering. */
  reorderResources: (resources: MothershipResource[]) => void
  /** Collapses the resource panel. */
  collapseResource: () => void
}

const MothershipResourcesContext = createContext<MothershipResourcesContextValue | null>(null)

interface MothershipResourcesProviderProps extends MothershipResourcesContextValue {
  children: ReactNode
}

/**
 * Provides resource-management operations to the resource panel subtree. All
 * operations are expected to be referentially stable; the context value is
 * memoized on their identities.
 */
export function MothershipResourcesProvider({
  selectResource,
  addResource,
  removeResource,
  reorderResources,
  collapseResource,
  children,
}: MothershipResourcesProviderProps) {
  const value = useMemo<MothershipResourcesContextValue>(
    () => ({ selectResource, addResource, removeResource, reorderResources, collapseResource }),
    [selectResource, addResource, removeResource, reorderResources, collapseResource]
  )

  return (
    <MothershipResourcesContext.Provider value={value}>
      {children}
    </MothershipResourcesContext.Provider>
  )
}

/**
 * Reads the resource-management operations for the surrounding resource panel.
 * Must be called under a {@link MothershipResourcesProvider}.
 */
export function useMothershipResources(): MothershipResourcesContextValue {
  const value = useContext(MothershipResourcesContext)
  if (!value) {
    throw new Error('useMothershipResources must be used within a MothershipResourcesProvider')
  }
  return value
}
