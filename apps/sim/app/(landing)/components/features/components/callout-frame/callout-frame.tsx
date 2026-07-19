import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

const CALLOUT_FADE =
  '[-webkit-mask-image:linear-gradient(to_bottom,#000_72%,transparent)] [mask-image:linear-gradient(to_bottom,#000_72%,transparent)]'

interface CalloutFrameProps {
  /** Width/layout for the panel (e.g. `w-[340px]`). */
  className?: string
  /** Sizing for the inner body (e.g. `h-[300px]`). */
  bodyClassName?: string
  /** Dissolve the body's lower edge so the surface reads as continuing below. */
  fade?: boolean
  children: ReactNode
}

/**
 * The shared chrome for a callout: an elevated panel that lifts a real Sim UI
 * surface off the backdrop, wearing the hero platform window's exact chrome -
 * 10px radius, `--surface-1` fill, and the hairline-ring + layered soft shadow
 * - so every floating window on the page reads as one family. Optionally fades
 * its body's foot so a long surface dissolves rather than ends on a hard edge.
 */
export function CalloutFrame({ className, bodyClassName, fade, children }: CalloutFrameProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[10px] bg-[var(--surface-1)] shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_6px_0_rgba(0,0,0,0.05),0_4px_42px_0_rgba(0,0,0,0.06)]',
        className
      )}
    >
      <div className={cn('relative overflow-hidden', fade && CALLOUT_FADE, bodyClassName)}>
        {children}
      </div>
    </div>
  )
}
