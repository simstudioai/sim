'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Resets window scroll to the top on App Router pathname changes.
 *
 * Next.js's default scroll handling only brings the new Page element into view,
 * which often resolves to "no scroll" inside shared layouts (see vercel/next.js#64435).
 * Skipped when a hash anchor is targeted so the browser's native anchor scroll wins.
 */
export function ScrollToTop() {
  const pathname = usePathname()

  useEffect(() => {
    if (window.location.hash) return
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
