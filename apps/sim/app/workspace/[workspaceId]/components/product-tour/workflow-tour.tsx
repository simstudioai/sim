'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { TourState } from '@/app/workspace/[workspaceId]/components/product-tour/tour-shared'
import {
  getSharedJoyrideProps,
  TourStateContext,
  TourTooltipAdapter,
} from '@/app/workspace/[workspaceId]/components/product-tour/tour-shared'
import { useTour } from '@/app/workspace/[workspaceId]/components/product-tour/use-tour'
import { workflowTourSteps } from '@/app/workspace/[workspaceId]/components/product-tour/workflow-tour-steps'

const Joyride = dynamic(() => import('react-joyride'), {
  ssr: false,
})

const WORKFLOW_TOUR_STORAGE_KEY = 'sim-workflow-tour-completed-v1'
export const START_WORKFLOW_TOUR_EVENT = 'start-workflow-tour'

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
        tooltipComponent={TourTooltipAdapter}
        {...getSharedJoyrideProps({ spotlightBorderRadius: 6 })}
      />
    </TourStateContext.Provider>
  )
}
