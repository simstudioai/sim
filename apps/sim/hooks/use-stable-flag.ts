import { useEffect, useRef, useState } from 'react'

export interface StableFlagOptions {
  /**
   * Time `value` must stay continuously true before the flag turns on. Suppresses
   * brief flashes for blips that heal within the window. Defaults to `0` (no delay).
   */
  delayMs?: number
  /**
   * Minimum time the flag stays on once shown, even if `value` clears immediately
   * after. Prevents a flash-and-vanish when `value` is true just past `delayMs`.
   * Defaults to `0` (clears as soon as `value` does).
   */
  minVisibleMs?: number
}

/**
 * Framework-agnostic state machine behind {@link useStableFlag}. Extracted so the
 * anti-flicker timing can be unit-tested with fake timers without a DOM. Relies on
 * the ambient `setTimeout`/`clearTimeout`/`Date.now`, which fake timers replace.
 *
 * `onChange` fires whenever the smoothed flag flips. `setValue` is idempotent — it
 * is safe to feed it the same value repeatedly (e.g. from React effect re-runs).
 */
export function createStableFlagController(
  onChange: (active: boolean) => void,
  { delayMs = 0, minVisibleMs = 0 }: StableFlagOptions = {}
) {
  let active = false
  let shownAt: number | null = null
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const clearShow = () => {
    if (showTimer !== null) {
      clearTimeout(showTimer)
      showTimer = null
    }
  }
  const clearHide = () => {
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  const show = () => {
    showTimer = null
    shownAt = Date.now()
    active = true
    onChange(true)
  }
  const hide = () => {
    hideTimer = null
    shownAt = null
    active = false
    onChange(false)
  }

  return {
    setValue(value: boolean) {
      if (value) {
        clearHide()
        if (active || showTimer !== null) {
          return
        }
        showTimer = setTimeout(show, delayMs)
        return
      }

      clearShow()
      if (!active || hideTimer !== null) {
        return
      }

      const elapsed = shownAt === null ? minVisibleMs : Date.now() - shownAt
      const remaining = minVisibleMs - elapsed
      if (remaining <= 0) {
        hide()
        return
      }
      hideTimer = setTimeout(hide, remaining)
    },
    dispose() {
      clearShow()
      clearHide()
    },
  }
}

/**
 * Anti-flicker boolean. Mirrors `value` but smooths both edges so transient
 * toggles never produce a visible flash:
 *
 * - Rising edge — `value` must hold true for `delayMs` before the flag turns on.
 * - Falling edge — once on, the flag stays on for at least `minVisibleMs`.
 *
 * With both options at `0` it returns `value` unchanged (after a tick). Useful for
 * connection/loading indicators that would otherwise flicker on sub-second changes.
 */
export function useStableFlag(value: boolean, options: StableFlagOptions = {}): boolean {
  const [active, setActive] = useState(false)
  const { delayMs = 0, minVisibleMs = 0 } = options
  const valueRef = useRef(value)
  valueRef.current = value
  const controllerRef = useRef<ReturnType<typeof createStableFlagController> | null>(null)

  useEffect(() => {
    // Reset to the fresh controller's baseline. Without this, recreating the
    // controller on an options change while `active` is true and `value` is
    // already false would strand the React state at true — the new controller
    // starts internally false, so its `setValue(false)` early-returns and never
    // emits `onChange(false)`.
    setActive(false)
    const controller = createStableFlagController(setActive, { delayMs, minVisibleMs })
    controllerRef.current = controller
    controller.setValue(valueRef.current)
    return () => {
      controller.dispose()
      controllerRef.current = null
    }
  }, [delayMs, minVisibleMs])

  useEffect(() => {
    controllerRef.current?.setValue(value)
  }, [value])

  return active
}
