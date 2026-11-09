'use client'

import { useEffect, useEffectEvent, useSyncExternalStore } from 'react'
import {
  type DesktopCommand,
  observeDesktopTitleBar,
  type SimDesktopApi,
} from '@sim/desktop-bridge'

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

/** Runs `handle` for each native application menu command. Web browsers never send one. */
export function useDesktopCommands(handle: (command: DesktopCommand) => void) {
  const onCommand = useEffectEvent(handle)
  useEffect(() => bridge()?.onCommand?.((command) => onCommand(command)), [])
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
