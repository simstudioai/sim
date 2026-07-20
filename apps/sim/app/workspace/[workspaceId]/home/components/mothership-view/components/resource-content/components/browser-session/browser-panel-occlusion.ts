'use client'

import { type RefObject, useEffect, useState } from 'react'
import {
  reportBrowserPanelOcclusion,
  resetBrowserPanelOcclusion,
} from '@/lib/browser-agent/transport'

const NATIVE_SURFACE_OVERLAY_SELECTOR = '[data-native-surface-overlay]'

type OverlayRect = Pick<DOMRect, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>

/** True when two non-empty viewport rectangles overlap. */
export function overlayRectsIntersect(first: OverlayRect, second: OverlayRect): boolean {
  if (first.width <= 0 || first.height <= 0 || second.width <= 0 || second.height <= 0) {
    return false
  }
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  )
}

/**
 * Checks tagged renderer overlays against the native browser host. Shared
 * overlay primitives carry `data-native-surface-overlay`, which makes this
 * work for pointer-transparent tooltips as well as interactive portals.
 */
export function isPanelObscuredByOverlay(
  host: HTMLElement,
  hostRect: DOMRect,
  overlays: Iterable<HTMLElement> = document.querySelectorAll<HTMLElement>(
    NATIVE_SURFACE_OVERLAY_SELECTOR
  )
): boolean {
  for (const overlay of overlays) {
    if (host.contains(overlay)) continue
    if (overlayRectsIntersect(hostRect, overlay.getBoundingClientRect())) {
      return true
    }
  }
  return false
}

function elementContainsOverlay(node: Node): boolean {
  if (!(node instanceof Element)) return false
  return (
    node.matches(NATIVE_SURFACE_OVERLAY_SELECTOR) ||
    node.querySelector(NATIVE_SURFACE_OVERLAY_SELECTOR) !== null
  )
}

function mutationTouchesOverlay(mutation: MutationRecord): boolean {
  if (mutation.type === 'childList') {
    return [...mutation.addedNodes, ...mutation.removedNodes].some(elementContainsOverlay)
  }
  return elementContainsOverlay(mutation.target)
}

/**
 * Coordinates all tagged renderer overlays with the native browser surface.
 * Mutation and resize observers keep the tracked overlay set current, while
 * captured scroll handles poppers moving without changing their own DOM.
 */
export function useBrowserPanelOcclusion(hostRef: RefObject<HTMLElement | null>): boolean {
  const [occluded, setOccluded] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let checkQueued = false
    let lastOccluded = false
    let overlays = new Set<HTMLElement>()

    const checkOcclusion = () => {
      if (disposed) return
      const nextOccluded = isPanelObscuredByOverlay(host, host.getBoundingClientRect(), overlays)
      if (nextOccluded === lastOccluded) return
      lastOccluded = nextOccluded
      setOccluded(nextOccluded)
      reportBrowserPanelOcclusion(nextOccluded)
    }

    const scheduleOcclusionCheck = () => {
      if (checkQueued || disposed) return
      checkQueued = true
      queueMicrotask(() => {
        checkQueued = false
        checkOcclusion()
      })
    }

    const resizeObserver = new ResizeObserver(scheduleOcclusionCheck)

    const refreshOverlays = () => {
      const nextOverlays = new Set(
        document.querySelectorAll<HTMLElement>(NATIVE_SURFACE_OVERLAY_SELECTOR)
      )
      for (const overlay of overlays) {
        if (!nextOverlays.has(overlay)) {
          resizeObserver.unobserve(overlay)
        }
      }
      for (const overlay of nextOverlays) {
        if (!overlays.has(overlay)) {
          resizeObserver.observe(overlay)
        }
      }
      overlays = nextOverlays
      scheduleOcclusionCheck()
    }

    const mutationObserver = new MutationObserver((mutations) => {
      if (!mutations.some(mutationTouchesOverlay)) return
      refreshOverlays()
    })

    resizeObserver.observe(host)
    mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-native-surface-overlay', 'data-state', 'hidden', 'style'],
      childList: true,
      subtree: true,
    })
    window.addEventListener('resize', scheduleOcclusionCheck)
    window.addEventListener('scroll', scheduleOcclusionCheck, true)
    refreshOverlays()

    return () => {
      disposed = true
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleOcclusionCheck)
      window.removeEventListener('scroll', scheduleOcclusionCheck, true)
      resetBrowserPanelOcclusion()
    }
  }, [hostRef])

  return occluded
}
