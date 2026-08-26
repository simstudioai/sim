'use client'

import type { ReactNode } from 'react'
import {
  EnterpriseSidebar,
  type EnterpriseSidebarProps,
} from '@/app/(landing)/enterprise/components/enterprise-platform-loop/enterprise-sidebar'
import { DESIGN, useDesignScale } from '@/app/(landing)/hooks/use-design-scale'

interface HeroLoopShellProps {
  /** Workspace name in the sidebar header chip. */
  workspaceName?: string
  /** Viewer name shown in the sidebar profile footer. */
  profileName?: string
  /** Recent-chat entries in the sidebar - four fill the design height. */
  chats: readonly string[]
  /** Deployed-workflow entries in the sidebar - five fill the design height. */
  workflows: readonly string[]
  /** Sidebar row to highlight; unset keeps New chat active. */
  activeItem?: EnterpriseSidebarProps['activeItem']
  /** The workspace pane's contents, rendered inside the inset pane gutter. */
  children: ReactNode
}

/**
 * The platform heroes' shared scaled stage: a `pointer-events-none` region
 * whose fixed 1280x735 design-space layer is fitted to the rendered width via
 * {@link useDesignScale} (`ResizeObserver` + `transform: scale`), holding the
 * live {@link EnterpriseSidebar} beside the workspace pane each loop supplies
 * as children. Purely presentational - the hero that renders it owns the
 * `aria-hidden` frame and the animation clock.
 */
export function HeroLoopShell({
  workspaceName = 'Brightwave',
  profileName = 'Morgan',
  chats,
  workflows,
  activeItem,
  children,
}: HeroLoopShellProps) {
  const { regionRef, scale } = useDesignScale()

  return (
    <div ref={regionRef} className='pointer-events-none absolute inset-0 overflow-hidden'>
      <div
        className='flex origin-top-left bg-[var(--surface-1)]'
        style={{
          width: DESIGN.width,
          height: DESIGN.height,
          transform: `scale(${scale})`,
        }}
      >
        <EnterpriseSidebar
          workspaceName={workspaceName}
          profileName={profileName}
          chats={chats}
          workflows={workflows}
          activeItem={activeItem}
        />
        <div className='h-full min-w-0 flex-1 py-[7px] pr-[8px]'>{children}</div>
      </div>
    </div>
  )
}
