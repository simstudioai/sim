'use client'

import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { BrowserPanelSnapshot } from '@sim/browser-protocol'
import {
  NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
  type NativeSurfaceOcclusionPrepareDetail,
} from '@sim/emcn'
import { backoffWithJitter } from '@sim/utils/retry'
import {
  captureBrowserPanelSnapshot,
  setBrowserPanelOccluded,
  supportsAtomicBrowserPanelOcclusion,
} from '@/lib/browser-agent/transport'

const SNAPSHOT_DECODE_TIMEOUT_MS = 3_000
const SNAPSHOT_PAINT_TIMEOUT_MS = 1_000
const OVERLAY_RETRY_LIMIT = 3

/** Full-screen modal/takeover effects that must composite above the native page. */
export const NATIVE_SURFACE_OCCLUSION_SELECTOR = '[data-native-surface-occlusion]'

/** Passive notifications must never suspend interaction with the browser page. */
const NATIVE_SURFACE_OVERLAY_SELECTOR =
  '[data-native-surface-overlay]:not([data-native-surface-overlay="passive"])'

export type BrowserPanelSnapshotLayer = 'modal' | 'popover'

export type BrowserPanelOverlay = 'downloads' | 'resources' | 'suggestions' | 'toolbar'

export interface BrowserPanelOverlayController {
  /** True when the renderer overlay owns the painted frame; false when fallback handled it. */
  requestOverlay: (
    overlay: BrowserPanelOverlay,
    fallback: () => void,
    onOwnershipLost?: () => void
  ) => Promise<boolean>
  closeOverlay: (overlay: BrowserPanelOverlay) => Promise<void>
}

export interface BrowserPanelGeometryOcclusionLease {
  assumeRevealed: () => void
  isOccluded: () => boolean
  isTransitioning: () => boolean
  setDesired: (occluded: boolean) => Promise<boolean>
}

/**
 * Serializes the bounds reporter's emergency native hide/reveal lease. A DOM
 * marker can disappear while Electron is still processing the hide; desired
 * state is therefore re-read after every side effect and rolled back before
 * any caller is told it is settled.
 */
export function createBrowserPanelGeometryOcclusionLease(
  apply: (occluded: boolean) => Promise<boolean>
): BrowserPanelGeometryOcclusionLease {
  let applied = false
  let desired = false
  let pendingTransitions = 0
  let transitionTail: Promise<void> = Promise.resolve()

  const reconcile = async (): Promise<boolean> => {
    while (applied !== desired) {
      const target = desired
      let changed = false
      try {
        changed = await apply(target)
      } catch {
        changed = false
      }
      if (!changed) return applied === desired
      applied = target
    }
    return true
  }

  return {
    assumeRevealed: () => {
      applied = false
    },
    isOccluded: () => applied,
    isTransitioning: () => pendingTransitions > 0,
    setDesired: (occluded) => {
      if (occluded === desired && pendingTransitions > 0) {
        return transitionTail.then(() => applied === occluded && desired === occluded)
      }
      desired = occluded
      const requested = occluded
      pendingTransitions++
      const run = transitionTail.then(reconcile, reconcile)
      transitionTail = run.then(
        () => undefined,
        () => undefined
      )
      return run
        .then((settled) => settled && desired === requested && applied === requested)
        .finally(() => {
          pendingTransitions = Math.max(0, pendingTransitions - 1)
        })
    },
  }
}

interface SnapshotRender {
  frame: BrowserPanelSnapshot
  layer: BrowserPanelSnapshotLayer
  paintId: number
}

interface PendingPaint {
  paintId: number
  resolve: (painted: boolean) => void
}

interface BrowserPanelOcclusion extends BrowserPanelOverlayController {
  activeOverlay: BrowserPanelOverlay | null
  snapshot: BrowserPanelSnapshot | null
  snapshotLayer: BrowserPanelSnapshotLayer
  onSnapshotError: () => void
  /** Allows the bounds reporter to release its modal lease without revealing through another overlay. */
  shouldKeepNativeHidden: () => boolean
}

/**
 * Deliberately narrower than `data-native-surface-overlay`: the broad marker is
 * also used by transient menus/tooltips and passive notifications. Transient
 * overlays only need a replacement when they overlap the page; notifications
 * never acquire a lease that could suspend browser interaction indefinitely.
 */
export function hasNativeSurfaceOcclusion(root: ParentNode = document): boolean {
  return root.querySelector(NATIVE_SURFACE_OCCLUSION_SELECTOR) !== null
}

