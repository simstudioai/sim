import { useEffect, useState } from 'react'

/** How long the rail takes to settle after collapsing before row tooltips arm. */
const COLLAPSED_TOOLTIP_DELAY_MS = 200

/**
 * Whether collapsed-rail tooltips should render. Arming is delayed past the rail's
 * width animation so a tooltip never flashes beside a label that is still fading
 * out; disarming is immediate so the expanded rail never shows one.
 */
export function useCollapsedTooltips(isCollapsed: boolean): boolean {
  const [showCollapsedTooltips, setShowCollapsedTooltips] = useState(isCollapsed)

  useEffect(() => {
    if (isCollapsed) {
      const timer = setTimeout(() => setShowCollapsedTooltips(true), COLLAPSED_TOOLTIP_DELAY_MS)
      return () => clearTimeout(timer)
    }
    setShowCollapsedTooltips(false)
  }, [isCollapsed])

  return isCollapsed && showCollapsedTooltips
}
