'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { usePostHog } from 'posthog-js/react'
import { ACTIONS, type CallBackProps, EVENTS, STATUS, type Step } from 'react-joyride'
import { captureEvent } from '@/lib/posthog/client'

const logger = createLogger('useTour')

/** Transition delay before updating step index (ms) */
const FADE_OUT_MS = 80

interface UseTourOptions {
  /** Tour step definitions */
  steps: Step[]
  /** Custom event name to listen for manual triggers */
  triggerEvent?: string
  /** Identifier for logging */
  tourName?: string
  /** Analytics tour type for PostHog events */
  tourType?: 'nav' | 'workflow'
  /** When true, stops a running tour (e.g. navigating away from the relevant page) */
  disabled?: boolean
}

interface UseTourReturn {
  /** Whether the tour is currently running */
  run: boolean
  /** Current step index */
  stepIndex: number
  /** Key to force Joyride remount on retrigger */
  tourKey: number
  /** Whether the tooltip is visible (false during step transitions) */
  isTooltipVisible: boolean
  /** Whether this is the initial entrance animation */
  isEntrance: boolean
  /** Joyride callback handler */
  handleCallback: (data: CallBackProps) => void
}

/**
 * Shared hook for managing product tour state with smooth transitions.
 *
 * Handles manual triggering via custom events and coordinated fade
 * transitions between steps to prevent layout shift.
 */
export function useTour({
  steps,
  triggerEvent,
  tourName = 'tour',
  tourType,
  disabled = false,
}: UseTourOptions): UseTourReturn {
  const posthog = usePostHog()
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [tourKey, setTourKey] = useState(0)
  const [isTooltipVisible, setIsTooltipVisible] = useState(true)
  const [isEntrance, setIsEntrance] = useState(true)

  const retriggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)

  /**
   * Schedules a two-frame rAF to reveal the tooltip after the browser
   * finishes repositioning. Stores the outer frame ID in `rafRef` so
   * it can be cancelled on unmount or when the tour is interrupted.
   */
  const scheduleReveal = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        setIsTooltipVisible(true)
      })
    })
  }, [])

  /** Cancels any pending transition timer and rAF reveal */
  const cancelPendingTransitions = useCallback(() => {
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const stopTour = useCallback(() => {
    cancelPendingTransitions()
    setRun(false)
    setIsTooltipVisible(true)
    setIsEntrance(true)
  }, [cancelPendingTransitions])

  /** Transition to a new step with a coordinated fade-out/fade-in */
  const transitionToStep = useCallback(
    (newIndex: number) => {
      if (newIndex < 0 || newIndex >= steps.length) {
        stopTour()
        return
      }

      setIsTooltipVisible(false)
      cancelPendingTransitions()

      transitionTimerRef.current = setTimeout(() => {
        transitionTimerRef.current = null
        setStepIndex(newIndex)
        setIsEntrance(false)
        scheduleReveal()
      }, FADE_OUT_MS)
    },
    [steps.length, stopTour, cancelPendingTransitions, scheduleReveal]
  )

  useEffect(() => {
    if (!run) return
    const html = document.documentElement
    const prev = html.style.scrollbarGutter
    html.style.scrollbarGutter = 'stable'
    return () => {
      html.style.scrollbarGutter = prev
    }
  }, [run])

  /** Stop the tour when disabled becomes true (e.g. navigating away from the relevant page) */
  useEffect(() => {
    if (disabled && run) {
      stopTour()
      logger.info(`${tourName} paused — disabled became true`)
    }
  }, [disabled, run, tourName, stopTour])

  /** Listen for manual trigger events */
  useEffect(() => {
    if (!triggerEvent) return

    const handleTrigger = () => {
      setRun(false)
      setTourKey((k) => k + 1)

      if (retriggerTimerRef.current) {
        clearTimeout(retriggerTimerRef.current)
      }

      retriggerTimerRef.current = setTimeout(() => {
        retriggerTimerRef.current = null
        setStepIndex(0)
        setIsEntrance(true)
        setIsTooltipVisible(false)
        setRun(true)
        logger.info(`${tourName} triggered via event`)
        scheduleReveal()
        if (tourType) {
          captureEvent(posthog, 'tour_started', { tour_type: tourType })
        }
      }, 50)
    }

    window.addEventListener(triggerEvent, handleTrigger)
    return () => {
      window.removeEventListener(triggerEvent, handleTrigger)
      if (retriggerTimerRef.current) {
        clearTimeout(retriggerTimerRef.current)
      }
    }
  }, [triggerEvent, tourName, scheduleReveal])

  /** Clean up all pending async work on unmount */
  useEffect(() => {
    return () => {
      cancelPendingTransitions()
      if (retriggerTimerRef.current) {
        clearTimeout(retriggerTimerRef.current)
      }
    }
  }, [cancelPendingTransitions])

  const handleCallback = useCallback(
    (data: CallBackProps) => {
      const { action, index, status, type } = data

      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        stopTour()
        logger.info(`${tourName} ended`, { status })
        if (tourType) {
          if (status === STATUS.FINISHED) {
            captureEvent(posthog, 'tour_completed', { tour_type: tourType })
          } else {
            captureEvent(posthog, 'tour_skipped', { tour_type: tourType, step_index: index })
          }
        }
        return
      }

      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        if (action === ACTIONS.CLOSE) {
          stopTour()
          logger.info(`${tourName} closed by user`)
          if (tourType) {
            captureEvent(posthog, 'tour_skipped', { tour_type: tourType, step_index: index })
          }
          return
        }

        const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1)

        if (type === EVENTS.TARGET_NOT_FOUND) {
          logger.info(`${tourName} step target not found, skipping`, {
            stepIndex: index,
            target: steps[index]?.target,
          })
        }

        transitionToStep(nextIndex)
      }
    },
    [stopTour, transitionToStep, steps, tourName, tourType, posthog]
  )

  return {
    run,
    stepIndex,
    tourKey,
    isTooltipVisible,
    isEntrance,
    handleCallback,
  }
}
