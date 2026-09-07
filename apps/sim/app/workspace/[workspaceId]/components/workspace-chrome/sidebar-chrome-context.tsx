'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

export interface SidebarChromeState {
  /**
   * Authoritative collapse state, derived once in `WorkspaceChrome` from the
   * `sidebar_collapsed` cookie (server prop → store after hydration) so the rail's
   * structure, labels, and width all read a single source.
   */
  isCollapsed: boolean
  /**
   * True while the sidebar is rendered as the desktop hover-peek card. The card shows
   * the expanded layout even though the rail is collapsed, so a sidebar treats this
   * as overriding {@link SidebarChromeState.isCollapsed} — and separately suppresses
   * the chrome the card already provides (the title-bar lane, drag-resize).
   */
  isPeeking: boolean
}

const SidebarChromeContext = createContext<SidebarChromeState | null>(null)

interface SidebarChromeProviderProps extends SidebarChromeState {
  children: ReactNode
}

/**
 * Hands the chrome's collapse and peek state to whichever sidebar it hosts. The
 * chrome owns that state; the sidebar is passed in as an element, so it cannot take
 * the values as props from a server layout — it reads them here instead.
 */
export function SidebarChromeProvider({
  isCollapsed,
  isPeeking,
  children,
}: SidebarChromeProviderProps) {
  const value = useMemo(() => ({ isCollapsed, isPeeking }), [isCollapsed, isPeeking])
  return <SidebarChromeContext.Provider value={value}>{children}</SidebarChromeContext.Provider>
}

export function useSidebarChrome(): SidebarChromeState {
  const context = useContext(SidebarChromeContext)
  if (!context) {
    throw new Error('useSidebarChrome must be used within WorkspaceChrome')
  }
  return context
}
