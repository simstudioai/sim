import { useCallback, useLayoutEffect, useRef } from 'react'
import { beginBrowserPanelDividerDrag } from '@/lib/browser-agent/transport'
import { readSeparatorKey, type SeparatorKey } from '@/lib/core/utils/separator-keys'
import { useChatPanelStore } from '@/stores/chat-panel/store'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

/**
 * Widest the panel may be laid out at, in CSS px.
 *
 * Two independent ceilings, and the tighter one wins: a viewport-share policy,
 * and the hard limit the chat column's own `min-width` imposes on the flex row.
 * Both have to be here, because a width written past either one does not render
 * — the row absorbs the difference silently, leaving the inline style reading a
 * value the panel is not actually at.
 *
 * Floored at MIN so a window too narrow to satisfy both keeps a usable panel
 * rather than collapsing it; below that the row overflows, which is the same
 * thing it did before and is only reachable at the minimum window size with the
 * sidebar expanded.
 */
export function maxPanelWidth(viewportWidth: number, containerWidth: number): number {
  return Math.max(
    MOTHERSHIP_WIDTH.MIN,
    Math.min(
      viewportWidth * MOTHERSHIP_WIDTH.MAX_PERCENTAGE,
      containerWidth - MOTHERSHIP_WIDTH.CHAT_MIN
    )
  )
}

function measureMaxWidth(el: HTMLElement): number {
  return maxPanelWidth(window.innerWidth, el.parentElement?.clientWidth ?? window.innerWidth)
}

/** What a divider drag measures once at pointerdown and holds for the gesture. */
export interface DragGeometry {
  /**
   * Viewport x of the panel's right edge. Measured, never assumed to be
   * `window.innerWidth` — the workspace chrome's padding and border inset the
   * panel from the viewport edge.
   */
  panelRight: number
  /** Where the pointer sat relative to the panel's left edge when grabbed. */
  grabOffset: number
  /** @see maxPanelWidth */
  maxWidth: number
}

/** Panel width for a pointer position. The only place the clamps live. */
export function panelWidthAt(clientX: number, geometry: DragGeometry): number {
  const { panelRight, grabOffset, maxWidth } = geometry
  return Math.max(MOTHERSHIP_WIDTH.MIN, Math.min(panelRight - (clientX - grabOffset), maxWidth))
}

/**
 * Viewport x the panel's left edge lands at for a pointer position, clamps
 * included.
 *
 * Defined in terms of {@link panelWidthAt} rather than from the pointer, so the
 * divider reported to the native browser view cannot describe a different edge
 * than the width write produces. Keeping these two derivations in one place is
 * the invariant — when they drifted apart the native view composited beside the
 * panel instead of on it, and alternated with the measured report every frame.
 */
export function dividerXAt(clientX: number, geometry: DragGeometry): number {
  return geometry.panelRight - panelWidthAt(clientX, geometry)
}

/** Width one arrow-key press on the divider moves the panel by, in CSS px. */
export const KEYBOARD_STEP_PX = 32

/**
 * Panel width for a separator key on the focused divider. The divider is the
 * panel's left edge, so moving it left widens the panel; Home and End jump to
 * the narrowest and widest the drag allows, with the same clamps as
 * {@link panelWidthAt}.
 */
export function keyboardPanelWidth(
  key: SeparatorKey,
  currentWidth: number,
  maxWidth: number
): number {
  if (key === 'min') return MOTHERSHIP_WIDTH.MIN
  if (key === 'max') return maxWidth
  const delta = key === 'left' ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX
  return Math.max(MOTHERSHIP_WIDTH.MIN, Math.min(currentWidth + delta, maxWidth))
}

/**
 * Pins a width without animating to it. The panel's width transition would
 * otherwise make the embedded browser view chase a moving rect for 200ms.
 */
function writeWidthInstantly(el: HTMLElement, width: number) {
  const prevTransition = el.style.transition
  el.style.transition = 'none'
  el.style.width = `${width}px`
  void el.offsetWidth
  el.style.transition = prevTransition
}

/** Restores the preference within the current layout without changing the saved width. */
function restorePanelWidth(el: HTMLElement, preferred: number | undefined) {
  if (preferred === undefined) {
    el.style.removeProperty('width')
    return
  }
  const width = Math.min(preferred, measureMaxWidth(el))
  if (el.style.width !== `${width}px`) writeWidthInstantly(el, width)
}

