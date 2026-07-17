import { useCallback, useEffect, useRef } from 'react'

interface UseDragResizeOptions {
  /** Cursor applied to the document body for the duration of the drag */
  cursor: 'ew-resize' | 'ns-resize'
  /**
   * Maps a pointer position to the clamped target dimension, or `null` to
   * ignore the move. Runs at most once per animation frame (before `apply`,
   * so a layout read here happens against clean layout) and once more on
   * release, so it may read layout but must stay cheap.
   */
  compute: (ev: PointerEvent) => number | null
  /**
   * Applies per-frame visual feedback (typically a CSS variable write).
   * Invoked inside requestAnimationFrame, at most once per frame.
   */
  apply: (value: number) => void
  /**
   * Persists the final value once when the drag ends. Not called when the
   * pointer never moved (a plain click on the handle).
   */
  commit: (value: number) => void
  /**
   * Optional drag-start hook (e.g. capture an anchor element, set a store
   * flag). Return `false` to abort the drag before any listeners are
   * attached.
   */
  onStart?: () => boolean | undefined
  /** Optional drag-end hook, invoked after teardown and commit */
  onEnd?: () => void
}

/**
 * Shared drag-resize mechanism with zero React renders during the drag.
 *
 * Architecture (mirrors the sidebar's `use-sidebar-resize.ts`):
 *
 * pointerdown  → capture the pointer on the handle (so move/up keep arriving
 *                even when the cursor leaves the window or crosses an iframe)
 * pointermove  → remember the latest pointer event and schedule a
 *                requestAnimationFrame callback that `compute`s the clamped
 *                value from it and `apply`s it, so both any layout read and
 *                the DOM write align with the browser paint cycle
 * pointerup    → tear down, `compute` the final value from the latest
 *                pointer event, `apply` and `commit` it once — deriving the
 *                final value from the event (rather than reading state back
 *                out of the DOM) means a fast single-frame flick is never
 *                lost to a cancelled RAF
 *
 * The drag is torn down by `pointerup`/`pointercancel` of the captured
 * pointer (other pointers are ignored, so a second touch cannot kill the
 * gesture) or window `blur`, so an interrupted gesture can never leave the
 * listeners or body cursor stuck. A single-flight guard prevents stacking
 * listeners across rapid presses, and an unmount cleanup tears down a drag
 * still in flight.
 */
export function useDragResize(options: UseDragResizeOptions) {
  const cleanupRef = useRef<(() => void) | null>(null)
  const optionsRef = useRef(options)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (cleanupRef.current) return
    if (optionsRef.current.onStart?.() === false) return

    const handle = e.currentTarget
    const pointerId = e.pointerId
    document.body.style.cursor = optionsRef.current.cursor
    document.body.style.userSelect = 'none'
    handle.setPointerCapture?.(pointerId)

    let rafId: number | null = null
    let lastEvent: PointerEvent | null = null

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      lastEvent = ev
      rafId ??= requestAnimationFrame(() => {
        rafId = null
        if (lastEvent === null) return
        const value = optionsRef.current.compute(lastEvent)
        if (value !== null) optionsRef.current.apply(value)
      })
    }

    const cleanup = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerEnd)
      document.removeEventListener('pointercancel', onPointerEnd)
      window.removeEventListener('blur', endDrag)
      cleanupRef.current = null
    }

    function endDrag() {
      cleanup()
      if (lastEvent !== null) {
        const value = optionsRef.current.compute(lastEvent)
        if (value !== null) {
          optionsRef.current.apply(value)
          optionsRef.current.commit(value)
        }
      }
      optionsRef.current.onEnd?.()
    }

    function onPointerEnd(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      endDrag()
    }

    cleanupRef.current = cleanup
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerEnd)
    document.addEventListener('pointercancel', onPointerEnd)
    window.addEventListener('blur', endDrag)
  }, [])

  useEffect(() => () => cleanupRef.current?.(), [])

  return { handlePointerDown }
}
