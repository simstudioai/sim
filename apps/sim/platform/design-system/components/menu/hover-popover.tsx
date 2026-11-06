'use client'

import type { ReactElement, ReactNode } from 'react'
import { Popover } from '@base-ui/react/popover'
import styles from '@/platform/design-system/components/menu/menu.module.css'
import popup from '@/platform/design-system/components/menu/popup.shared.module.css'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface HoverPopoverProps {
  label: string
  /** Wraps the trigger, whose hover the caller turns into `open`. */
  trigger: (button: ReactElement) => ReactElement
  open: boolean
  onOpenChange: (open: boolean) => void
  onPopupMouseEnter: () => void
  onPopupMouseLeave: () => void
  children: ReactNode
}

/**
 * Rows in a panel beside the trigger, opened on hover. Focus stays where it was, because a pointer
 * passing over the trigger must not take it from what the reader is typing in.
 */
export function HoverPopover({
  label,
  trigger,
  open,
  onOpenChange,
  onPopupMouseEnter,
  onPopupMouseLeave,
  children,
}: HoverPopoverProps) {
  const portal = usePopoverContainer()
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  return (
    <Popover.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      {trigger(<Popover.Trigger ref={portal.trigger} />)}
      {portal.container && (
        <Popover.Portal container={portal.container}>
          <Popover.Positioner
            className={popup.positioner}
            side='inline-end'
            align='start'
            sideOffset={4}
            collisionPadding={8}
            positionMethod='fixed'
          >
            <Popover.Popup
              ref={scrollEdges}
              initialFocus={false}
              finalFocus={false}
              className={`${popup.panel} ${styles.hoverPanel}`}
              data-presentation='menu'
              aria-label={label}
              data-material='floating'
              data-elevation='menu'
              onMouseEnter={onPopupMouseEnter}
              onMouseLeave={onPopupMouseLeave}
            >
              {children}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      )}
    </Popover.Root>
  )
}
