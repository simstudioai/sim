'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BrowserPanelSnapshot } from '@sim/browser-protocol'
import {
  captureBrowserPanelSnapshot,
  isBrowserPanelOcclusionAvailable,
  setBrowserPanelOccluded,
} from '@/lib/browser-agent/transport'

const SNAPSHOT_DECODE_TIMEOUT_MS = 3_000
const SNAPSHOT_PAINT_TIMEOUT_MS = 1_000

export type BrowserPanelOverlay =
  | 'credentials'
  | 'downloads'
  | 'resources'
  | 'suggestions'
  | 'tab'
  | 'toolbar'

export interface BrowserPanelOverlayController {
  requestOverlay: (overlay: BrowserPanelOverlay, fallback: () => void) => Promise<void>
  closeOverlay: (overlay: BrowserPanelOverlay) => Promise<void>
}

interface SnapshotRender {
  frame: BrowserPanelSnapshot
  requestId: number
}

interface PendingPaint {
  requestId: number
  resolve: (painted: boolean) => void
}

interface BrowserPanelOcclusion extends BrowserPanelOverlayController {
  activeOverlay: BrowserPanelOverlay | null
  snapshot: BrowserPanelSnapshot | null
  onSnapshotError: () => void
}

/**
 * Decodes the replacement before React mounts it. Waiting on the mounted
 * image's `load` event is racy for data URLs: Chromium can satisfy a cached
 * image between commit and listener delivery, which left the handshake parked
 * until its timeout and silently opened the native fallback menu instead.
 */
async function decodeSnapshot(dataUrl: string): Promise<boolean> {
  const image = new Image()
  image.src = dataUrl
  let timeoutId: number | null = null
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error('snapshot decode timed out')),
          SNAPSHOT_DECODE_TIMEOUT_MS
        )
      }),
    ])
    return true
  } catch {
    return false
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
  }
}

/**
 * Explicit browser-chrome native-surface swap.
 *
 * Unlike the previous global overlay observer, this runs only after a browser
 * chrome interaction. The native page remains visible while its lossless frame is
 * captured and decoded. React paints that frame underneath the still-visible
 * page; only after two animation frames does the desktop hide the native view
 * and let the requested emcn menu mount. Closing performs the inverse order.
 */
export function useBrowserPanelOcclusion(
  scopeId: string,
  activeTabId: string | null
): BrowserPanelOcclusion {
  const supported = isBrowserPanelOcclusionAvailable()
  const [snapshotRender, setSnapshotRender] = useState<SnapshotRender | null>(null)
  const [activeOverlay, setActiveOverlay] = useState<BrowserPanelOverlay | null>(null)
  const activeOverlayRef = useRef<BrowserPanelOverlay | null>(null)
  const activeTabIdRef = useRef(activeTabId)
  const requestIdRef = useRef(0)
  const pendingPaintRef = useRef<PendingPaint | null>(null)
  const paintFramesRef = useRef<number[]>([])
  const revealPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const mountedRef = useRef(true)
  activeTabIdRef.current = activeTabId

  const settlePaint = useCallback((requestId: number, painted: boolean) => {
    const pending = pendingPaintRef.current
    if (!pending || pending.requestId !== requestId) return
    pendingPaintRef.current = null
    pending.resolve(painted)
  }, [])

  const cancelPaintFrames = useCallback(() => {
    for (const frame of paintFramesRef.current) cancelAnimationFrame(frame)
    paintFramesRef.current = []
  }, [])

  useLayoutEffect(() => {
    cancelPaintFrames()
    const render = snapshotRender
    const pending = pendingPaintRef.current
    if (!render || !pending || pending.requestId !== render.requestId) return

    // The frame was decoded before commit. Two animation frames now establish
    // that the DOM replacement itself reached the compositor before the native
    // WebContentsView is hidden.
    const first = requestAnimationFrame(() => {
      const second = requestAnimationFrame(() => {
        paintFramesRef.current = []
        settlePaint(render.requestId, true)
      })
      paintFramesRef.current = [second]
    })
    paintFramesRef.current = [first]
    return cancelPaintFrames
  }, [cancelPaintFrames, settlePaint, snapshotRender])

  const onSnapshotError = useCallback(() => {
    const render = snapshotRender
    if (render) settlePaint(render.requestId, false)
  }, [settlePaint, snapshotRender])

  const reveal = useCallback(
    async (requestId: number) => {
      await setBrowserPanelOccluded(false, scopeId).catch(() => false)
      if (mountedRef.current && requestIdRef.current === requestId) {
        setSnapshotRender(null)
      }
    },
    [scopeId]
  )

  const closeOverlay = useCallback(
    async (overlay: BrowserPanelOverlay) => {
      if (activeOverlayRef.current !== overlay) {
        await revealPromiseRef.current
        return
      }
      const requestId = ++requestIdRef.current
      activeOverlayRef.current = null
      setActiveOverlay(null)
      cancelPaintFrames()
      pendingPaintRef.current?.resolve(false)
      pendingPaintRef.current = null
      const revealing = reveal(requestId)
      revealPromiseRef.current = revealing
      await revealing
    },
    [cancelPaintFrames, reveal]
  )

  const requestOverlay = useCallback(
    async (overlay: BrowserPanelOverlay, fallback: () => void) => {
      if (activeOverlayRef.current === overlay || pendingPaintRef.current) return
      if (!supported) {
        fallback()
        return
      }

      const requestId = ++requestIdRef.current
      const frame = await captureBrowserPanelSnapshot(scopeId).catch(() => null)
      if (!mountedRef.current || requestIdRef.current !== requestId) return
      if (!frame || (activeTabIdRef.current && frame.tabId !== activeTabIdRef.current)) {
        fallback()
        return
      }

      const decoded = await decodeSnapshot(frame.dataUrl)
      if (!mountedRef.current || requestIdRef.current !== requestId) return
      if (!decoded) {
        fallback()
        return
      }

      const painted = new Promise<boolean>((resolve) => {
        pendingPaintRef.current = { requestId, resolve }
      })
      setSnapshotRender({ frame, requestId })
      const paintTimeout = window.setTimeout(
        () => settlePaint(requestId, false),
        SNAPSHOT_PAINT_TIMEOUT_MS
      )
      const didPaint = await painted
      window.clearTimeout(paintTimeout)
      if (!mountedRef.current || requestIdRef.current !== requestId) return
      if (!didPaint) {
        setSnapshotRender(null)
        fallback()
        return
      }

      const hidden = await setBrowserPanelOccluded(true, scopeId).catch(() => false)
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        if (hidden) await setBrowserPanelOccluded(false, scopeId).catch(() => false)
        return
      }
      if (!hidden) {
        setSnapshotRender(null)
        fallback()
        return
      }

      activeOverlayRef.current = overlay
      setActiveOverlay(overlay)
    },
    [scopeId, settlePaint, supported]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current++
      cancelPaintFrames()
      pendingPaintRef.current?.resolve(false)
      pendingPaintRef.current = null
      void setBrowserPanelOccluded(false, scopeId)
    }
  }, [cancelPaintFrames, scopeId])

  useEffect(() => {
    const frame = snapshotRender?.frame
    if (!frame || !activeTabId || frame.tabId === activeTabId) return
    const overlay = activeOverlayRef.current
    if (overlay) closeOverlay(overlay)
  }, [activeTabId, closeOverlay, snapshotRender])

  return {
    activeOverlay,
    snapshot: snapshotRender?.frame ?? null,
    requestOverlay,
    closeOverlay,
    onSnapshotError,
  }
}
