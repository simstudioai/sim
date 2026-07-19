'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { ResourceGrants, ResourceHost, ResourceKind, ResourceSource } from '@/resources'

/** The three axes, resolved once by whoever mounts a resource view. */
export interface ResourceContextValue<K extends ResourceKind = ResourceKind> {
  readonly source: ResourceSource<K>
  readonly grants: ResourceGrants
  readonly host: ResourceHost
  /**
   * Sends the viewer to an in-app path — the router half of {@link ResourceHost}.
   *
   * Targets come from `source.hrefFor`; this only performs the move, and only
   * because a unit must never hold a router of its own: `useRouter()` inside a
   * view silently assumes it is mounted under a workspace route, which is true
   * in exactly two of the three hosts. A `'public'` host supplies nothing, so
   * navigation is inert there by construction rather than by a check at every
   * call site.
   */
  readonly navigate: (path: string) => void
}

/** A host that owns no router. Module scope, so the context value stays stable. */
function noNavigation(): void {}

/**
 * Deliberately has no default that silently works. A default would let a
 * renderer mounted outside a provider resolve one context's URLs while
 * rendering in the other's — the exact failure this seam exists to make
 * impossible — so the absence is a thrown error instead.
 */
const ResourceContext = createContext<ResourceContextValue | null>(null)

export interface ResourceProviderProps<K extends ResourceKind>
  extends Omit<ResourceContextValue<K>, 'navigate'> {
  children: ReactNode
  /**
   * How this host moves the viewer. Omit it when the host owns no router — a
   * public share has no workspace route to send anyone to.
   *
   * Pass a stable reference (`router.push`, or a `useCallback`); an inline
   * arrow re-creates the context value on every render of the host.
   */
  onNavigate?: (path: string) => void
}

export function ResourceProvider<K extends ResourceKind>({
  source,
  grants,
  host,
  onNavigate,
  children,
}: ResourceProviderProps<K>) {
  const value = useMemo<ResourceContextValue>(
    () => ({ source, grants, host, navigate: onNavigate ?? noNavigation }),
    [source, grants, host, onNavigate]
  )

  return <ResourceContext.Provider value={value}>{children}</ResourceContext.Provider>
}

/**
 * The axes of the resource this subtree is rendering, over every kind. Views
 * that need a concrete {@link ResourceKind} use {@link useResourceOfKind};
 * nothing here widens a share source into an addressable one.
 */
export function useResource(): ResourceContextValue {
  const value = useContext(ResourceContext)
  if (!value) {
    throw new Error(
      'useResource must be rendered inside a <ResourceProvider>. Mount the view with an explicit source, grants, and host.'
    )
  }
  return value
}

/**
 * The mounted resource, or `null` when there is none.
 *
 * For leaves that a resource view shares with surfaces that render no resource
 * at all — the markdown image node view renders inside a file, and inside a
 * standalone markdown field in a modal. Everything that only ever renders under
 * a view uses {@link useResource} so a missing provider fails loudly.
 */
export function useOptionalResource(): ResourceContextValue | null {
  return useContext(ResourceContext)
}

/**
 * The mounted resource, narrowed to one kind.
 *
 * `ResourceSource`'s `kind` is not a discriminant across kinds, so nothing
 * downstream can narrow on its own — this is the one place it happens. A
 * renderer mounted against another kind fails loudly here rather than silently
 * addressing the wrong routes.
 */
export function useResourceOfKind<K extends ResourceKind>(kind: K): ResourceContextValue<K> {
  const value = useResource()
  if (value.source.kind !== kind) {
    throw new Error(`A ${kind} renderer was mounted against a ${value.source.kind} resource.`)
  }
  return value as ResourceContextValue<K>
}

/**
 * The mounted resource of one kind, or `null` when this subtree is not inside
 * one — for leaves a view shares with surfaces that mount no resource at all.
 */
export function useOptionalResourceOfKind<K extends ResourceKind>(
  kind: K
): ResourceContextValue<K> | null {
  const value = useOptionalResource()
  if (!value || value.source.kind !== kind) return null
  return value as ResourceContextValue<K>
}
