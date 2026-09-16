import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import type { NavMenuPreviewKind } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'

interface MenuPreviewFrameProps {
  kind: NavMenuPreviewKind
  children: ReactNode
  /** Opt in only when a preview contains real hover or keyboard interaction. */
  interactive?: boolean
  layout?: 'menu' | 'hero'
}

/** Navigation crops and open hero stages share the same product UI and edge treatment. */
export function MenuPreviewFrame({
  kind,
  children,
  interactive = false,
  layout = 'menu',
}: MenuPreviewFrameProps) {
  const isHero = layout === 'hero'

  return (
    <div
      aria-hidden={interactive ? undefined : true}
      inert={!interactive}
      data-menu-preview={kind}
      className={cn(
        'pointer-events-none absolute inset-0 isolate select-none overflow-hidden [container-type:inline-size]',
        isHero ? 'bg-[var(--bg)]' : 'bg-[var(--surface-3)] [--preview-content-width:576px]'
      )}
    >
      <div
        className={cn(
          isHero
            ? '-translate-x-1/2 absolute top-20 @max-[640px]:left-6 left-1/2 w-max @max-[640px]:translate-x-0 max-sm:top-6'
            : 'relative w-[640px] origin-top-left p-10 [scale:min(1,tan(atan2(100cqw,640px)))]'
        )}
      >
        {children}
      </div>
      <EdgeFade ground={isHero ? 'canvas' : 'surface'} depth='preview' />
    </div>
  )
}
