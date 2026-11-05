'use client'

import type { ReactNode } from 'react'
import { Popover } from '@base-ui/react/popover'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar.module.css'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import popup from '@/platform/design-system/components/menu/popup.shared.module.css'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

/** A boundary, so the rows are built only when the panel is mounted, not on every rail render. */
function RailFlyoutRows({ render }: { render: () => ReactNode }) {
  return render()
}

interface RailFlyoutProps {
  label: string
  icon: IconName
  /** Holding the flyout open keeps it under a menu its rows open, which sits outside its bounds. */
  children: (hold: (held: boolean) => void) => ReactNode
}

/**
 * A section of the collapsed rail: one icon, with every row in a panel on hover. Focus stays where
 * it was, because a pointer passing over the rail must not take it from the composer.
 */
export function RailFlyout({ label, icon, children }: RailFlyoutProps) {
  const hover = useHoverMenu()
  const portal = usePopoverContainer()
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  return (
    <Popover.Root
      open={hover.isOpen}
      onOpenChange={(next) => (next ? hover.open() : hover.close())}
    >
      <div {...hover.triggerProps} className={styles.railRow}>
        <ControlRow
          render={<Popover.Trigger ref={portal.trigger} />}
          accessibleLabel={label}
          icon={icon}
        />
      </div>
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
              className={`${popup.panel} ${styles.flyout}`}
              data-presentation='menu'
              aria-label={label}
              data-material='floating'
              data-elevation='menu'
              onMouseEnter={hover.contentProps.onMouseEnter}
              onMouseLeave={hover.contentProps.onMouseLeave}
            >
              <RailFlyoutRows render={() => children(hover.setLocked)} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      )}
    </Popover.Root>
  )
}
