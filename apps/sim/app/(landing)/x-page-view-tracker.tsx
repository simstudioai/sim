'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

let hasTrackedInitialPageView = false

/**
 * The consent-gated X pixel tracks its first page when it loads. Re-fires the
 * PageView for later client navigations.
 */
export function XPageViewTracker() {
  const pathname = usePathname()

  const lastTrackedPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (lastTrackedPathRef.current === pathname) return
    lastTrackedPathRef.current = pathname

    if (!hasTrackedInitialPageView) {
      hasTrackedInitialPageView = true
      return
    }

    window.twq?.('config', 'q5xbl')
  }, [pathname])

  return null
}