/** Mirrors the panel's current width and bounds onto the divider for assistive tech. */
function syncDividerValue(handle: HTMLElement, el: HTMLElement, maxWidth = measureMaxWidth(el)) {
  handle.setAttribute('aria-valuemin', String(MOTHERSHIP_WIDTH.MIN))
  handle.setAttribute('aria-valuemax', String(Math.round(maxWidth)))
  handle.setAttribute('aria-valuenow', String(Math.round(el.getBoundingClientRect().width)))
}

/** Synchronous storage hydration also covers panels that arrive after a lazy fallback. */
function readPreferredWidth(userId: string | undefined, scopeId: string): number | undefined {
  if (!useChatPanelStore.persist.hasHydrated()) void useChatPanelStore.persist.rehydrate()
  return userId ? useChatPanelStore.getState().widths[`${userId}:${scopeId}`] : undefined
}

interface MothershipResizeOptions {
  userId?: string
  collapsed: boolean
}

/**
 * Hook for managing resize of the MothershipView resource panel.
 *
 * Uses imperative DOM manipulation (zero React re-renders during drag) with
 * Pointer Events + setPointerCapture for unified mouse/touch/stylus support.
 * Attach `mothershipRef` to the MothershipView root div and bind
 * `handleResizePointerDown` to the drag handle's onPointerDown.
 * Bind `handleResizeKeyDown` and `handleResizeFocus` to the same handle so it is
 * keyboard-adjustable and reports its value to assistive tech.
 */
