'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

declare global {
  interface Window {
    twq?: (...args: unknown[]) => void
  }
}

// next/script dedupes by id and never reloads on remount, so this must be
// module-scope (not a ref) to survive LandingLayout unmounting/remounting.
let hasTrackedInitialPageView = false

/**
 * The X pixel base code only auto-tracks the first page load; LandingLayout
 * persists across client-side navigations, so the pixel never sees the rest.
 * Re-fires the pixel's PageView via `twq('config', ...)` on every navigation
 * after the first.
 */
export function XPageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()

  useEffect(() => {
    if (!hasTrackedInitialPageView) {
      hasTrackedInitialPageView = true
      return
    }

    window.twq?.('config', 'q5xbl')
  }, [pathname, query])

  return null
}
