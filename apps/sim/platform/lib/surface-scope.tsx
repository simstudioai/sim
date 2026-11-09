'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { SurfaceScope } from '@/platform/lib/data/organization-model'

const RoutePrefixContext = createContext<string | null>(null)

interface SurfaceScopeProviderProps extends SurfaceScope {
  children: ReactNode
}

/** The organization's route prefix for every product view, on example and live data alike. */
export function SurfaceScopeProvider({ routePrefix, children }: SurfaceScopeProviderProps) {
  return <RoutePrefixContext.Provider value={routePrefix}>{children}</RoutePrefixContext.Provider>
}

/** The scope `surfaceHref` builds organization paths from, inside `ProductSession`. */
export function useSurfaceScope(): SurfaceScope {
  const routePrefix = useContext(RoutePrefixContext)
  if (routePrefix === null) throw new Error('useSurfaceScope must be used within ProductSession')
  return { routePrefix }
}
