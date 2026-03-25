'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ACTIONS, type CallBackProps, EVENTS, STATUS, type Step } from 'react-joyride'

const logger = createLogger('useTour')

/** Transition delay before updating step index (ms) */
const FADE_OUT_MS = 80

interface UseTourOptions {
  /** Tour step definitions */
  steps: Step[]
  /** localStorage key for completion persistence */
  storageKey: string
  /** Delay before auto-starting the tour (ms) */
  autoStartDelay?: number
  /** Whether this tour can be reset/retriggered */
  resettable?: boolean
  /** Custom event name to listen for manual triggers */
  triggerEvent?: string
  /** Identifier for logging */
  tourName?: string
  /** When true, suppresses auto-start (e.g. to avoid overlapping with another active tour) */
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

function isTourCompleted(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true'
  } catch {
    return false
  }
}

function markTourCompleted(storageKey: string): void {
  try {
    localStorage.setItem(storageKey, 'true')
  } catch {
    logger.warn('Failed to persist tour completion', { storageKey })
  }
}

function clearTourCompletion(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    logger.warn('Failed to clear tour completion', { storageKey })
  }
}

/**
 * Tracks which tours have already attempted auto-start in this page session.
 * Module-level so it survives component remounts (e.g. navigating between
 * workflows remounts WorkflowTour), while still resetting on full page reload.
 */
const autoStartAttempted = new Set<string>()

/**
 * Shared hook for managing product tour state with smooth transitions.
 *
 * Handles auto-start on first visit, localStorage persistence,
 * manual triggering via custom events, and coordinated fade
 * transitions between steps to prevent layout shift.
 */
export function useTour({
  steps,
  storageKey,
  autoStartDelay = 1200,
  resettable = false,
  triggerEvent,
  tourName = 'tour',
  disabled = false,
}: UseTourOptions): UseTourReturn {
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [tourKey, setTourKey] = useState(0)
  const [isTooltipVisible, setIsTooltipVisible] = useState(true)
  const [isEntrance, setIsEntrance] = useState(true)

  const disabledRef = useRef(disabled)
  const retriggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

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
    markTourCompleted(storageKey)
  }, [storageKey, cancelPendingTransitions])

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

  /** Stop the tour when disabled becomes true (e.g. navigating away from the relevant page) */
  useEffect(() => {
    if (disabled && run) {
      cancelPendingTransitions()
      setRun(false)
      setIsTooltipVisible(true)
      setIsEntrance(true)
      logger.info(`${tourName} paused — disabled became true`)
    }
  }, [disabled, run, tourName, cancelPendingTransitions])

  /** Auto-start on first visit (once per page session per tour) */
  useEffect(() => {
    if (disabled || autoStartAttempted.has(storageKey) || isTourCompleted(storageKey)) return

    const timer = setTimeout(() => {
      if (disabledRef.current) return

      autoStartAttempted.add(storageKey)
      setStepIndex(0)
      setIsEntrance(true)
      setIsTooltipVisible(false)
      setRun(true)
      logger.info(`Auto-starting ${tourName}`)
      scheduleReveal()
    }, autoStartDelay)

    return () => clearTimeout(timer)
  }, [disabled, storageKey, autoStartDelay, tourName, scheduleReveal])

  /** Listen for manual trigger events */
  useEffect(() => {
    if (!triggerEvent || !resettable) return

    const handleTrigger = () => {
      setRun(false)
      clearTourCompletion(storageKey)
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
      }, 50)
    }

    window.addEventListener(triggerEvent, handleTrigger)
    return () => {
      window.removeEventListener(triggerEvent, handleTrigger)
      if (retriggerTimerRef.current) {
        clearTimeout(retriggerTimerRef.current)
      }
    }
  }, [triggerEvent, resettable, storageKey, tourName, scheduleReveal])

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
        return
      }

      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        if (action === ACTIONS.CLOSE) {
          stopTour()
          logger.info(`${tourName} closed by user`)
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
    [stopTour, transitionToStep, steps, tourName]
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
