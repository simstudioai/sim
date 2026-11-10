'use client'

import { type HTMLAttributes, useEffect, useRef } from 'react'
import { cn } from '@/components/docs/classnames'
import { docsScrollAreaClass } from '@/components/docs/primitives'

interface ScrollRegionProps extends HTMLAttributes<HTMLDivElement> {
  label: string
}

/** Keeps scrolling keyboard-accessible before hydration, then skips regions without overflow. */
export function ScrollRegion({
  label,
  className,
  children,
  tabIndex = 0,
  ...props
}: ScrollRegionProps) {
  const region = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = region.current
    if (!element) return
    function updateFocusability() {
      if (element) element.tabIndex = element.scrollWidth > element.clientWidth + 1 ? tabIndex : -1
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
      tabIndex={tabIndex}
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
