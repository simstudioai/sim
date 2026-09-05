import type { ReactNode } from 'react'
import type { NavMenuPreviewKind } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'

interface MenuPreviewFrameProps {
  kind: NavMenuPreviewKind
  children: ReactNode
  /** Opt in only when a preview contains real hover or keyboard interaction. */
  interactive?: boolean
}

/** A native-size product crop with equal 40px top/left insets, scaled together on smaller panels. */
export function MenuPreviewFrame({ kind, children, interactive = false }: MenuPreviewFrameProps) {
  return (
    <div
      aria-hidden={interactive ? undefined : true}
      inert={!interactive}
      data-menu-preview={kind}
      className='pointer-events-none absolute inset-0 isolate select-none overflow-hidden bg-[var(--surface-3)] [container-type:inline-size]'
    >
      <div className='relative w-[640px] origin-top-left p-10 [scale:min(1,tan(atan2(100cqw,640px)))]'>
        {children}
      </div>
      <EdgeFade ground='surface' depth='preview' />
    </div>
  )
}
