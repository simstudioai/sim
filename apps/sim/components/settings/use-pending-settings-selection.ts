'use client'

import { useCallback, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * The settings row a sidebar click is navigating to, shown as selected until the route commits.
 *
 * Section routes have no loading boundary (see the workspace section layout), so a navigation
 * keeps the outgoing section on screen until the incoming one is ready. Moving the selection on
 * click keeps the click acknowledged while the route resolves.
 *
 * The pending row is dropped whenever the pathname changes — on commit, and on any navigation the
 * sidebar did not start, such as the browser's back button.
 */
export function usePendingSettingsSelection<TSection extends string>(
  routeSection: TSection
): { activeSection: TSection; selectPending: (section: TSection) => void } {
  const pathname = usePathname()
  const [pending, setPending] = useState<{ section: TSection; pathname: string | null } | null>(
    null
  )

  // Cleared, not just compared: returning to this pathname later (back after the commit) must
  // not resurrect a settled selection.
  if (pending !== null && pending.pathname !== pathname) setPending(null)

  const selectPending = useCallback(
    (section: TSection) => setPending({ section, pathname }),
    [pathname]
  )

  return {
    activeSection:
      pending !== null && pending.pathname === pathname ? pending.section : routeSection,
    selectPending,
  }
}
