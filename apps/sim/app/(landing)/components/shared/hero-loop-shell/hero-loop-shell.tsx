'use client'

import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
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
  /** Native keeps product chrome at its real CSS size; scaled fits fixed captures. */
  mode?: 'native' | 'scaled'
  /** The workspace pane's contents, rendered inside the inset pane gutter. */
  children: ReactNode
}

/**
 * Shared product shell for landing previews. Scaled mode preserves fixed
 * product captures; native mode lets the homepage use real CSS dimensions so
 * the 238px sidebar and 14px product type are never magnified.
 */
export function HeroLoopShell({
  workspaceName = 'Brightwave',
  profileName = 'Morgan',
  chats,
  workflows,
  activeItem,
  mode = 'scaled',
  children,
}: HeroLoopShellProps) {
  const workspace = (
    <>
      <div data-preview-sidebar='' className={cn(mode === 'native' && 'max-md:hidden')}>
        <EnterpriseSidebar
          workspaceName={workspaceName}
          profileName={profileName}
          chats={chats}
          workflows={workflows}
          activeItem={activeItem}
        />
      </div>
      <div className='h-full min-w-0 flex-1 py-[7px] pr-[8px] max-md:pl-[8px]'>{children}</div>
    </>
  )

  if (mode === 'native') {
    return (
      <div className='absolute inset-0 flex overflow-hidden bg-[var(--surface-1)]'>{workspace}</div>
    )
  }

  return (
    <ResponsiveDesignStage
      width={PLATFORM_LOOP_DESIGN.width}
      height={PLATFORM_LOOP_DESIGN.height}
      align='start'
      className='pointer-events-none absolute inset-0'
      contentClassName='flex bg-[var(--surface-1)]'
    >
      {workspace}
    </ResponsiveDesignStage>
  )
}
