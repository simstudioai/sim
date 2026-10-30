'use client'

import { type HTMLAttributes, useEffect, useRef } from 'react'
import { cn } from '@/components/docs/classnames'

interface ScrollRegionProps extends HTMLAttributes<HTMLDivElement> {
  label: string
}

/** Keyboard scrolling is reachable only when this region has horizontal overflow. */
export function ScrollRegion({ label, className, children, ...props }: ScrollRegionProps) {
  const region = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = region.current
    if (!element) return
    function updateFocusability() {
      if (element) element.tabIndex = element.scrollWidth > element.clientWidth + 1 ? 0 : -1
    }
    const observer = new ResizeObserver(updateFocusability)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      {...props}
      ref={region}
      role='region'
      aria-label={label}
      className={cn(
        'min-w-0 overflow-x-auto [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2',
        className
      )}
    >
      {children}
    </div>
  )
}
