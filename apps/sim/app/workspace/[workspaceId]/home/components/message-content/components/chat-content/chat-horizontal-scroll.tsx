'use client'

import { type ReactNode, useRef } from 'react'
import { cn, scrollFadeAttributes, scrollFadeXClass, useScrollEdges } from '@sim/emcn'

interface ChatHorizontalScrollProps {
  children: ReactNode
  className?: string
}

/** Fades the right edge only while a chat table or code block has more content to reveal. */
export function ChatHorizontalScroll({ children, className }: ChatHorizontalScrollProps) {
  const ref = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(ref, { axis: 'x' })

  return (
    <div
      ref={ref}
      className={cn('overflow-x-auto', scrollFadeXClass, className)}
      {...scrollFadeAttributes({ left: false, right: edges.right })}
    >
      {children}
    </div>
  )
}
