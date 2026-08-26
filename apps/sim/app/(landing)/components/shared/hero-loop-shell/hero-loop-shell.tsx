'use client'

import type { ReactNode } from 'react'
import { PLATFORM_LOOP_DESIGN } from '@/app/(landing)/components/shared/platform-loop-constants'
import {
  EnterpriseSidebar,
  type EnterpriseSidebarProps,
} from '@/app/(landing)/enterprise/components/enterprise-platform-loop/enterprise-sidebar'

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
 * The platform heroes' shared scaled stage. An SVG viewBox maps the fixed
 * 1280x735 design space to the rendered window without applying a CSS
 * transform to the whole app. Keeping that scale out of the animated HTML
 * subtree prevents fractional repaint snapping in both the canvas and the
 * otherwise-static {@link EnterpriseSidebar}.
 */
export function HeroLoopShell({
  workspaceName = 'Brightwave',
  profileName = 'Morgan',
  chats,
  workflows,
  activeItem,
  children,
}: HeroLoopShellProps) {
  return (
    <svg
      aria-hidden='true'
      className='pointer-events-none absolute inset-0 size-full overflow-hidden'
      viewBox={`0 0 ${PLATFORM_LOOP_DESIGN.width} ${PLATFORM_LOOP_DESIGN.height}`}
      preserveAspectRatio='xMinYMin meet'
    >
      <foreignObject width={PLATFORM_LOOP_DESIGN.width} height={PLATFORM_LOOP_DESIGN.height}>
        <div className='flex size-full bg-[var(--surface-1)]'>
          <EnterpriseSidebar
            workspaceName={workspaceName}
            profileName={profileName}
            chats={chats}
            workflows={workflows}
            activeItem={activeItem}
          />
          <div className='h-full min-w-0 flex-1 py-[7px] pr-[8px]'>{children}</div>
        </div>
      </foreignObject>
    </svg>
  )
}
