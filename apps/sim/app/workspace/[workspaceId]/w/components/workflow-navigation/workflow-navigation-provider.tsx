'use client'

import {
  createContext,
  type ReactNode,
  startTransition,
  useCallback,
  useContext,
  useOptimistic,
} from 'react'
import { useRouter } from 'next/navigation'

interface WorkflowNavigationOptions {
  replace?: boolean
  scroll?: boolean
  transitionTypes?: string[]
}

type NavigateToWorkflow = (href: string, options?: WorkflowNavigationOptions) => void

const NavigateContext = createContext<NavigateToWorkflow | null>(null)
const PendingNavigationContext = createContext(false)

interface WorkflowNavigationProviderProps {
  children: ReactNode
}

/** Shows navigation intent immediately, then lets React clear it when routing settles. */
export function WorkflowNavigationProvider({ children }: WorkflowNavigationProviderProps) {
  const router = useRouter()
  const [isNavigating, setIsNavigating] = useOptimistic(false)

  const navigate = useCallback<NavigateToWorkflow>(
    (href, options) => {
      const destination = new URL(href, window.location.href)
      const isWorkflowSwitch =
        destination.origin === window.location.origin &&
        /^\/workspace\/[^/]+\/w\/[^/]+\/?$/.test(destination.pathname) &&
        destination.pathname !== window.location.pathname

      startTransition(() => {
        setIsNavigating(isWorkflowSwitch)
        if (options?.replace) {
          router.replace(href, { scroll: options.scroll, transitionTypes: options.transitionTypes })
        } else if (options) {
          router.push(href, { scroll: options.scroll, transitionTypes: options.transitionTypes })
        } else {
          router.push(href)
        }
      })
    },
    [router, setIsNavigating]
  )

  return (
    <NavigateContext.Provider value={navigate}>
      <PendingNavigationContext.Provider value={isNavigating}>
        {children}
      </PendingNavigationContext.Provider>
    </NavigateContext.Provider>
  )
}

export function useWorkflowNavigation() {
  return useContext(NavigateContext)
}

export function usePendingWorkflowNavigation() {
  return useContext(PendingNavigationContext)
}