export function useMothershipResize(
  desktopScopeId: string,
  { userId, collapsed }: MothershipResizeOptions
) {
  const scopeRef = useRef(desktopScopeId)
  const mothershipRef = useRef<HTMLDivElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const focusedDividerRef = useRef<HTMLElement | null>(null)
  const preferredWidthRef = useRef<number | undefined>(undefined)

  const rememberWidth = useCallback(
    (width: number) => {
      preferredWidthRef.current = width
      if (userId) useChatPanelStore.getState().setWidth(userId, desktopScopeId, width)
    },
    [userId, desktopScopeId]
  )

  const restoreWidth = useCallback(() => {
    const el = mothershipRef.current
    if (!el || cleanupRef.current) return
    restorePanelWidth(el, collapsed ? undefined : preferredWidthRef.current)
    const divider = focusedDividerRef.current
    if (divider && document.activeElement === divider) syncDividerValue(divider, el)
  }, [collapsed])

  useLayoutEffect(() => {
    const store = useChatPanelStore.getState()
    if (store.resolveChatId(scopeRef.current) !== desktopScopeId) cleanupRef.current?.()
    scopeRef.current = desktopScopeId
    preferredWidthRef.current = readPreferredWidth(userId, desktopScopeId)
    restoreWidth()
  }, [desktopScopeId, userId, restoreWidth])

  /** DOM attachment owns gesture cleanup; pending chat adoption leaves the same panel attached. */
  const attachPanel = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      mothershipRef.current = el
      preferredWidthRef.current = readPreferredWidth(userId, scopeRef.current)
      let rafId: number | null = null
      const scheduleRestore = () => {
        rafId ??= requestAnimationFrame(() => {
          rafId = null
          restoreWidth()
        })
      }
      restoreWidth()
      const observer = new ResizeObserver(scheduleRestore)
      if (el.parentElement) observer.observe(el.parentElement)
      window.addEventListener('resize', scheduleRestore)
      return () => {
        cleanupRef.current?.()
        observer.disconnect()
        window.removeEventListener('resize', scheduleRestore)
        if (rafId !== null) cancelAnimationFrame(rafId)
        mothershipRef.current = null
      }
    },
    [userId, restoreWidth]
  )

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()

      const el = mothershipRef.current
      if (!el) return
      // Single-flight: a second press while a drag is live must not stack listeners
      if (cleanupRef.current) return

      const handle = e.currentTarget as HTMLElement
      const pointerId = e.pointerId
      handle.setPointerCapture(pointerId)

      // Pin to current rendered width so drag starts from the visual position
      const startRect = el.getBoundingClientRect()
      el.style.width = `${startRect.width}px`

      // Snapshot geometry avoids layout reads on every move; release applies fresh bounds.
      const geometry: DragGeometry = {
        panelRight: startRect.right,
        grabOffset: e.clientX - startRect.left,
        maxWidth: measureMaxWidth(el),
      }

      // The panel's left edge IS the divider. Handing it to the browser
      // transport lets the native browser view (when one is showing) be
      // repositioned arithmetically per pointer move instead of waiting for the
      // renderer's layout → measure → report round-trip; no-op (null) when no
      // browser resource is live
      const predictBrowserBounds = beginBrowserPanelDividerDrag(startRect.left, desktopScopeId)

      // Disable CSS transition to prevent animation lag during drag
      const prevTransition = el.style.transition
      el.style.transition = 'none'
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'

      let rafId: number | null = null
      let lastClientX: number | null = null

      const applyWidth = (clientX: number) => {
        el.style.width = `${panelWidthAt(clientX, geometry)}px`
      }

      // AbortController removes all listeners at once on cleanup/cancel/unmount
      const ac = new AbortController()
      const { signal } = ac

      const finish = (commit: boolean) => {
        ac.abort()
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        if (commit && lastClientX !== null) {
          rememberWidth(panelWidthAt(lastClientX, geometry))
        }
        // Flush the restored width before transitions return, so the native view
        // does not chase a 200ms catch-up animation.
        restorePanelWidth(el, preferredWidthRef.current)
        void el.offsetWidth
        // A cancelled frame may never change DOM size, so ResizeObserver cannot undo its prediction.
        const restoredRect = el.getBoundingClientRect()
        if (
          restoredRect.left === startRect.left &&
          restoredRect.top === startRect.top &&
          restoredRect.width === startRect.width &&
          restoredRect.height === startRect.height
        ) {
          predictBrowserBounds?.(restoredRect.left, scopeRef.current)
        }
        el.style.transition = prevTransition
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        cleanupRef.current = null
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        syncDividerValue(handle, el)
      }
      const cancel = () => finish(false)
      const cancelPointer = (event: PointerEvent) => {
        if (event.pointerId === pointerId) cancel()
      }
      cleanupRef.current = cancel

      handle.addEventListener(
        'pointermove',
        (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== pointerId) return
          lastClientX = moveEvent.clientX
          // Fast path first: hand the native browser view its next rect at
          // pointer-event time (clamped exactly like the width write below), a
          // full layout pass ahead of the measured geometry report
          predictBrowserBounds?.(dividerXAt(moveEvent.clientX, geometry), scopeRef.current)
          // Coalesce to one width write per frame: pointermove can outpace the
          // display refresh, and every unbatched write forces an extra layout
          // pass that the embedded browser view then has to chase
          rafId ??= requestAnimationFrame(() => {
            rafId = null
            if (lastClientX !== null) applyWidth(lastClientX)
          })
        },
        { signal }
      )

      handle.addEventListener(
        'pointerup',
        (upEvent: PointerEvent) => {
          if (upEvent.pointerId !== pointerId) return
          finish(true)
        },
        { signal }
      )

      // Browser fires pointercancel when it reclaims the gesture (scroll, palm rejection, etc.)
      // Without this, body cursor/userSelect and transition would be permanently stuck
      handle.addEventListener('pointercancel', cancelPointer, { signal })
      handle.addEventListener('lostpointercapture', cancelPointer, { signal })
      // A blur mid-drag (cmd-tab, window switch) would otherwise strand the
      // body cursor/userSelect overrides with no pointerup coming
      window.addEventListener('blur', cancel, { signal })
    },
    [desktopScopeId, rememberWidth]
  )

  /** Steps the panel width from the focused divider, never during a live drag. */
  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const key = readSeparatorKey(e)
      const el = mothershipRef.current
      if (!key || !el || cleanupRef.current) return
      const maxWidth = measureMaxWidth(el)
      const width = keyboardPanelWidth(key, el.getBoundingClientRect().width, maxWidth)
      e.preventDefault()
      e.stopPropagation()
      writeWidthInstantly(el, width)
      rememberWidth(width)
      syncDividerValue(e.currentTarget, el, maxWidth)
    },
    [rememberWidth]
  )

  /** Reports the current width when the divider takes focus, and while it keeps focus. */
  const handleResizeFocus = useCallback((e: React.FocusEvent<HTMLElement>) => {
    focusedDividerRef.current = e.currentTarget
    const el = mothershipRef.current
    if (el) syncDividerValue(e.currentTarget, el)
  }, [])

  return {
    mothershipRef: attachPanel,
    handleResizePointerDown,
    handleResizeKeyDown,
    handleResizeFocus,
  }
}
