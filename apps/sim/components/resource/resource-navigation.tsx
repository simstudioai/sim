'use client'

import { createContext, useCallback, useContext, useMemo } from 'react'
import { useRouter } from 'next/navigation'

interface ResourceNavigation {
  /** Handles workspace destinations within a containing resource pane. */
  navigate: (href: string, replace?: boolean) => void
}

/** Provided by a containing resource pane; absent on the routed pages. */
const ResourceNavigationContext = createContext<ResourceNavigation | null>(null)

/** Navigates the route, or the containing resource pane when one provides navigation. */
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
