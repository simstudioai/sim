'use client'

import Image from 'next/image'
import { PLATFORM_LOOP_DESIGN } from '@/app/(landing)/components/shared/platform-loop-constants'
import { ResponsiveDesignStage } from '@/app/(landing)/components/shared/responsive-design-stage'
import {
  PREVIEW_SIDEBAR_CHATS,
  PREVIEW_SIDEBAR_WORKFLOWS,
} from '@/app/(landing)/components/shared/sidebar-preview-content'
import {
  EnterpriseSidebar,
  type EnterpriseSidebarProps,
} from '@/app/(landing)/enterprise/components/enterprise-platform-loop/enterprise-sidebar'

interface CapturedPlatformSurfaceProps {
  src: string
  sizes: string
  activeItem: NonNullable<EnterpriseSidebarProps['activeItem']>
}

/**
 * A captured product surface with the current landing sidebar rendered over
 * the capture's legacy sidebar pixels. Keeping the sidebar live gives every
 * landing callout one source of truth while preserving the detailed product
 * content in the capture beside it.
 */
export function CapturedPlatformSurface({ src, sizes, activeItem }: CapturedPlatformSurfaceProps) {
  return (
    <div className='absolute inset-0 overflow-hidden'>
      <Image src={src} alt='' fill sizes={sizes} className='object-cover' />
      <ResponsiveDesignStage
        width={PLATFORM_LOOP_DESIGN.width}
        height={PLATFORM_LOOP_DESIGN.height}
        align='start'
        className='pointer-events-none absolute inset-0'
        contentClassName='flex'
      >
        <div className='flex h-full w-[249px] border-[var(--border)] border-r bg-[var(--surface-1)]'>
          <EnterpriseSidebar
            chats={PREVIEW_SIDEBAR_CHATS}
            workflows={PREVIEW_SIDEBAR_WORKFLOWS}
            activeItem={activeItem}
          />
          <div className='min-w-0 flex-1 bg-[var(--surface-1)]' />
        </div>
      </ResponsiveDesignStage>
    </div>
  )
}
