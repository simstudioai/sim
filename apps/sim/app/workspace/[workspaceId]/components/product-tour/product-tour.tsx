'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { navTourSteps } from '@/app/workspace/[workspaceId]/components/product-tour/nav-tour-steps'
import type { TourState } from '@/app/workspace/[workspaceId]/components/product-tour/tour-shared'
import {
  getSharedJoyrideProps,
  TourStateContext,
  TourTooltipAdapter,
} from '@/app/workspace/[workspaceId]/components/product-tour/tour-shared'
import { useTour } from '@/app/workspace/[workspaceId]/components/product-tour/use-tour'

const Joyride = dynamic(() => import('react-joyride'), {
  ssr: false,
})

const NAV_TOUR_STORAGE_KEY = 'sim-nav-tour-completed-v1'
export const START_NAV_TOUR_EVENT = 'start-nav-tour'

export function NavTour() {
  const pathname = usePathname()
  const isWorkflowPage = /\/w\/[^/]+/.test(pathname)

  const { run, stepIndex, tourKey, isTooltipVisible, isEntrance, handleCallback } = useTour({
    steps: navTourSteps,
    storageKey: NAV_TOUR_STORAGE_KEY,
    autoStartDelay: 1200,
    resettable: true,
    triggerEvent: START_NAV_TOUR_EVENT,
    tourName: 'Navigation tour',
    disabled: isWorkflowPage,
  })

  const tourState = useMemo<TourState>(
    () => ({
      isTooltipVisible,
      isEntrance,
      totalSteps: navTourSteps.length,
    }),
    [isTooltipVisible, isEntrance]
  )

  return (
    <TourStateContext.Provider value={tourState}>
      <Joyride
        key={tourKey}
        steps={navTourSteps}
        run={run}
        stepIndex={stepIndex}
        callback={handleCallback}
        continuous
        disableScrolling
        disableScrollParentFix
        disableOverlayClose
        spotlightPadding={4}
        tooltipComponent={TourTooltipAdapter}
        {...getSharedJoyrideProps({ spotlightBorderRadius: 8 })}
      />
    </TourStateContext.Provider>
  )
}
