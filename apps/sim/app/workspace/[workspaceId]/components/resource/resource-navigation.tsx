'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

/** The selected environment supplies identity when a list is embedded. */
export function useResourceWorkspaceId() {
  const host = useOptionalWorkspaceHostContext()
  const params = useParams<{ workspaceId?: string }>()
  return host?.workspace.id ?? params?.workspaceId ?? ''
}

/** A Logs link addressed to one run opens that run, as the Logs page opens its details. */
export function runResourceFromHref(url: URL, workspaceId: string): MothershipResource | null {
  const executionId = url.searchParams.get('executionId')
  if (!executionId) return null
  return { type: 'log', id: executionId, executionId, title: 'Run', workspaceId }
}

interface ResourceNavigation {
  openResource: (resource: MothershipResource) => void
  onDirectory: () => void
  /** Handles workspace destinations within a containing resource pane. */
  navigate: (href: string, replace?: boolean) => void
}

const ResourceNavigationContext = createContext<ResourceNavigation | null>(null)

interface ResourceNavigationProviderProps extends ResourceNavigation {
  children: ReactNode
}

export function ResourceNavigationProvider({
  children,
  navigate,
  openResource,
  onDirectory,
}: ResourceNavigationProviderProps) {
  const value = useMemo(
    () => ({ navigate, openResource, onDirectory }),
    [navigate, openResource, onDirectory]
  )
  return (
    <ResourceNavigationContext.Provider value={value}>
      {children}
    </ResourceNavigationContext.Provider>
  )
}

/** Existing list actions use the same navigation in a route or in an embedded project. */
export function useResourceRouter() {
  const router = useRouter()
  const navigation = useContext(ResourceNavigationContext)
  const push = useCallback(
    (href: string) => {
      if (navigation) navigation.navigate(href)
      else router.push(href)
    },
    [navigation, router]
  )
  const replace = useCallback(
    (href: string) => {
      if (navigation) navigation.navigate(href, true)
      else router.replace(href)
    },
    [navigation, router]
  )
  return useMemo(() => ({ ...router, push, replace }), [router, push, replace])
}

/** The containing pane's directory, when a list is embedded in one. */
export function useResourceDirectory() {
  return useContext(ResourceNavigationContext)?.onDirectory
}

/** Returns the containing pane’s resource opener when a list is embedded. */
export function useResourceListOpen() {
  return useContext(ResourceNavigationContext)?.openResource
}
