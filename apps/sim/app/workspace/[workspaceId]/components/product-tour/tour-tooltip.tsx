'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TooltipRenderProps } from 'react-joyride'
import { Button, Popover, PopoverAnchor, PopoverContent } from '@/components/emcn'

function mapPlacement(placement?: string): {
  side: 'top' | 'right' | 'bottom' | 'left'
  align: 'start' | 'center' | 'end'
} {
  switch (placement) {
    case 'top':
    case 'top-start':
      return { side: 'top', align: 'center' }
    case 'top-end':
      return { side: 'top', align: 'end' }
    case 'right':
    case 'right-start':
      return { side: 'right', align: 'center' }
    case 'right-end':
      return { side: 'right', align: 'end' }
    case 'bottom':
    case 'bottom-start':
      return { side: 'bottom', align: 'center' }
    case 'bottom-end':
      return { side: 'bottom', align: 'end' }
    case 'left':
    case 'left-start':
      return { side: 'left', align: 'center' }
    case 'left-end':
      return { side: 'left', align: 'end' }
    case 'center':
      return { side: 'bottom', align: 'center' }
    default:
      return { side: 'bottom', align: 'center' }
  }
}

function TourTooltipBody({
  step,
  continuous,
  index,
  isLastStep,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
}: Pick<
  TooltipRenderProps,
  | 'step'
  | 'continuous'
  | 'index'
  | 'isLastStep'
  | 'backProps'
  | 'closeProps'
  | 'primaryProps'
  | 'skipProps'
>) {
  return (
    <>
      <div className='px-[20px] pt-[20px] pb-[4px]'>
        {step.title && (
          <h3 className='font-[var(--font-weight-medium)] font-season text-[16px] text-[var(--text-primary)] leading-[120%] tracking-[-0.02em]'>
            {step.title as string}
          </h3>
        )}
      </div>
      <div className='px-[20px] pt-[8px] pb-[16px]'>
        <p className='text-[13.5px] text-[var(--text-secondary)] leading-[160%]'>{step.content}</p>
      </div>
      <div className='flex items-center justify-between border-[var(--border)] border-t px-[16px] py-[12px]'>
        <div className='flex items-center'>
          {!isLastStep && (
            <Button
              {...skipProps}
              variant='ghost'
              size='sm'
              className='text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            >
              Skip tour
            </Button>
          )}
        </div>
        <div className='flex items-center gap-[6px]'>
          {index > 0 && (
            <Button {...backProps} variant='default' className='h-[30px] px-[12px] text-[12.5px]'>
              Back
            </Button>
          )}
          {continuous ? (
            <Button
              {...primaryProps}
              variant='tertiary'
              className='h-[30px] px-[12px] text-[12.5px]'
            >
              {isLastStep ? 'Done' : 'Next'}
            </Button>
          ) : (
            <Button {...closeProps} variant='tertiary' className='h-[30px] px-[12px] text-[12.5px]'>
              Close
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

export function TourTooltip({
  continuous,
  index,
  step,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  isLastStep,
  tooltipProps,
}: TooltipRenderProps) {
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
  }, [step.target])

  const { side, align } = mapPlacement(step.placement)
  const isCentered = step.placement === 'center'

  const refCallback = (node: HTMLDivElement | null) => {
    if (!hasSetRef.current && tooltipProps.ref) {
      tooltipProps.ref(node)
      hasSetRef.current = true
    }
  }

  const bodyProps = {
    step,
    continuous,
    index,
    isLastStep,
    backProps,
    closeProps,
    primaryProps,
    skipProps,
  }

  const refDiv = (
    <div
      ref={refCallback}
      role={tooltipProps.role}
      aria-modal={tooltipProps['aria-modal']}
      style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
    />
  )

  if (!targetEl) {
    return refDiv
  }

  if (isCentered) {
    return (
      <>
        {refDiv}
        {createPortal(
          <div className='fixed inset-0 z-[10000200] flex items-center justify-center'>
            <div className='w-[340px] animate-tour-tooltip-in rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-1)] shadow-[0_8px_30px_rgba(0,0,0,0.3)] motion-reduce:animate-none'>
              <TourTooltipBody {...bodyProps} />
            </div>
          </div>,
          document.body
        )}
      </>
    )
  }

  return (
    <>
      {refDiv}
      {createPortal(
        <Popover open>
          <PopoverAnchor virtualRef={{ current: targetEl }} />
          <PopoverContent
            side={side}
            align={align}
            sideOffset={12}
            collisionPadding={16}
            border
            showArrow
            arrowClassName='fill-[var(--surface-3)] stroke-[var(--border-1)]'
            className='w-[340px] animate-tour-tooltip-in bg-[var(--surface-1)] p-0 motion-reduce:animate-none'
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <TourTooltipBody {...bodyProps} />
          </PopoverContent>
        </Popover>,
        document.body
      )}
    </>
  )
}
