'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useTransition,
} from 'react'
import { useRouter } from 'next/navigation'

interface SettingsNavigationState {
  /** The section a sidebar click is navigating to, until that navigation settles. */
  pendingSection: string | null
  /** Navigates to a section, previewing `pendingSection` until it settles; null previews nothing. */
  navigateToSection: (pendingSection: string | null, href: string) => void
  /** Hands a sidebar row's navigation intent to the mounted settings layout's handler, if any. */
  signalIntent: (section: string) => void
  registerIntentHandler: (handler: (section: string) => void) => () => void
}

const SettingsNavigationContext = createContext<SettingsNavigationState | null>(null)

interface SettingsNavigationProviderProps {
  children: ReactNode
}

/**
 * Shares an in-flight settings section navigation between the sidebar that starts it and the
 * content area that previews it.
 *
 * Section routes have no loading boundary (see the workspace section layout), so without this the
 * outgoing section stays on screen for the whole round trip. The pending section is optimistic
 * state set inside the navigation's own transition: React drops it the moment that transition
 * settles — on commit, and equally when the server redirects back or the navigation fails — and
 * because it is state rather than a Suspense fallback, the incoming section is never held back.
 */
export function SettingsNavigationProvider({ children }: SettingsNavigationProviderProps) {
  const router = useRouter()
  const [pendingSection, setPendingSection] = useOptimistic<string | null>(null)
  const [, startTransition] = useTransition()

  const navigateToSection = useCallback(
    (section: string | null, href: string) => {
      startTransition(() => {
        setPendingSection(section)
        router.replace(href, { scroll: false })
      })
    },
    [router, setPendingSection]
  )

  const intentHandlerRef = useRef<((section: string) => void) | null>(null)
  const signalIntent = useCallback((section: string) => intentHandlerRef.current?.(section), [])
  const registerIntentHandler = useCallback((handler: (section: string) => void) => {
    intentHandlerRef.current = handler
    return () => {
      if (intentHandlerRef.current === handler) intentHandlerRef.current = null
    }
  }, [])

  const value = useMemo(
    () => ({ pendingSection, navigateToSection, signalIntent, registerIntentHandler }),
    [pendingSection, navigateToSection, signalIntent, registerIntentHandler]
  )

  return (
    <SettingsNavigationContext.Provider value={value}>
      {children}
    </SettingsNavigationContext.Provider>
  )
}

export function useSettingsNavigationState(): SettingsNavigationState {
  const state = useContext(SettingsNavigationContext)
  if (!state) {
    throw new Error('useSettingsNavigationState must be used within a SettingsNavigationProvider')
  }
  return state
}

/**
 * Registers the mounted settings layout's warmer for sidebar navigation intent. The settings route
 * owns it, not the sidebar, so warming every section's chunk and data adds nothing to the
 * workspace chrome's module graph, which every workspace page loads.
 */
export function useSettingsIntentHandler(handler: (section: string) => void): void {
  const { registerIntentHandler } = useSettingsNavigationState()
  useEffect(() => registerIntentHandler(handler), [registerIntentHandler, handler])
}
