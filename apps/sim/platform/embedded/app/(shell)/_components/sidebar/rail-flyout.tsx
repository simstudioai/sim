'use client'

import type { ReactNode } from 'react'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import { HoverPopover } from '@/platform/design-system/components/menu/hover-popover'
import styles from '@/platform/embedded/app/(shell)/_components/sidebar/sidebar.module.css'

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

/** A section of the collapsed rail: one icon, with every row in a panel on hover. */
export function RailFlyout({ label, icon, children }: RailFlyoutProps) {
  const hover = useHoverMenu()
  return (
    <HoverPopover
      label={label}
      open={hover.isOpen}
      onOpenChange={(next) => (next ? hover.open() : hover.close())}
      onPopupMouseEnter={hover.contentProps.onMouseEnter}
      onPopupMouseLeave={hover.contentProps.onMouseLeave}
      trigger={(button) => (
        <div
          className={styles.railRow}
          onMouseEnter={hover.triggerProps.onMouseEnter}
          onMouseLeave={hover.triggerProps.onMouseLeave}
        >
          <ControlRow render={button} accessibleLabel={label} icon={icon} />
        </div>
      )}
    >
      <RailFlyoutRows render={() => children(hover.setLocked)} />
    </HoverPopover>
  )
}
