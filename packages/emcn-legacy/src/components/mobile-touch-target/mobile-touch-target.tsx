import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** Expands a compact control's hit area into the space reserved by MobileTouchTarget. */
export const mobileTouchTargetClass =
  "max-md:relative max-md:shrink-0 max-md:pointer-coarse:min-h-0 max-md:pointer-coarse:min-w-0 max-md:after:absolute max-md:after:top-1/2 max-md:after:left-1/2 max-md:after:h-11 max-md:after:w-full max-md:after:min-w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']"

interface MobileTouchTargetProps {
  enabled: boolean
  square?: boolean
  fullWidth?: boolean
  children: ReactNode
}

/** Reserves a 44px mobile target without enlarging the control's visible surface. */
export function MobileTouchTarget({
  enabled,
  square,
  fullWidth,
  children,
}: MobileTouchTargetProps) {
  return enabled ? (
    <span
      className={cn(
        'contents max-md:inline-flex max-md:h-11 max-md:min-w-11 max-md:shrink-0 max-md:items-center max-md:justify-center',
        square ? 'max-md:w-11' : fullWidth && 'max-md:w-full'
      )}
    >
      {children}
    </span>
  ) : (
    children
  )
}
