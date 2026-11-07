'use client'

import type { ReactElement, ReactNode, RefObject } from 'react'
import { Popover } from '@base-ui/react/popover'
import { IconButton } from '#emcn/components/button/button'
import type { IconName } from '#emcn/components/icon/icon'
import popup from '#emcn/components/menu/popup.shared.module.css'
import { usePopoverContainer } from '#emcn/components/menu/use-popover-container'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'

type AnchoredPopoverProps = {
  label: string
  /** The trigger's name, where it differs from the popover it opens. */
  triggerLabel?: string
  presentation: 'menu' | 'panel'
  anchor: RefObject<HTMLElement | null>
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean, trigger?: Element) => void
} & (
  | { trigger: (button: ReactElement) => ReactElement; icon?: never }
  | { trigger?: never; icon: IconName }
)

export function AnchoredPopover({
  label,
  triggerLabel = label,
  presentation,
  trigger,
  icon,
  anchor,
  children,
  open,
  onOpenChange,
}: AnchoredPopoverProps) {
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  const portal = usePopoverContainer()
  return (
    <Popover.Root open={open} onOpenChange={(next, details) => onOpenChange(next, details.trigger)}>
      {icon ? (
        <IconButton
          render={<Popover.Trigger ref={portal.trigger} />}
          tooltip
          label={label}
          icon={icon}
          size='row'
        />
      ) : (
        trigger(<Popover.Trigger ref={portal.trigger} aria-label={triggerLabel} />)
      )}
      {portal.container && (
        <Popover.Portal container={portal.container}>
          <Popover.Positioner
            className={popup.positioner}
            align='start'
            anchor={anchor}
            sideOffset={presentation === 'panel' ? 8 : 4}
            collisionPadding={8}
            positionMethod='fixed'
          >
            <Popover.Popup
              ref={scrollEdges}
              className={popup.panel}
              data-presentation={presentation}
              aria-label={label}
              data-material='floating'
              data-elevation='menu'
            >
              {children}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      )}
    </Popover.Root>
  )
}
