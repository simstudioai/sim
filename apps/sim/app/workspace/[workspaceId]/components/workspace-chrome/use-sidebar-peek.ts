'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Hover dwell before the card appears, so a cursor passing over the control doesn't trigger it. */
export const PEEK_OPEN_DELAY_MS = 90

/** Grace period after the pointer leaves, so a small overshoot doesn't retract the card. */
export const PEEK_CLOSE_DELAY_MS = 180

/** How long the card stays mounted while its exit animation runs. */
export const PEEK_EXIT_DURATION_MS = 150

/** Floor between pointer hit-tests, so a fast drag doesn't measure rects every event. */
export const PEEK_POINTER_SAMPLE_MS = 16

/**
 * Slack around the trigger and the card when hit-testing the pointer. The trigger sits
 * in the title-bar lane and the card starts below it, so a straight line between them
 * crosses a few pixels belonging to neither.
 */
const PEEK_GAP_TOLERANCE_PX = 12

/**
 * A transient floating layer — the wrapper Radix puts around popper content, so this
 * covers every menu, context menu, select, and popover the sidebar opens. Same
 * predicate emcn's own modal uses for "is a floating layer open" (`modal.tsx`).
 *
 * The pointer over one of these counts as inside the peek — otherwise reaching for a
 * context-menu item would retract the card underneath it.
 *
 * Deliberately NOT the broader `data-native-surface-overlay` marker: emcn stamps that
 * on the modal *scrim* too, which is `fixed inset-0`, so a `:not([aria-modal])` filter
 * cannot exclude it (Radix puts `aria-modal` on the content, a different node) and any
 * open modal would match at every pointer position and pin the card open. Tooltips are
 * `pointer-events-none`, so they are never an event target and need no entry here.
 */
const POPPER_SELECTOR = '[data-radix-popper-content-wrapper]'

/**
 * An *open* popper. The `data-state` filter ignores one animating closed, so pressing
 * Escape during a menu's exit still reaches the card. Mirrors emcn `modal.tsx`.
 */
const OPEN_POPPER_SELECTOR = `${POPPER_SELECTOR} [data-state="open"]`

type PeekPhase = 'closed' | 'open' | 'exiting'

