import type { ComponentType, ReactNode, SVGProps } from 'react'
import { cn } from '@sim/emcn'

interface FeaturePlatformPanelProps {
  children: ReactNode
  className?: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  title: string
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
}: FeaturePlatformPanelProps) {
  return (
    <div
      aria-hidden='true'
      className={cn(
        'absolute right-0 bottom-0 left-0 overflow-hidden rounded-tl-xl border-[var(--border-1)] border-t border-l bg-[var(--surface-2)] shadow-sm',
        className
      )}
    >
      <div className='flex h-12 items-center gap-2 border-[var(--border)] border-b px-4'>
        <span className='flex size-6 items-center justify-center rounded-md bg-[var(--surface-5)]'>
          <Icon className='size-[14px] text-[var(--text-icon)]' />
        </span>
        <span className='font-medium text-[var(--text-primary)] text-base'>{title}</span>
      </div>
      {children}
    </div>
  )
}