function nodeContainsSelector(node: Node, selector: string): boolean {
  if (node instanceof Element && node.matches(selector)) return true
  return (
    (node instanceof Element || node instanceof DocumentFragment) &&
    node.querySelector(selector) !== null
  )
}

export function mutationsTouchNativeSurfaceOcclusion(records: MutationRecord[]): boolean {
  return records.some((record) => {
    if (record.type === 'attributes') return true
    return [...record.addedNodes, ...record.removedNodes].some((node) =>
      nodeContainsSelector(node, NATIVE_SURFACE_OCCLUSION_SELECTOR)
    )
  })
}

/**
 * Watches marked overlays only while any exist. Sampling their painted bounds
 * also catches cursor-following tooltips and CSS transitions that do not resize
 * the element. DOM churn elsewhere (including streamed chat text) does not
 * rescan the document or start an animation-frame loop.
 */
function observeOverlappingOverlays(
  getHostRect: () => DOMRect | null,
  onChange: (overlapping: boolean) => Promise<boolean>
): () => void {
  let overlays: HTMLElement[] = []
  let frame: number | null = null
  let overlapping = false
  let hostGeometry = ''
  let disposed = false
  let revision = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const reconcile = (attempt = 0) => {
    clearTimeout(retryTimer)
    const request = ++revision
    void onChange(overlapping).then((ready) => {
      if (disposed || request !== revision || ready || attempt >= OVERLAY_RETRY_LIMIT) return
      retryTimer = setTimeout(
        () => reconcile(attempt + 1),
        backoffWithJitter(attempt + 1, null, { baseMs: 250, maxMs: 1_000 })
      )
    })
  }

  const measure = () => {
    frame = null
    const host = getHostRect()
    const geometry = host ? `${host.x}:${host.y}:${host.width}:${host.height}` : ''
    const next = Boolean(
      host &&
        host.width > 0 &&
        host.height > 0 &&
        overlays.some((overlay) => {
          const bounds = overlay.getBoundingClientRect()
          if (
            bounds.width <= 0 ||
            bounds.height <= 0 ||
            bounds.right <= host.left ||
            bounds.left >= host.right ||
            bounds.bottom <= host.top ||
            bounds.top >= host.bottom
          )
            return false
          const style = getComputedStyle(overlay)
          return (
            style.visibility !== 'hidden' &&
            style.visibility !== 'collapse' &&
            style.display !== 'none' &&
            style.opacity !== '0' &&
            (overlay.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true)
          )
        })
    )
    if (next !== overlapping || (next && geometry !== hostGeometry)) {
      overlapping = next
      reconcile()
    }
    hostGeometry = geometry
    if (overlays.length > 0) frame = requestAnimationFrame(measure)
  }

  const refresh = () => {
    overlays = Array.from(document.querySelectorAll<HTMLElement>(NATIVE_SURFACE_OVERLAY_SELECTOR))
    if (frame === null) frame = requestAnimationFrame(measure)
  }
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some((node) =>
            nodeContainsSelector(node, NATIVE_SURFACE_OVERLAY_SELECTOR)
          )
      )
    )
      refresh()
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-native-surface-overlay'],
  })
  refresh()
  return () => {
    disposed = true
    revision++
    clearTimeout(retryTimer)
    observer.disconnect()
    if (frame !== null) cancelAnimationFrame(frame)
  }
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

/** Largest tolerated drift, in CSS px, between a capture and the live host rect. */
const SNAPSHOT_GEOMETRY_TOLERANCE_PX = 1

/**
 * Whether a captured frame still describes the rectangle the panel occupies.
 * A capture with no viewport bounds is positioned by the fallback
 * `absolute inset-0` style, which tracks the host by construction.
 */
export function snapshotMatchesHost(
  frame: Pick<BrowserPanelSnapshot, 'viewportBounds'>,
  hostRect: DOMRect | null
): boolean {
  const bounds = frame.viewportBounds
  if (!bounds || !hostRect) return true
  return (
    Math.abs(bounds.x - hostRect.x) <= SNAPSHOT_GEOMETRY_TOLERANCE_PX &&
    Math.abs(bounds.y - hostRect.y) <= SNAPSHOT_GEOMETRY_TOLERANCE_PX &&
    Math.abs(bounds.width - hostRect.width) <= SNAPSHOT_GEOMETRY_TOLERANCE_PX &&
    Math.abs(bounds.height - hostRect.height) <= SNAPSHOT_GEOMETRY_TOLERANCE_PX
  )
}

