'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { TooltipRenderProps } from 'react-joyride'
import { TourTooltip } from '@/components/emcn'
import { useTour } from '@/app/workspace/[workspaceId]/components/product-tour/use-tour'
import { workflowTourSteps } from '@/app/workspace/[workspaceId]/components/product-tour/workflow-tour-steps'

const Joyride = dynamic(() => import('react-joyride'), {
  ssr: false,
})

const WORKFLOW_TOUR_STORAGE_KEY = 'sim-workflow-tour-completed-v1'
export const START_WORKFLOW_TOUR_EVENT = 'start-workflow-tour'

/** Shared state passed from the tour component to the tooltip adapter via context */
interface TourState {
  isTooltipVisible: boolean
  isEntrance: boolean
  totalSteps: number
}

const TourStateContext = createContext<TourState>({
  isTooltipVisible: true,
  isEntrance: true,
  totalSteps: 0,
})

/**
 * Maps Joyride placement strings to TourTooltip placement values.
 */
function mapPlacement(placement?: string): 'top' | 'right' | 'bottom' | 'left' | 'center' {
  switch (placement) {
    case 'top':
    case 'top-start':
    case 'top-end':
      return 'top'
    case 'right':
    case 'right-start':
    case 'right-end':
      return 'right'
    case 'bottom':
    case 'bottom-start':
    case 'bottom-end':
      return 'bottom'
    case 'left':
    case 'left-start':
    case 'left-end':
      return 'left'
    case 'center':
      return 'center'
    default:
      return 'bottom'
  }
}

/**
 * Adapter that bridges Joyride's tooltip render props to the EMCN TourTooltip component.
 */
function WorkflowTooltipAdapter({
  step,
  index,
  isLastStep,
  tooltipProps,
  primaryProps,
  backProps,
  closeProps,
}: TooltipRenderProps) {
  const { isTooltipVisible, isEntrance, totalSteps } = useContext(TourStateContext)
  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null)
  const hasSetRef = useRef(false)

  useEffect(() => {
    hasSetRef.current = false
    const { target } = step
    if (typeof target === 'string') {
      setTargetEl(document.querySelector<HTMLElement>(target))
    } else if (target instanceof HTMLElement) {
      setTargetEl(target)
    } else {
      setTargetEl(null)
    }
  }, [step])

  const refCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (!hasSetRef.current && tooltipProps.ref) {
        ;(tooltipProps.ref as React.RefCallback<HTMLDivElement>)(node)
        hasSetRef.current = true
      }
    },
    [tooltipProps.ref]
  )

  const placement = mapPlacement(step.placement)

  return (
    <>
      <div
        ref={refCallback}
        role={tooltipProps.role}
        aria-modal={tooltipProps['aria-modal']}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      />
      <TourTooltip
        title={step.title as string}
        description={step.content}
        step={index + 1}
        totalSteps={totalSteps}
        placement={placement}
        targetEl={targetEl}
        isFirst={index === 0}
        isLast={isLastStep}
        isVisible={isTooltipVisible}
        isEntrance={isEntrance && index === 0}
        onNext={primaryProps.onClick as () => void}
        onBack={backProps.onClick as () => void}
        onClose={closeProps.onClick as () => void}
      />
    </>
  )
}

/**
 * Workflow tour that covers the canvas, blocks, copilot, and deployment.
 * Runs on first workflow visit and can be retriggered via "Take a tour".
 */
export function WorkflowTour() {
  const { run, stepIndex, tourKey, isTooltipVisible, isEntrance, handleCallback } = useTour({
    steps: workflowTourSteps,
    storageKey: WORKFLOW_TOUR_STORAGE_KEY,
    autoStartDelay: 800,
    resettable: true,
    triggerEvent: START_WORKFLOW_TOUR_EVENT,
    tourName: 'Workflow tour',
  })

  const tourState = useMemo<TourState>(
    () => ({
      isTooltipVisible,
      isEntrance,
      totalSteps: workflowTourSteps.length,
    }),
    [isTooltipVisible, isEntrance]
  )

  return (
    <TourStateContext.Provider value={tourState}>
      <Joyride
        key={tourKey}
        steps={workflowTourSteps}
        run={run}
        stepIndex={stepIndex}
        callback={handleCallback}
        continuous
        disableScrolling
        disableScrollParentFix
        disableOverlayClose
        spotlightPadding={1}
        tooltipComponent={WorkflowTooltipAdapter}
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
          },
          spotlight: {
            backgroundColor: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 6,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
            position: 'fixed' as React.CSSProperties['position'],
            transition:
              'top 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94), left 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94), width 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94), height 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          },
          overlay: {
            backgroundColor: 'transparent',
            mixBlendMode: 'unset' as React.CSSProperties['mixBlendMode'],
            position: 'fixed' as React.CSSProperties['position'],
            height: '100%',
            overflow: 'visible',
          },
        }}
      />
    </TourStateContext.Provider>
  )
}
