'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

/**
 * Resource-stage operations for the Mothership resource panel. Provided by the
 * home surface (which owns the staged resource) and consumed at the leaves
 * (`MothershipView`, embedded pages) so the operations do not have to be
 * relayed through intermediate components.
 */
interface MothershipResourcesContextValue {
  /** Stages a resource as the panel's content, replacing the current one. */
  openResource: (resource: MothershipResource) => void
  /** Clears the staged resource (the panel collapses). */
  closeResource: () => void
}

const MothershipResourcesContext = createContext<MothershipResourcesContextValue | null>(null)

interface MothershipResourcesProviderProps extends MothershipResourcesContextValue {
  children: ReactNode
}

/**
 * Provides resource-stage operations to the resource panel subtree. All
 * operations are expected to be referentially stable; the context value is
 * memoized on their identities.
 */
export function MothershipResourcesProvider({
  openResource,
  closeResource,
  children,
}: MothershipResourcesProviderProps) {
  const value = useMemo<MothershipResourcesContextValue>(
    () => ({ openResource, closeResource }),
    [openResource, closeResource]
  )

  return (
    <MothershipResourcesContext.Provider value={value}>
      {children}
    </MothershipResourcesContext.Provider>
  )
}

/**
 * Reads the resource-stage operations for the surrounding resource panel.
 * Must be called under a {@link MothershipResourcesProvider}.
 */
export function useMothershipResources(): MothershipResourcesContextValue {
  const value = useContext(MothershipResourcesContext)
  if (!value) {
    throw new Error('useMothershipResources must be used within a MothershipResourcesProvider')
  }
  return value
}
