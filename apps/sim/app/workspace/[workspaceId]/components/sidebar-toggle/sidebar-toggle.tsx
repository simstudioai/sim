'use client'

import { createContext, useContext } from 'react'
import { PanelLeft } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { useSidebarStore } from '@/stores/sidebar/store'

const SidebarToggleHiddenContext = createContext(false)

interface SidebarToggleHiddenProps {
  children: React.ReactNode
}

/**
 * Suppresses every {@link SidebarToggle} (and other title-bar chrome controls,
 * e.g. the chat switcher) in the subtree. Wrap surfaces that embed full pages
 * (e.g. the chat resource panel) so their headers don't duplicate the chrome.
 */
export function SidebarToggleHidden({ children }: SidebarToggleHiddenProps) {
  return (
    <SidebarToggleHiddenContext.Provider value={true}>
      {children}
    </SidebarToggleHiddenContext.Provider>
  )
}

/**
 * Re-enables chrome controls inside a {@link SidebarToggleHidden} subtree —
 * for the spot where an embedded page's header doubles as the title bar
 * (e.g. the resource panel while the chat pane is hidden).
 */
export function SidebarToggleRevealed({ children }: SidebarToggleHiddenProps) {
  return (
    <SidebarToggleHiddenContext.Provider value={false}>
      {children}
    </SidebarToggleHiddenContext.Provider>
  )
}

/** Whether title-bar chrome controls are suppressed by {@link SidebarToggleHidden}. */
export function useSidebarToggleHidden(): boolean {
  return useContext(SidebarToggleHiddenContext)
}

interface SidebarToggleProps {
  /** Layout-only positioning for the host surface (margins, absolute placement). */
  className?: string
}

/**
 * The single sidebar control, living at the top-left of a page's title bar in
 * both states. Clicking toggles the sidebar open/closed. While the sidebar is
 * hidden, hovering reveals the floating menu panel (rendered by the workspace
 * chrome) anchored underneath this toggle.
 */
export function SidebarToggle({ className }: SidebarToggleProps) {
  const isHidden = useContext(SidebarToggleHiddenContext)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)
  const openFlyout = useSidebarStore((s) => s.openFlyout)
  const scheduleFlyoutClose = useSidebarStore((s) => s.scheduleFlyoutClose)

  if (isHidden) return null

  return (
    <button
      type='button'
      onClick={toggleCollapsed}
      onMouseEnter={isCollapsed ? openFlyout : undefined}
      onMouseLeave={isCollapsed ? scheduleFlyoutClose : undefined}
      className={cn(
        'flex size-[30px] flex-shrink-0 items-center justify-center rounded-lg transition-colors hover-hover:bg-[var(--surface-active)]',
        className
      )}
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <PanelLeft className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
    </button>
  )
}
