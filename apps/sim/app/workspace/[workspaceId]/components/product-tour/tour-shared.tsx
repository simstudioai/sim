'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
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