/**
 * Coordinates the renderer replacement for the native browser surface.
 *
 * Transient overlays use a replacement below the shared dropdown layer,
 * where opening them is pixel-neutral. Full-screen modals use the same exact
 * replacement below `--z-modal`, allowing the real modal scrim to tint and
 * backdrop-blur it exactly like the rest of Sim. Both share a lease and reuse
 * a frame while its tab and geometry remain valid.
 */
export function useBrowserPanelOcclusion(
  scopeId: string,
  activeTabId: string | null,
  panelVisible = true,
  getHostRect?: () => DOMRect | null
): BrowserPanelOcclusion {
  const [snapshotRender, setSnapshotRender] = useState<SnapshotRender | null>(null)
  const [activeOverlay, setActiveOverlay] = useState<BrowserPanelOverlay | null>(null)
  const snapshotRenderRef = useRef<SnapshotRender | null>(null)
  const activeOverlayRef = useRef<BrowserPanelOverlay | null>(null)
  const activeOverlayOwnershipLostRef = useRef<(() => void) | null>(null)
  const pendingOverlayRef = useRef<BrowserPanelOverlay | null>(null)
  const activeTabIdRef = useRef(activeTabId)
  const panelVisibleRef = useRef(panelVisible)
  const screenOcclusionPresentRef = useRef(false)
  const overlappingOverlayPresentRef = useRef(false)
  const nativeHiddenRef = useRef(false)
  const transitionVersionRef = useRef(0)
  const paintIdRef = useRef(0)
  const pendingPaintRef = useRef<PendingPaint | null>(null)
  const paintFramesRef = useRef<number[]>([])
  const reconcileChainRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const mountedRef = useRef(true)
  const getHostRectRef = useRef(getHostRect)
  activeTabIdRef.current = activeTabId
  panelVisibleRef.current = panelVisible
  getHostRectRef.current = getHostRect

  const updateSnapshotRender = useCallback((render: SnapshotRender | null) => {
    snapshotRenderRef.current = render
    if (mountedRef.current) setSnapshotRender(render)
  }, [])

  const updateSnapshotLayer = useCallback(
    (layer: BrowserPanelSnapshotLayer) => {
      const render = snapshotRenderRef.current
      if (!render || render.layer === layer) return
      updateSnapshotRender({ ...render, layer })
    },
    [updateSnapshotRender]
  )

  const settlePaint = useCallback((paintId: number, painted: boolean) => {
    const pending = pendingPaintRef.current
    if (!pending || pending.paintId !== paintId) return
    pendingPaintRef.current = null
    pending.resolve(painted)
  }, [])

  const cancelPaintFrames = useCallback(() => {
    for (const frame of paintFramesRef.current) cancelAnimationFrame(frame)
    paintFramesRef.current = []
  }, [])

  const cancelPendingPaint = useCallback(() => {
    cancelPaintFrames()
    const pending = pendingPaintRef.current
    pendingPaintRef.current = null
    pending?.resolve(false)
  }, [cancelPaintFrames])

  useLayoutEffect(() => {
    cancelPaintFrames()
    const render = snapshotRender
    const pending = pendingPaintRef.current
    if (!render || !pending || pending.paintId !== render.paintId) return

    // The frame was decoded before commit. Two animation frames now establish
    // that the DOM replacement itself reached the compositor before the native
    // WebContentsView is hidden.
    const first = requestAnimationFrame(() => {
      const second = requestAnimationFrame(() => {
        paintFramesRef.current = []
        settlePaint(render.paintId, true)
      })
      paintFramesRef.current = [second]
    })
    paintFramesRef.current = [first]
    return cancelPaintFrames
  }, [cancelPaintFrames, settlePaint, snapshotRender])

  const onSnapshotError = useCallback(() => {
    const render = snapshotRenderRef.current
    if (render) settlePaint(render.paintId, false)
  }, [settlePaint])

  const desiredLayer = useCallback((): BrowserPanelSnapshotLayer | null => {
    if (!panelVisibleRef.current) return null
    if (screenOcclusionPresentRef.current) return 'modal'
    if (
      pendingOverlayRef.current ||
      activeOverlayRef.current ||
      overlappingOverlayPresentRef.current
    )
      return 'popover'
    return null
  }, [])

  const shouldKeepNativeHidden = useCallback(
    () => nativeHiddenRef.current && desiredLayer() !== null,
    [desiredLayer]
  )

  const reconcile = useCallback(
    async (version: number): Promise<boolean> => {
      if (!mountedRef.current || version !== transitionVersionRef.current) return false

      let desired = desiredLayer()
      if (!desired) {
        if (nativeHiddenRef.current) {
          const revealed = await setBrowserPanelOccluded(false, scopeId).catch(() => false)
          if (!revealed) return false
          nativeHiddenRef.current = false
        }
        if (
          mountedRef.current &&
          version === transitionVersionRef.current &&
          desiredLayer() === null
        ) {
          updateSnapshotRender(null)
        }
        return true
      }

      /** Reuse valid frames across layer changes to avoid revealing through an overlay. */
      if (nativeHiddenRef.current) {
        const frame = snapshotRenderRef.current?.frame
        if (
          desired === 'modal' ||
          (frame &&
            (!activeTabIdRef.current || frame.tabId === activeTabIdRef.current) &&
            snapshotMatchesHost(frame, getHostRectRef.current?.() ?? null))
        ) {
          if (frame) updateSnapshotLayer(desired)
          return true
        }

        /** A lingering overlay must capture the new page after a tab or panel geometry change. */
        const revealed = await setBrowserPanelOccluded(false, scopeId).catch(() => false)
        if (!revealed) return false
        nativeHiddenRef.current = false
        updateSnapshotRender(null)
        if (!mountedRef.current || version !== transitionVersionRef.current) return false
        desired = desiredLayer()
        if (!desired) return true
      }

      // Modal scroll locking can alter panel geometry between capture and the
      // final native hide. One fresh capture retries that now-settled layout.
      const maxAttempts = desired === 'modal' ? 3 : 2
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const frame = await captureBrowserPanelSnapshot(scopeId).catch(() => null)
        if (!mountedRef.current || version !== transitionVersionRef.current) return false
        desired = desiredLayer()
        if (!desired) return false
        if (!frame || (activeTabIdRef.current && frame.tabId !== activeTabIdRef.current)) {
          continue
        }

        const decoded = await decodeSnapshot(frame.dataUrl)
        if (!mountedRef.current || version !== transitionVersionRef.current) return false
        desired = desiredLayer()
        if (!desired || !decoded) continue

        // Painting a capture whose geometry no longer matches the host is the
        // flash: a modal's scroll lock changes the window's content width
        // between capture and paint, so the replacement lands offset from the
        // page it is standing in for. Skip that frame and re-capture at the
        // settled layout instead of showing a misaligned one.
        if (!snapshotMatchesHost(frame, getHostRectRef.current?.() ?? null)) continue

        const paintId = ++paintIdRef.current
        const painted = new Promise<boolean>((resolve) => {
          pendingPaintRef.current = { paintId, resolve }
        })
        updateSnapshotRender({ frame, layer: desired, paintId })
        const paintTimeout = window.setTimeout(
          () => settlePaint(paintId, false),
          SNAPSHOT_PAINT_TIMEOUT_MS
        )
        const didPaint = await painted
        window.clearTimeout(paintTimeout)
        if (!mountedRef.current || version !== transitionVersionRef.current) return false
        desired = desiredLayer()
        if (!desired || !didPaint) continue

        const hidden = await setBrowserPanelOccluded(true, scopeId).catch(() => false)
        if (!mountedRef.current) {
          if (hidden) await setBrowserPanelOccluded(false, scopeId).catch(() => false)
          return false
        }

        // A newly queued reason can take ownership of the frame that just hid
        // successfully. This is the popover -> modal race: transfer the lease
        // instead of briefly revealing and taking another screenshot.
        const latestDesired = desiredLayer()
        if (hidden && latestDesired) {
          nativeHiddenRef.current = true
          updateSnapshotLayer(latestDesired)
          return true
        }
        if (hidden) {
          nativeHiddenRef.current = true
          const revealed = await setBrowserPanelOccluded(false, scopeId).catch(() => false)
          if (revealed) {
            nativeHiddenRef.current = false
            if (version === transitionVersionRef.current) updateSnapshotRender(null)
          }
          return false
        }

        if (version !== transitionVersionRef.current) return false
        // Keep the last painted replacement available while a modal retries.
        // Ordinary popovers need a pixel-exact swap or their native fallback.
        if (desired !== 'modal') updateSnapshotRender(null)
        desired = desiredLayer()
        if (!desired) return false
      }

      // Full-screen effects have a fail-safe path that hides only visibility,
      // never geometry. It is intentionally modal-only: browser popovers must
      // stay pixel-neutral and retain their existing native-menu fallback.
      if (
        version === transitionVersionRef.current &&
        desiredLayer() === 'modal' &&
        supportsAtomicBrowserPanelOcclusion()
      ) {
        const hidden = await setBrowserPanelOccluded(true, scopeId, true).catch(() => false)
        if (!mountedRef.current) {
          if (hidden) await setBrowserPanelOccluded(false, scopeId).catch(() => false)
          return false
        }
        if (hidden && desiredLayer() === 'modal') {
          nativeHiddenRef.current = true
          if (snapshotRenderRef.current) updateSnapshotLayer('modal')
          return true
        }
        if (hidden) {
          nativeHiddenRef.current = true
          const revealed = await setBrowserPanelOccluded(false, scopeId).catch(() => false)
          if (revealed) nativeHiddenRef.current = false
        }
      }

      if (version === transitionVersionRef.current && !nativeHiddenRef.current) {
        updateSnapshotRender(null)
      }
      return false
    },
    [desiredLayer, scopeId, settlePaint, updateSnapshotLayer, updateSnapshotRender]
  )

  const scheduleReconcile = useCallback(async (): Promise<boolean> => {
    const version = ++transitionVersionRef.current
    cancelPendingPaint()
    const run = reconcileChainRef.current.then(
      () => reconcile(version),
      () => reconcile(version)
    )
    reconcileChainRef.current = run
    let current = run
    let ready = await current
    /** A newer request can service the same overlay while superseding its original transition. */
    while (!ready && mountedRef.current && current !== reconcileChainRef.current) {
      current = reconcileChainRef.current
      ready = await current
    }
    return ready
  }, [cancelPendingPaint, reconcile])

  const clearBrowserOverlay = useCallback(() => {
    const onOwnershipLost = activeOverlayOwnershipLostRef.current
    pendingOverlayRef.current = null
    activeOverlayRef.current = null
    activeOverlayOwnershipLostRef.current = null
    if (mountedRef.current) setActiveOverlay(null)
    onOwnershipLost?.()
  }, [])

  const prepareScreenOcclusion = useCallback((): Promise<boolean> => {
    if (!panelVisibleRef.current) return Promise.resolve(true)
    screenOcclusionPresentRef.current = true
    clearBrowserOverlay()
    return scheduleReconcile()
  }, [clearBrowserOverlay, scheduleReconcile])

  const closeOverlay = useCallback(
    async (overlay: BrowserPanelOverlay) => {
      if (activeOverlayRef.current !== overlay && pendingOverlayRef.current !== overlay) {
        await reconcileChainRef.current
        return
      }
      if (activeOverlayRef.current === overlay) {
        activeOverlayRef.current = null
        activeOverlayOwnershipLostRef.current = null
        setActiveOverlay(null)
      }
      if (pendingOverlayRef.current === overlay) pendingOverlayRef.current = null
      await scheduleReconcile()
    },
    [scheduleReconcile]
  )

  const requestOverlay = useCallback(
    async (
      overlay: BrowserPanelOverlay,
      fallback: () => void,
      onOwnershipLost?: () => void
    ): Promise<boolean> => {
      if (!panelVisibleRef.current || screenOcclusionPresentRef.current) return false
      if (activeOverlayRef.current === overlay) return true
      if (pendingOverlayRef.current === overlay) {
        await reconcileChainRef.current
        return activeOverlayRef.current === overlay
      }

      // A different renderer popover can replace the current one without
      // revealing the native page between them. Keeping a pending popover owns
      // the existing captured frame while the old controlled menu closes.
      if (activeOverlayRef.current) clearBrowserOverlay()
      pendingOverlayRef.current = overlay
      const ready = await scheduleReconcile()
      if (!mountedRef.current || pendingOverlayRef.current !== overlay) return false

      if (ready && nativeHiddenRef.current && desiredLayer() === 'popover') {
        pendingOverlayRef.current = null
        activeOverlayRef.current = overlay
        activeOverlayOwnershipLostRef.current = onOwnershipLost ?? null
        setActiveOverlay(overlay)
        return true
      }

      pendingOverlayRef.current = null
      await scheduleReconcile()
      fallback()
      return false
    },
    [clearBrowserOverlay, desiredLayer, scheduleReconcile]
  )

  // The canonical modal pauses its first visible frame and dispatches this
  // event from a layout effect. Register the whole capture/paint/native-hide
  // transition with that gate so the chat, terminal, and browser all begin the
  // real backdrop animation together instead of the browser catching up a
  // frame or two later. The DOM observer below remains the fallback for custom
  // modal implementations that have not adopted the pre-paint handshake.
  useInsertionEffect(() => {
    const handlePrepare = (event: Event) => {
      const detail = (event as CustomEvent<NativeSurfaceOcclusionPrepareDetail>).detail
      if (
        !panelVisibleRef.current ||
        !supportsAtomicBrowserPanelOcclusion() ||
        (detail?.kind !== 'modal' && detail?.kind !== 'takeover') ||
        typeof detail.waitUntil !== 'function'
      ) {
        return
      }
      detail.waitUntil(
        prepareScreenOcclusion().then((ready) => {
          if (!ready) throw new Error('The native browser surface could not be occluded')
        })
      )
    }
    window.addEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, handlePrepare)
    return () => window.removeEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, handlePrepare)
  }, [prepareScreenOcclusion])

  // Full-screen effect markers are global to the renderer, while this browser
  // component can remain mounted behind another resource. Observe only while
  // its panel is actually visible and retain the lease through Radix's
  // closed-state exit animation, until the final marker leaves the DOM.
  useEffect(() => {
    const syncScreenOcclusionPresence = () => {
      const present = panelVisible && hasNativeSurfaceOcclusion()
      if (screenOcclusionPresentRef.current === present) return
      if (present) {
        void prepareScreenOcclusion()
        return
      }
      screenOcclusionPresentRef.current = false
      void scheduleReconcile()
    }

    syncScreenOcclusionPresence()
    if (!panelVisible) {
      clearBrowserOverlay()
      void scheduleReconcile()
      return
    }

    const observer = new MutationObserver((records) => {
      // Chat streaming and ordinary popovers mutate the Sim DOM frequently.
      // Only rescan when a changed subtree actually carries this narrow marker.
      if (mutationsTouchNativeSurfaceOcclusion(records)) syncScreenOcclusionPresence()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-native-surface-occlusion'],
    })
    return () => {
      observer.disconnect()
      if (screenOcclusionPresentRef.current) {
        screenOcclusionPresentRef.current = false
        void scheduleReconcile()
      }
    }
  }, [clearBrowserOverlay, panelVisible, prepareScreenOcclusion, scheduleReconcile])

  useEffect(() => {
    if (!panelVisible || !supportsAtomicBrowserPanelOcclusion()) return
    const stop = observeOverlappingOverlays(
      () => getHostRectRef.current?.() ?? null,
      (overlapping) => {
        overlappingOverlayPresentRef.current = overlapping
        return scheduleReconcile()
      }
    )
    return () => {
      stop()
      overlappingOverlayPresentRef.current = false
      void scheduleReconcile()
    }
  }, [activeTabId, panelVisible, scheduleReconcile])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      panelVisibleRef.current = false
      screenOcclusionPresentRef.current = false
      overlappingOverlayPresentRef.current = false
      pendingOverlayRef.current = null
      activeOverlayRef.current = null
      activeOverlayOwnershipLostRef.current = null
      transitionVersionRef.current++
      cancelPendingPaint()
      // Run once now and once behind any in-flight capture/hide. The second
      // reveal closes the only race where unmount lands during the hide IPC.
      void setBrowserPanelOccluded(false, scopeId).catch(() => false)
      void reconcileChainRef.current.then(
        () => setBrowserPanelOccluded(false, scopeId).catch(() => false),
        () => setBrowserPanelOccluded(false, scopeId).catch(() => false)
      )
    }
  }, [cancelPendingPaint, scopeId])

  useEffect(() => {
    const frame = snapshotRenderRef.current?.frame
    if (!frame || !activeTabId || frame.tabId === activeTabId) return

    // A modal keeps its already-captured background until it closes. Revealing
    // the new live tab would put a native rectangle above the modal; a browser
    // popover, on the other hand, should close on a genuine tab change.
    if (screenOcclusionPresentRef.current) return
    clearBrowserOverlay()
    void scheduleReconcile()
  }, [activeTabId, clearBrowserOverlay, scheduleReconcile])

  return {
    activeOverlay,
    snapshot: snapshotRender?.frame ?? null,
    snapshotLayer: snapshotRender?.layer ?? 'popover',
    requestOverlay,
    closeOverlay,
    onSnapshotError,
    shouldKeepNativeHidden,
  }
}
