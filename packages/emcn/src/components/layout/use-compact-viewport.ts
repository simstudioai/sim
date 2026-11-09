'use client'

import { useSyncExternalStore } from 'react'

function breakpoint(query: string) {
  return {
    snapshot: () => matchMedia(query).matches,
    subscribe(listener: () => void) {
      const media = matchMedia(query)
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    },
  }
}
const content = breakpoint('(max-width: 40rem)')
const navigation = breakpoint('(max-width: 48rem)')
const server = () => false

export function useCompactViewport(surface: 'content' | 'navigation' = 'content') {
  const media = surface === 'navigation' ? navigation : content
  return useSyncExternalStore(media.subscribe, media.snapshot, server)
}

/** Reads the breakpoint in an effect or handler, where the hook's hydration value would be stale. */
export function isCompactViewport(surface: 'content' | 'navigation' = 'content') {
  return (surface === 'navigation' ? navigation : content).snapshot()
}
