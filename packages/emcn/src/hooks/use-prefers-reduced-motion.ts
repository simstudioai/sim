'use client'

import { useCallback, useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches
}

/** Server render assumes full motion, matching the CSS default. */
function getServerSnapshot() {
  return false
}

/**
 * Whether the user has asked for reduced motion, as reactive state.
 *
 * Prefer this over the `motion-reduce:` Tailwind variant whenever the animation
 * is driven by something CSS cannot stop. `motion-reduce:hidden` compiles to
 * `display: none`, which hides an SVG `<animate>` but leaves its SMIL timeline
 * running, and does nothing at all to a `requestAnimationFrame` loop or a
 * `setInterval`. Gate the work itself on this and the animation never starts.
 *
 * `matchMedia` is read through `useSyncExternalStore`, so the value updates when
 * the OS setting changes mid-session and SSR resolves without touching `window`.
 *
 * @example
 *   const prefersReducedMotion = usePrefersReducedMotion()
 *   {isActive && !prefersReducedMotion && <AnimatedLayers />}
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(useCallback(subscribe, []), getSnapshot, getServerSnapshot)
}
