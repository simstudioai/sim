'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import dynamic from 'next/dynamic'
import { ACTIONS, type CallBackProps, EVENTS, STATUS } from 'react-joyride'
import { tourSteps } from './tour-steps'
import { TourTooltip } from './tour-tooltip'

const logger = createLogger('ProductTour')

const Joyride = dynamic(() => import('react-joyride'), {
  ssr: false,
})

const TOUR_STORAGE_KEY = 'sim-tour-completed-v1'
export const START_TOUR_EVENT = 'start-product-tour'

function isTourCompleted(): boolean {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function markTourCompleted(): void {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, 'true')
  } catch {
    logger.warn('Failed to persist tour completion to localStorage')
  }
}

export function resetTourCompletion(): void {
  try {
    localStorage.removeItem(TOUR_STORAGE_KEY)
  } catch {
    logger.warn('Failed to reset tour completion in localStorage')
  }
}

export function ProductTour() {
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [tourKey, setTourKey] = useState(0)

  const hasAutoStarted = useRef(false)
  const retriggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (hasAutoStarted.current) return
    hasAutoStarted.current = true

    const timer = setTimeout(() => {
      if (!isTourCompleted()) {
        setStepIndex(0)
        setRun(true)
        logger.info('Auto-starting product tour for first-time user')
      }
    }, 1200)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const handleStartTour = () => {
      setRun(false)
      resetTourCompletion()

      setTourKey((k) => k + 1)

      if (retriggerTimerRef.current) {
        clearTimeout(retriggerTimerRef.current)
      }

      retriggerTimerRef.current = setTimeout(() => {
        retriggerTimerRef.current = null
        setStepIndex(0)
        setRun(true)
        logger.info('Product tour triggered via custom event')
      }, 50)
    }

    window.addEventListener(START_TOUR_EVENT, handleStartTour)
    return () => {
      window.removeEventListener(START_TOUR_EVENT, handleStartTour)
      if (retriggerTimerRef.current) {
        clearTimeout(retriggerTimerRef.current)
      }
    }
  }, [])

  const stopTour = useCallback(() => {
    setRun(false)
    markTourCompleted()
  }, [])

  const handleCallback = useCallback(
    (data: CallBackProps) => {
      const { action, index, status, type } = data

      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        stopTour()
        logger.info('Product tour ended', { status })
        return
      }

      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        if (action === ACTIONS.CLOSE) {
          stopTour()
          logger.info('Product tour closed by user')
          return
        }

        const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1)

        if (type === EVENTS.TARGET_NOT_FOUND) {
          logger.info('Tour step target not found, skipping', {
            stepIndex: index,
            target: tourSteps[index]?.target,
          })
        }

        if (nextIndex >= tourSteps.length || nextIndex < 0) {
          stopTour()
          return
        }

        setStepIndex(nextIndex)
      }
    },
    [stopTour]
  )

  return (
    <Joyride
      key={tourKey}
      steps={tourSteps}
      run={run}
      stepIndex={stepIndex}
      callback={handleCallback}
      continuous
      showSkipButton
      showProgress
      disableScrolling
      disableOverlayClose
      spotlightPadding={6}
      tooltipComponent={TourTooltip}
      floaterProps={{
        disableAnimation: true,
        hideArrow: true,
        styles: {
          floater: {
            filter: 'none',
            opacity: 0,
            pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
            width: 0,
            height: 0,
          },
        },
      }}
      styles={{
        options: {
          zIndex: 10000,
          overlayColor: 'rgba(0, 0, 0, 0.5)',
        },
        spotlight: {
          backgroundColor: 'transparent',
          border: '1.5px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 8,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
        },
        overlay: {
          backgroundColor: 'transparent',
          mixBlendMode: 'unset' as React.CSSProperties['mixBlendMode'],
        },
      }}
    />
  )
}
