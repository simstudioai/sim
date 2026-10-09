'use client'

import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(MOBILE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Reads the breakpoint inside event handlers without waiting for a React render. */
export function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
}

function getServerSnapshot() {
  return false
}

/** Matches the shared md breakpoint without changing persisted desktop layout preferences. */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, isMobileViewport, getServerSnapshot)
}
