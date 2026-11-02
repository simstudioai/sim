'use client'

import { type AnimationEventHandler, type ReactNode, useRef } from 'react'
import { cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'

interface ComposerScrollAreaProps {
  children: ReactNode
  className?: string
  onAnimationEnd?: AnimationEventHandler<HTMLDivElement>
}

/** Keeps the complete composer reachable when its contents exceed the available chat height. */
export function ComposerScrollArea({
  children,
  className,
  onAnimationEnd,
}: ComposerScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef)

  return (
    <div
      ref={scrollRef}
      className={cn('min-h-0 overflow-y-auto overscroll-contain', scrollFadeClass, className)}
      {...scrollFadeAttributes(edges)}
      onAnimationEnd={onAnimationEnd}
    >
      {children}
    </div>
  )
}
