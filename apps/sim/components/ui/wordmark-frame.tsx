import type { ReactNode, Ref } from 'react'
import { cn } from '@sim/emcn'
import { WORDMARK_FLAT_INK_CLASS } from '@/lib/branding/wordmark'

interface WordmarkFrameProps {
  children: ReactNode
  className?: string
  size?: 'sm' | 'lg'
  variant?: 'gradient' | 'flat'
  svgRef?: Ref<SVGSVGElement>
  label?: string
}

/** Identical SVG viewport and canvas alignment for the resting and animated wordmarks. */
export function WordmarkFrame({
  children,
  className,
  size = 'sm',
  variant = 'flat',
  svgRef,
  label,
}: WordmarkFrameProps) {
  return (
    <div
      className={cn(
        'relative mx-auto aspect-[5/3] shrink-0',
        size === 'sm' ? 'w-[108px]' : 'w-[clamp(180px,17vw,320px)]',
        className
      )}
    >
      <svg
        ref={svgRef}
        viewBox='0 0 100 100'
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={cn(
          '-translate-y-1/2 absolute inset-x-0 top-1/2 aspect-square w-full overflow-visible',
          variant === 'flat' && WORDMARK_FLAT_INK_CLASS
        )}
      >
        {children}
      </svg>
    </div>
  )
}
