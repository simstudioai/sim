'use client'

import { type HTMLAttributes, useEffect, useRef } from 'react'
import { cn } from '@/components/docs/classnames'
import { docsScrollAreaClass } from '@/components/docs/primitives'

interface ScrollRegionProps extends HTMLAttributes<HTMLDivElement> {
  label: string
}

/** Keeps scrolling keyboard-accessible before hydration, then skips nonoverflowing regions unless opted in. */
export function ScrollRegion({
  label,
  className,
  children,
  tabIndex,
  ...props
}: ScrollRegionProps) {
  const region = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = region.current
    if (!element) return
    function updateFocusability() {
      if (element)
        element.tabIndex = tabIndex ?? (element.scrollWidth > element.clientWidth + 1 ? 0 : -1)
    }
    const observer = new ResizeObserver(updateFocusability)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [tabIndex])
  return (
    <div
      {...props}
      ref={region}
      tabIndex={tabIndex ?? 0}
      role='region'
      aria-label={label}
      className={cn(
        docsScrollAreaClass,
        'min-w-0 overflow-x-auto focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2',
        className
      )}
    >
      {children}
    </div>
  )
}
