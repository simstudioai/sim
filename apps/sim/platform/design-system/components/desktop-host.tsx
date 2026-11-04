'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { observeDesktopTitleBar, type SimDesktopApi } from '@sim/desktop-bridge'

function bridge() {
  return (window as Window & { simDesktop?: SimDesktopApi }).simDesktop
}

const subscribe = () => () => {}
const web = () => false
const desktop = () => Boolean(bridge())

/** The preload is fixed for the window lifetime and is absent in a web browser. */
export function useDesktopHost() {
  return useSyncExternalStore(subscribe, desktop, web)
}

export function DesktopHost() {
  useEffect(() => {
    const root = document.documentElement
    const stop = observeDesktopTitleBar(root, navigator.userAgent, bridge())
    return () => {
      stop?.()
      root.removeAttribute('data-sim-desktop-title-bar')
    }
  }, [])
  return null
}
