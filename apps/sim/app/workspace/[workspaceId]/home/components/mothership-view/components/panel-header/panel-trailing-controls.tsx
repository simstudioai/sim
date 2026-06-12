'use client'

import { Button, Tooltip } from '@/components/emcn'
import { X } from '@/components/emcn/icons'
import {
  PANEL_ICON_BUTTON_CLASS,
  PANEL_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/panel-header/panel-controls'
import { ResourcePanelToggle } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/panel-header/resource-panel-toggle'

/**
 * Inert spacers reserving the panel's trailing controls (close + collapse
 * toggle) inside a header row. The REAL controls are host-owned overlays
 * pinned to the panel's top-right corner (see home.tsx) so they exist on
 * every staged view — including loading skeletons, error states, and views
 * that render no header at all. Headers only reserve the footprint.
 */
export function PanelTrailingControls() {
  return (
    <>
      <span aria-hidden='true' className='block size-[30px] shrink-0' />
      <ResourcePanelToggle placeholder className='-mr-[9px]' />
    </>
  )
}

interface PanelCloseButtonProps {
  /** Accessible label for the close control (e.g. `Close Tables`). */
  label: string
  onClose: () => void
  className?: string
}

/**
 * The panel's real close control — clears the stage (dropping the panel to
 * its quick-open empty state). Rendered by the host as an overlay beside the
 * collapse toggle, over the footprint {@link PanelTrailingControls} reserves.
 */
export function PanelCloseButton({ label, onClose, className }: PanelCloseButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='subtle'
          onClick={onClose}
          className={`${PANEL_ICON_BUTTON_CLASS} ${className ?? ''}`}
          aria-label={label}
        >
          <X className={PANEL_ICON_CLASS} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>Close</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
