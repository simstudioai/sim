'use client'

import type { ReactElement, ReactNode, RefObject } from 'react'
import { Popover } from '@base-ui/react/popover'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import controls from '@/platform/design-system/components/components.module.css'
import { Icon } from '@/platform/design-system/components/icon'
import popup from '@/platform/design-system/components/popup.module.css'
import { usePopoverContainer } from '@/platform/design-system/components/use-popover-container'

type AnchoredPopoverProps = {
  label: string
  presentation: 'menu' | 'panel'
  anchor: RefObject<HTMLElement | null>
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
} & ({ trigger: ReactElement; icon?: never } | { trigger?: never; icon: IconName })

export function AnchoredPopover({
  label,
  presentation,
  trigger,
  icon,
  anchor,
  children,
  open,
  onOpenChange,
}: AnchoredPopoverProps) {
  const portal = usePopoverContainer()
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {icon ? (
        <Popover.Trigger
          ref={portal.trigger}
          className={controls.iconButton}
          aria-label={label}
          title={label}
        >
          <Icon name={icon} />
        </Popover.Trigger>
      ) : (
        <Popover.Trigger ref={portal.trigger} render={trigger} aria-label={label} />
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
