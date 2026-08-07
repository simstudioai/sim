'use client'

import { useCallback } from 'react'

/**
 * Guards a list-level context-menu opener so it only fires for right-clicks on
 * the list background. Right-clicks on a resource row (`[data-resource-row]`,
 * rendered by `Resource.Table`) or on interactive elements are ignored so the
 * row menu or the element's own behavior wins.
 *
 * @param openMenu - The unguarded opener, typically `handleContextMenu` from
 * `useContextMenu`.
 * @returns A guarded handler to pass as `Resource`'s `onContextMenu`.
 */
export function useBackgroundContextMenu(
  openMenu: (e: React.MouseEvent) => void
): (e: React.MouseEvent) => void {
  return useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('[data-resource-row]') ||
        target.closest('button, input, a, [role="button"]')
      ) {
        return
      }
      openMenu(e)
    },
    [openMenu]
  )
}
