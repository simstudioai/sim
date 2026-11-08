'use client'

import { type RefObject, useCallback, useEffect, useRef } from 'react'

/** How far each mounted surface asks the tray to rise, in CSS pixels. */
const lifts = new Map<symbol, number>()
const listeners = new Set<(lift: number) => void>()

function currentLift() {
  return Math.max(0, ...lifts.values())
}

function publish() {
  const lift = currentLift()
  for (const listener of listeners) listener(lift)
}

/**
 * Keeps the notification tray above a surface pinned to the window's bottom edge, such as a side
 * panel's footer with its Save action, while that surface is mounted: the tray rises by the
 * distance from the surface's top to the bottom of the window, and settles back when it leaves.
 */
export function useNotificationTrayClearance(
  surface: RefObject<HTMLElement | null>,
  active = true
) {
  useEffect(() => {
    const element = surface.current
    if (!active || !element) return
    const owner = Symbol('tray-clearance')
    const measure = () => {
      lifts.set(owner, Math.max(0, window.innerHeight - element.getBoundingClientRect().top))
      publish()
    }
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', measure)
      lifts.delete(owner)
      publish()
    }
  }, [surface, active])
}

/**
 * A ref for the tray's own element: it carries the highest requested lift as `--shell-tray-lift`,
 * from the moment it mounts and whenever a surface asks for a new one.
 */
export function useTrayLift() {
  const element = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const apply = (lift: number) =>
      element.current?.style.setProperty('--shell-tray-lift', `${lift}px`)
    listeners.add(apply)
    return () => {
      listeners.delete(apply)
    }
  }, [])
  return useCallback((node: HTMLElement | null) => {
    element.current = node
    node?.style.setProperty('--shell-tray-lift', `${currentLift()}px`)
  }, [])
}
