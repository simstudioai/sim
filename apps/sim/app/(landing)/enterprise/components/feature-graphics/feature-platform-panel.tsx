import type { ComponentType, ReactNode, SVGProps } from 'react'
import { cn } from '@sim/emcn'
import { LANDING_STAGE_WINDOW_RADIUS } from '@/app/(landing)/components/landing-layout'

interface FeaturePlatformPanelProps {
  children: ReactNode
  className?: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  title: string
  /**
   * Full inset window (all sides rounded and stroked) for tall portrait
   * blocs. Default is the feature-tile bleed: top-left radius, open right
   * and bottom edges.
   */
  framed?: boolean
}

/**
 * A cropped workspace surface using the same lightweight header treatment as
 * Sim's product views. Individual graphics provide real platform controls as
 * the content rather than drawing a separate illustration language. The
 * window anchors to the slot's left edge (`left-0`) so it left-aligns with
 * the tile's title/description text column, bleeding off the right edge.
 */
export function FeaturePlatformPanel({
  children,
  className,
  icon: Icon,
  title,
  framed = false,
}: FeaturePlatformPanelProps) {
  return (
    <div
      aria-hidden='true'
      className={cn(
        'absolute overflow-hidden bg-[var(--surface-2)] shadow-xs dark:bg-[var(--surface-4)]',
        framed
          ? cn('inset-0 border border-[var(--border)]', LANDING_STAGE_WINDOW_RADIUS)
          : 'right-0 bottom-0 left-0 rounded-tl-xl border-[var(--border)] border-t border-l',
        className
      )}
    >
      <div className='flex h-12 items-center gap-2 border-[var(--border)] border-b px-4'>
        <span className='flex size-6 items-center justify-center rounded-md bg-[var(--surface-5)]'>
          <Icon className='size-[14px] text-[var(--text-icon)]' />
        </span>
        <span className='text-[var(--text-primary)] text-base'>{title}</span>
      </div>
      {children}
    </div>
  )
}
