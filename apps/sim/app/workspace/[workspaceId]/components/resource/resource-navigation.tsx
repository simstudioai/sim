'use client'

import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

/** The selected environment supplies identity when a list is embedded. */
export function useResourceWorkspaceId() {
  const host = useOptionalWorkspaceHostContext()
  const params = useParams<{ workspaceId?: string }>()
  return host?.workspace.id ?? params?.workspaceId ?? ''
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

/** Adds the project's directory crumb without replacing the list's folder navigation. */
export function ResourceListHeader(props: ComponentProps<typeof Resource.Header>) {
  const navigation = useContext(ResourceNavigationContext)
  if (!navigation) return <Resource.Header {...props} />
  const drop = props.breadcrumbDrop
  return (
    <Resource.Header
      {...props}
      title={undefined}
      breadcrumbs={[
        { label: 'Resources', onClick: navigation.onDirectory },
        ...(props.breadcrumbs ?? [{ label: props.title ?? '', icon: props.icon }]),
      ]}
      breadcrumbDrop={
        drop
          ? {
              ...drop,
              activeIndex: drop.activeIndex === null ? null : drop.activeIndex + 1,
              onDragOver: (event, folderId, index) => drop.onDragOver(event, folderId, index - 1),
              onDragLeave: (event, index) => drop.onDragLeave(event, index - 1),
            }
          : undefined
      }
    />
  )
}

/** Returns the containing pane’s resource opener when a list is embedded. */
export function useResourceListOpen() {
  return useContext(ResourceNavigationContext)?.openResource
}
