'use client'

import type { ReactNode } from 'react'
import { PLATFORM_LOOP_DESIGN } from '@/app/(landing)/components/shared/platform-loop-constants'
import { ResponsiveDesignStage } from '@/app/(landing)/components/shared/responsive-design-stage'
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
 * The platform heroes' shared responsive stage. The whole preview remains
 * ordinary HTML, fitted from its fixed 1280x735 design space by
 * {@link ResponsiveDesignStage}; SVG is reserved for native workflow paths.
 * This keeps the sidebar and every animated descendant in one browser-safe
 * layout coordinate system across Safari, Chromium, and Firefox.
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
    <ResponsiveDesignStage
      width={PLATFORM_LOOP_DESIGN.width}
      height={PLATFORM_LOOP_DESIGN.height}
      align='start'
      className='pointer-events-none absolute inset-0'
      contentClassName='flex bg-[var(--surface-1)]'
    >
      <EnterpriseSidebar
        workspaceName={workspaceName}
        profileName={profileName}
        chats={chats}
        workflows={workflows}
        activeItem={activeItem}
      />
      <div className='h-full min-w-0 flex-1 py-[7px] pr-[8px]'>{children}</div>
    </ResponsiveDesignStage>
  )
}
