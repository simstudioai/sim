'use client'

import { Button, Tooltip } from '@/components/emcn'
import { PanelRight } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  PANEL_ICON_BUTTON_CLASS,
  PANEL_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/panel-header/panel-controls'

interface ResourcePanelToggleProps {
  /** Collapsed state — drives the tooltip label and aria-label. Ignored for the spacer. */
  isCollapsed?: boolean
  /** Toggle handler. Omit together with `placeholder` to render the inert spacer. */
  onToggle?: () => void
  /**
   * Renders an invisible, non-interactive clone that reserves the toggle's exact
   * footprint inside the panel header. The real (absolutely-positioned) toggle
   * overlays this spot, so it never shifts when the panel collapses — the spacer
   * rides the panel's width animation while the real button stays put.
   */
  placeholder?: boolean
  className?: string
}

/**
 * The right resource panel's collapse/expand control. Rendered twice: once as
 * the real, absolutely-positioned button pinned to the panel's top-right corner
 * (outside the animating panel, so it never moves), and once as a `placeholder`
 * spacer inside the header to reserve the same footprint. Both share the same
 * button + icon classes, so the overlay aligns exactly with no magic numbers.
 */
export function ResourcePanelToggle({
  isCollapsed = false,
  onToggle,
  placeholder = false,
  className,
}: ResourcePanelToggleProps) {
  const button = (
    <Button
      variant='subtle'
      type='button'
      onClick={placeholder ? undefined : onToggle}
      aria-hidden={placeholder}
      tabIndex={placeholder ? -1 : undefined}
      aria-label={isCollapsed ? 'Expand resource view' : 'Collapse resource view'}
      className={cn(PANEL_ICON_BUTTON_CLASS, placeholder && 'invisible', className)}
    >
      <PanelRight className={PANEL_ICON_CLASS} />
    </Button>
  )

  if (placeholder) return button

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>{isCollapsed ? 'Expand' : 'Collapse'}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
