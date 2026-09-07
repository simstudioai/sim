'use client'

import { Tooltip } from '@sim/emcn'

interface SidebarTooltipProps {
  children: React.ReactElement
  label: string
  /** Renders the bare child when false, so a row can opt out without swapping element trees. */
  enabled: boolean
  side?: 'right' | 'bottom'
  shortcut?: string
}

/**
 * Tooltip for a sidebar control, shown while the rail is collapsed (the label is
 * hidden) or on the header's icon-only chips. Returns `children` untouched when
 * disabled so the wrapped element keeps its identity across the toggle.
 */
export function SidebarTooltip({
  children,
  label,
  enabled,
  side = 'right',
  shortcut,
}: SidebarTooltipProps) {
  if (!enabled) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Content side={side}>
        {shortcut ? <Tooltip.Shortcut keys={shortcut}>{label}</Tooltip.Shortcut> : <p>{label}</p>}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