function clearTimer(ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (ref.current) {
    clearTimeout(ref.current)
    ref.current = null
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Whether a client point falls inside an element, padded outward by `pad`.
 *
 * Geometric rather than DOM containment on purpose: the trigger is wrapped in a
 * tooltip whose subtree re-renders, and a containment check against a stale or
 * detached node reads as "outside" and retracts the card from under the pointer.
 * Coordinates cannot go stale.
 */
function containsPoint(element: Element | null, x: number, y: number, pad: number): boolean {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  return (
    x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad
  )
}

export interface SidebarPeekResult {
  /** Card is mounted as a floating overlay — drives positioning, chrome, and the expanded width. */
  isPeekActive: boolean
  /** Card is settled open. Goes false first on exit, so the exit animation can play. */
  isPeekOpen: boolean
  /** Attach to the floating card so the pointer hit-test can recognise it. */
  cardRef: React.RefObject<HTMLDivElement | null>
  /**
   * Attach to the control that opens the peek (the title-bar sidebar toggle). It
   * counts as inside the peek once open, so travelling from the control into the
   * card never reads as leaving.
   */
  triggerRef: React.RefObject<HTMLDivElement | null>
  onTriggerEnter: () => void
  onTriggerLeave: () => void
}

/**
 * Drives the desktop sidebar's hover-peek: hovering the title-bar sidebar toggle
 * floats the collapsed sidebar in over the content, and it retracts once the pointer
 * leaves. Clicking that same control still docks the sidebar for good.
 *
 * The `exiting` phase keeps the card mounted for {@link PEEK_EXIT_DURATION_MS} so its
 * exit animation can play; unmounting immediately would snap it away mid-animation.
 *
 * Retraction is detected from a document-level `pointermove` hit-test rather than
 * `mouseleave`, because the menus and tooltips the sidebar opens live in body
 * portals. A `mouseleave`-driven peek would retract the instant the pointer crossed
 * into one of those, so {@link POPPER_SELECTOR} counts as inside.
 *
 * @param enabled Whether the peek is available at all (collapsed, on the desktop shell).
 *   Also masks the returned flags, so a consumer never sees a stale open card for the
 *   render in which the peek became unavailable.
 * @param dismissed Force the card closed — a modal is open and owns the screen.
 */
export function useSidebarPeek(enabled: boolean, dismissed = false): SidebarPeekResult {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [phase, setPhase] = useState<PeekPhase>('closed')

  const open = useCallback(() => {
    clearTimer(closeTimerRef)
    clearTimer(exitTimerRef)
    setPhase('open')
  }, [])

  const close = useCallback(() => {
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
    clearTimer(exitTimerRef)
    setPhase((current) => (current === 'open' ? 'exiting' : current))
    exitTimerRef.current = setTimeout(
      () => {
        exitTimerRef.current = null
        setPhase('closed')
      },
      prefersReducedMotion() ? 0 : PEEK_EXIT_DURATION_MS
    )
  }, [])

  const onTriggerEnter = useCallback(() => {
    // `dismissed` is checked here too, not just in the effect below: that effect only
    // fires on the transition, so with a modal already open a hover would otherwise
    // float the card over it.
    if (!enabled || dismissed) return
    clearTimer(closeTimerRef)
    clearTimer(openTimerRef)
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null
      open()
    }, PEEK_OPEN_DELAY_MS)
  }, [dismissed, enabled, open])

  const onTriggerLeave = useCallback(() => {
    clearTimer(openTimerRef)
  }, [])

  /** Drop the card outright — no exit animation — once the peek stops being available. */
  useEffect(() => {
    if (enabled) return
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
    clearTimer(exitTimerRef)
    setPhase('closed')
  }, [enabled])

  /** A modal is a destination and owns the screen, so the transient card yields to it. */
  useEffect(() => {
    if (dismissed && phase === 'open') close()
  }, [close, dismissed, phase])

  useEffect(() => {
    if (phase !== 'open') return

    let lastSampleAt = Number.NEGATIVE_INFINITY

    const onPointerMove = (event: PointerEvent) => {
      // Sampled on the event's own clock rather than a frame callback: rAF is
      // throttled in an unfocused or occluded window, which would strand the card up.
      if (event.timeStamp - lastSampleAt < PEEK_POINTER_SAMPLE_MS) return
      lastSampleAt = event.timeStamp

      // The tolerance bridges the few px of title-bar lane between the trigger's
      // bottom edge and the card's top edge. Poppers are matched by DOM instead —
      // they can be anchored anywhere on screen.
      const target = event.target instanceof Element ? event.target : null
      const inside =
        containsPoint(cardRef.current, event.clientX, event.clientY, PEEK_GAP_TOLERANCE_PX) ||
        containsPoint(triggerRef.current, event.clientX, event.clientY, PEEK_GAP_TOLERANCE_PX) ||
        Boolean(target?.closest(POPPER_SELECTOR))
      if (inside) {
        clearTimer(closeTimerRef)
        return
      }
      if (!closeTimerRef.current) {
        closeTimerRef.current = setTimeout(() => {
          closeTimerRef.current = null
          close()
        }, PEEK_CLOSE_DELAY_MS)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // An open popper owns Escape first — dismissing a context menu shouldn't also
      // take the card out from under the pointer.
      if (event.key === 'Escape' && !document.querySelector(OPEN_POPPER_SELECTOR)) close()
    }

    document.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, phase])

  useEffect(
    () => () => {
      clearTimer(openTimerRef)
      clearTimer(closeTimerRef)
      clearTimer(exitTimerRef)
    },
    []
  )

  return {
    isPeekActive: phase !== 'closed' && enabled,
    isPeekOpen: phase === 'open' && enabled,
    cardRef,
    triggerRef,
    onTriggerEnter,
    onTriggerLeave,
  }
}
