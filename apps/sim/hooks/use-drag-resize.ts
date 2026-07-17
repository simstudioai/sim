import { useCallback, useEffect, useRef } from 'react'

interface UseDragResizeOptions {
  /** Cursor applied to the document body for the duration of the drag */
  cursor: 'ew-resize' | 'ns-resize'
  /**
   * The CSS custom property this drag drives (e.g. `--panel-width`). During
   * the drag it is written as `${value}px`.
   */
  cssVar: string
  /**
   * Returns the element that consumes {@link cssVar} (or an ancestor of every
   * consumer). During the drag the variable is written here — a style recalc
   * scoped to that subtree — instead of on `:root`, where on a large document
   * every custom-property write recalculates the whole tree (~150x slower).
   * Captured once on drag start; a `null` return falls back to
   * `document.documentElement`.
   */
  getTarget: () => HTMLElement | null
  /**
   * Maps a pointer position to the clamped target dimension, or `null` to
   * ignore the move. Runs at most once per animation frame (before the write,
   * so a layout read here happens against clean layout) and once more on
   * release, so it may read layout but must stay cheap.
   */
  compute: (ev: PointerEvent) => number | null
  /**
   * Persists the final value once when the drag ends. Should write the
   * authoritative value to `:root` (typically via the store setter) so
   * on-demand readers of {@link cssVar} stay correct; the scoped override is
   * then removed. Not called when the pointer never moved (a plain click).
   */
  commit: (value: number) => void
  /**
   * Optional per-frame hook invoked after the variable is written (e.g. the
   * terminal's expanded-threshold store sync). Runs inside the rAF callback.
   */
  onApply?: (value: number) => void
  /**
   * Optional drag-start hook (e.g. set a resize class). Return `false` to
   * abort the drag before any listeners are attached.
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
 *                and capture the scoped target element (see {@link
 *                UseDragResizeOptions.getTarget})
 * pointermove  → remember the latest pointer event and schedule a
 *                requestAnimationFrame callback that `compute`s the clamped
 *                value from it and writes `cssVar` to the target element, so
 *                both any layout read and the DOM write align with the browser
 *                paint cycle
 * pointerup    → tear down, `compute` the final value from the latest pointer
 *                event, write it, `commit` it once, then drop the scoped
 *                override so the committed `:root` value takes over — deriving
 *                the final value from the event (rather than reading state back
 *                out of the DOM) means a fast single-frame flick is never lost
 *                to a cancelled RAF
 *
 * The drag is torn down by `pointerup`/`pointercancel` of the captured pointer
 * (other pointers are ignored, so a second touch cannot kill the gesture) or
 * window `blur`, so an interrupted gesture can never leave the listeners or
 * body cursor stuck. A single-flight guard prevents stacking listeners across
 * rapid presses, and an unmount cleanup tears down a drag still in flight.
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
    const { cssVar } = optionsRef.current
    const target = optionsRef.current.getTarget() ?? document.documentElement
    document.body.style.cursor = optionsRef.current.cursor
    document.body.style.userSelect = 'none'
    handle.setPointerCapture?.(pointerId)

    let rafId: number | null = null
    let lastEvent: PointerEvent | null = null

    const applyValue = (value: number) => {
      target.style.setProperty(cssVar, `${value}px`)
      optionsRef.current.onApply?.(value)
    }

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      lastEvent = ev
      rafId ??= requestAnimationFrame(() => {
        rafId = null
        if (lastEvent === null) return
        const value = optionsRef.current.compute(lastEvent)
        if (value !== null) applyValue(value)
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
          applyValue(value)
          optionsRef.current.commit(value)
          if (target !== document.documentElement) target.style.removeProperty(cssVar)
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
