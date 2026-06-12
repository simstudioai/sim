'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

/**
 * Chrome the resource panel contributes to an embedded page's own header,
 * so a full page staged in the panel keeps exactly one header row.
 */
interface PanelChromeValue {
  /**
   * Cluster rendered before the title while the chat pane is hidden (sidebar
   * toggle + chat switcher) — the panel header doubles as the title bar.
   */
  leading?: ReactNode
  /** The panel's trailing controls: close + the collapse-toggle spacer. */
  controls: ReactNode
}

const PanelChromeContext = createContext<PanelChromeValue | null>(null)

interface PanelChromeProviderProps extends PanelChromeValue {
  children: ReactNode
}

/**
 * Marks the subtree as panel-hosted for header purposes: a `Resource.Header`
 * rendered inside absorbs the panel's controls and becomes the single header.
 * Provided by the resource panel only around views that bring their own
 * header (workspace area pages, knowledge base detail).
 */
export function PanelChromeProvider({ leading, controls, children }: PanelChromeProviderProps) {
  const value = useMemo<PanelChromeValue>(() => ({ leading, controls }), [leading, controls])
  return <PanelChromeContext.Provider value={value}>{children}</PanelChromeContext.Provider>
}

/** The surrounding panel's header chrome, or null outside the panel. */
export function usePanelChrome(): PanelChromeValue | null {
  return useContext(PanelChromeContext)
}
