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

  const hasAutoStarted = useRef(false)
  const retriggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopTour = useCallback(() => {
    setRun(false)
    setIsTooltipVisible(true)
    setIsEntrance(true)
    markTourCompleted(storageKey)
  }, [storageKey])

  /** Transition to a new step with a coordinated fade-out/fade-in */
  const transitionToStep = useCallback(
    (newIndex: number) => {
      if (newIndex < 0 || newIndex >= steps.length) {
        stopTour()
        return
      }

      /** Hide tooltip during transition */
      setIsTooltipVisible(false)

      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current)
      }

      transitionTimerRef.current = setTimeout(() => {
        transitionTimerRef.current = null
        setStepIndex(newIndex)
        setIsEntrance(false)

        /**
         * Wait for the browser to process the Radix Popover repositioning
         * before showing the tooltip at the new position.
         */
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsTooltipVisible(true)
          })
        })
      }, FADE_OUT_MS)
    },
    [steps.length, stopTour]
  )

  /** Stop the tour when disabled becomes true (e.g. navigating away from the relevant page) */
  useEffect(() => {
    if (disabled && run) {
      setRun(false)
      setIsTooltipVisible(true)
      setIsEntrance(true)
      logger.info(`${tourName} paused — disabled became true`)
    }
  }, [disabled, run, tourName])

  /** Auto-start on first visit */
  useEffect(() => {
    if (disabled || hasAutoStarted.current) return

    const timer = setTimeout(() => {
      hasAutoStarted.current = true
      if (!isTourCompleted(storageKey)) {
        setStepIndex(0)
        setIsEntrance(true)
        setIsTooltipVisible(false)
        setRun(true)
        logger.info(`Auto-starting ${tourName}`)

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsTooltipVisible(true)
          })
        })
      }
    }, autoStartDelay)

    return () => clearTimeout(timer)
  }, [storageKey, autoStartDelay, tourName, disabled])

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

      /**
       * Start with the tooltip hidden so Joyride can mount, find the
       * target element, and position its overlay/spotlight before the
       * tooltip card appears.
       */
      retriggerTimerRef.current = setTimeout(() => {
        retriggerTimerRef.current = null
        setStepIndex(0)
        setIsEntrance(true)
        setIsTooltipVisible(false)
        setRun(true)
        logger.info(`${tourName} triggered via event`)

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsTooltipVisible(true)
          })
        })
      }, 50)
    }

    window.addEventListener(triggerEvent, handleTrigger)
    return () => {
      window.removeEventListener(triggerEvent, handleTrigger)
      if (retriggerTimerRef.current) {
        clearTimeout(retriggerTimerRef.current)
      }
    }
  }, [triggerEvent, resettable, storageKey, tourName])

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current)
      }
    }
  }, [])

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
