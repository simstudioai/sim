'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { TooltipRenderProps } from 'react-joyride'
import { TourTooltip } from '@/components/emcn'

/** Shared state passed from the tour component to the tooltip adapter via context */
export interface TourState {
  isTooltipVisible: boolean
  isEntrance: boolean
  totalSteps: number
}

export const TourStateContext = createContext<TourState>({
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
 * Reads transition state from TourStateContext to coordinate fade animations.
 */
export function TourTooltipAdapter({
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

  useEffect(() => {
    const { target } = step
    if (typeof target === 'string') {
      setTargetEl(document.querySelector<HTMLElement>(target))
    } else if (target instanceof HTMLElement) {
      setTargetEl(target)
    } else {
      setTargetEl(null)
    }
  }, [step])

  /**
   * Forwards the Joyride tooltip ref safely, handling both
   * callback refs and RefObject refs from the library.
   * Memoized to prevent ref churn (null → node cycling) on re-renders.
   */
  const setJoyrideRef = useCallback(
    (node: HTMLDivElement | null) => {
      const { ref } = tooltipProps
      if (!ref) return
      if (typeof ref === 'function') {
        ref(node)
      } else {
        ;(ref as React.MutableRefObject<HTMLDivElement | null>).current = node
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tooltipProps.ref]
  )

  const placement = mapPlacement(step.placement)

  return (
    <>
      <div
        ref={setJoyrideRef}
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

const SPOTLIGHT_TRANSITION =
  'top 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94), left 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94), width 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94), height 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'

/**
 * Returns the shared Joyride floaterProps and styles config used by both tours.
 * Only `spotlightPadding` and spotlight `borderRadius` differ between tours.
 */
export function getSharedJoyrideProps(overrides: { spotlightBorderRadius: number }) {
  return {
    floaterProps: {
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
    },
    styles: {
      options: {
        zIndex: 10000,
      },
      spotlight: {
        backgroundColor: 'transparent',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: overrides.spotlightBorderRadius,
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
        position: 'fixed' as React.CSSProperties['position'],
        transition: SPOTLIGHT_TRANSITION,
      },
      overlay: {
        backgroundColor: 'transparent',
        mixBlendMode: 'unset' as React.CSSProperties['mixBlendMode'],
        position: 'fixed' as React.CSSProperties['position'],
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
      },
    },
  } as const
}
