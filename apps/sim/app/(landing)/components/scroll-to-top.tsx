'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Resets window scroll to the top on App Router pathname changes.
 *
 * Next.js's default scroll handling only brings the new Page element into view,
 * which often resolves to "no scroll" inside shared layouts (see vercel/next.js#64435).
 * Popstate-driven navigations are skipped so browser back/forward scroll restoration
 * is preserved.
 */
export function ScrollToTop() {
  const pathname = usePathname()
  const isPopNavigationRef = useRef(false)

  useEffect(() => {
    const onPop = () => {
      isPopNavigationRef.current = true
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (isPopNavigationRef.current) {
      isPopNavigationRef.current = false
      return
    }
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
