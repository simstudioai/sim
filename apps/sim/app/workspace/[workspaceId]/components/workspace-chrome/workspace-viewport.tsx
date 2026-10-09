'use client'

import { type ReactNode, useRef } from 'react'
import { cn } from '@sim/emcn'
import { useMobileViewport } from '@/hooks/use-mobile-viewport'

interface WorkspaceViewportProps {
  children: ReactNode
  className?: string
}

/** Keeps the app and account banners together inside the visible phone viewport. */
export function WorkspaceViewport({ children, className }: WorkspaceViewportProps) {
  const ref = useRef<HTMLDivElement>(null)
  useMobileViewport({ ref })
  return (
    <div
      ref={ref}
      className={cn(
        'flex h-dvh w-full flex-col overflow-hidden bg-[var(--surface-1)] max-md:fixed max-md:inset-x-0 max-md:top-[var(--mobile-viewport-top,0px)] max-md:h-[var(--mobile-viewport-height,100dvh)]',
        className
      )}
    >
      {children}
    </div>
  )
}
