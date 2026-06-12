'use client'

import { Button, Tooltip } from '@/components/emcn'
import { X } from '@/components/emcn/icons'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import {
  PANEL_ICON_BUTTON_CLASS,
  PANEL_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/panel-header/panel-controls'
import { ResourcePanelToggle } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/panel-header/resource-panel-toggle'

interface PanelTrailingControlsProps {
  /** Accessible label for the close control (e.g. `Close Tables`). */
  closeLabel: string
}

/**
 * The resource panel's trailing header controls: the close button that clears
 * the stage, plus the inert spacer reserving the collapse toggle's footprint
 * (the real toggle is absolutely pinned by the host and overlays it). Rendered
 * by {@link PanelHeader}, and injected into an embedded page's own header when
 * that header is the panel's single header.
 */
export function PanelTrailingControls({ closeLabel }: PanelTrailingControlsProps) {
  const { closeResource } = useMothershipResources()

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={closeResource}
            className={PANEL_ICON_BUTTON_CLASS}
            aria-label={closeLabel}
          >
            <X className={PANEL_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Close</p>
        </Tooltip.Content>
      </Tooltip.Root>
      {/* Inert spacer reserving the toggle's exact footprint at the far right.
          The real, interactive toggle is rendered absolutely in home.tsx and
          overlays this spot, so it never moves when the panel collapses. Pulled
          out 9px so the hover pill sits 7px from the edge (equal to its 7px
          top/bottom gap in the bar). */}
      <ResourcePanelToggle placeholder className='-mr-[9px]' />
    </>
  )
}
