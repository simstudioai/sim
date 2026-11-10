'use client'

import type { HTMLAttributes } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { docsScrollAreaClass } from '#docs/components/chrome/chrome'

interface ScrollRegionProps extends HTMLAttributes<HTMLDivElement> {
  label: string
}

/** Keyboard scrolling is reachable only when this region has horizontal overflow. */
export function ScrollRegion({ label, className, children, ...props }: ScrollRegionProps) {
  const region = useScrollEdges('horizontal', { tabStop: true })
  return (
    <div
      {...props}
      ref={region}
      role='region'
      aria-label={label}
      className={cn(docsScrollAreaClass, 'min-w-0 overflow-x-auto ', className)}
    >
      {children}
    </div>
  )
}
