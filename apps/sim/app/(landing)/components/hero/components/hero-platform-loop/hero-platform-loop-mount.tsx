'use client'

import { useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'

const DESKTOP_QUERY = '(min-width: 1024px)'

function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function isDesktopViewport() {
  return window.matchMedia(DESKTOP_QUERY).matches
}

function getServerSnapshot() {
  return false
}

/** Loads the interactive demo independently of the server-rendered hero copy and artwork. */
const HeroPlatformLoop = dynamic(
  () =>
    import('@/app/(landing)/components/hero/components/hero-platform-loop/hero-platform-loop').then(
      (mod) => mod.HeroPlatformLoop
    ),
  { ssr: false }
)

/** Loads the desktop demo only while its frame is visible at the matching CSS breakpoint. */
export function HeroPlatformLoopMount() {
  const isDesktop = useSyncExternalStore(subscribeToViewport, isDesktopViewport, getServerSnapshot)
  return isDesktop ? <HeroPlatformLoop /> : null
}
