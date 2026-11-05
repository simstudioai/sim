'use client'

import type { ReactElement, ReactNode, RefObject } from 'react'
import { Popover } from '@base-ui/react/popover'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import controls from '@/platform/design-system/components/button/button.shared.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'
import popup from '@/platform/design-system/components/menu/popup.shared.module.css'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'
import { Tooltip } from '@/platform/design-system/components/tooltip/tooltip'

type AnchoredPopoverProps = {
  label: string
  presentation: 'menu' | 'panel'
  anchor: RefObject<HTMLElement | null>
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
} & (
  | { trigger: (button: ReactElement) => ReactElement; icon?: never }
  | { trigger?: never; icon: IconName }
)

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
        <Tooltip label={label} enabled={!open}>
          <Popover.Trigger
            ref={portal.trigger}
            className={controls.iconButton}
            aria-label={label}
            data-size='small'
          >
            <Icon name={icon} />
          </Popover.Trigger>
        </Tooltip>
      ) : (
        trigger(<Popover.Trigger ref={portal.trigger} aria-label={label} />)
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
