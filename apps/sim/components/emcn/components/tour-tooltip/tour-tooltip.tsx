'use client'

import type * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { createPortal } from 'react-dom'
import { Button } from '@/components/emcn/components/button/button'
import { X } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

type TourTooltipPlacement = 'top' | 'right' | 'bottom' | 'left' | 'center'

interface TourTooltipProps {
  /** Title displayed at the top of the tooltip */
  title: string
  /** Description text below the title */
  description: React.ReactNode
  /** Current step number (1-based) */
  step: number
  /** Total number of steps in the tour */
  totalSteps: number
  /** Placement relative to the target element */
  placement?: TourTooltipPlacement
  /** Target DOM element to anchor the tooltip to */
  targetEl: HTMLElement | null
  /** Whether this is the first step (hides Back button visually) */
  isFirst?: boolean
  /** Whether this is the last step (changes Next to Done) */
  isLast?: boolean
  /** Controls tooltip visibility for smooth transitions */
  isVisible?: boolean
  /** Whether this is the initial entrance (plays full entrance animation) */
  isEntrance?: boolean
  /** Called when the user clicks Next or Done */
  onNext?: () => void
  /** Called when the user clicks Back */
  onBack?: () => void
  /** Called when the user dismisses the tour */
  onClose?: () => void
  /** Additional class names for the tooltip card */
  className?: string
}

const PLACEMENT_TO_SIDE: Record<
  Exclude<TourTooltipPlacement, 'center'>,
  'top' | 'right' | 'bottom' | 'left'
> = {
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
}

/**
 * Inner card content rendered inside the tooltip.
 * Separated for reuse between positioned and centered layouts.
 */
function TourTooltipCard({
  title,
  description,
  step,
  totalSteps,
  isFirst,
  isLast,
  onNext,
  onBack,
  onClose,
}: Pick<
  TourTooltipProps,
  | 'title'
  | 'description'
  | 'step'
  | 'totalSteps'
  | 'isFirst'
  | 'isLast'
  | 'onNext'
  | 'onBack'
  | 'onClose'
>) {
  return (
    <>
      <div className='flex items-start gap-[8px] px-[14px] pt-[12px] pb-[4px]'>
        <h3 className='flex-1 font-medium text-[13px] text-[var(--text-primary)] leading-[1.35]'>
          {title}
        </h3>
        <Button
          variant='ghost'
          size='sm'
          className='-mr-[2px] -mt-[1px] h-[20px] w-[20px] shrink-0 !p-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          onClick={onClose}
          aria-label='Close tour'
        >
          <X className='h-[10px] w-[10px]' />
        </Button>
      </div>

      <div className='px-[14px] pb-[12px]'>
        <p className='text-[12px] text-[var(--text-secondary)] leading-[1.6]'>{description}</p>
      </div>

      <div className='flex items-center justify-between px-[14px] pb-[12px]'>
        <span className='text-[11px] text-[var(--text-muted)] [font-variant-numeric:tabular-nums]'>
          {step} / {totalSteps}
        </span>
        <div className='flex items-center gap-[6px]'>
          <div className={cn(isFirst && 'pointer-events-none opacity-0')}>
            <Button variant='default' size='sm' onClick={onBack}>
              Back
            </Button>
          </div>
          <Button variant='tertiary' size='sm' onClick={onNext}>
            {isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </>
  )
}

/**
 * A positioned tooltip component for guided product tours.
 *
 * Anchors to a target DOM element using Radix Popover primitives for
 * collision-aware positioning. Supports centered placement for overlay steps.
 *
 * @example
 * ```tsx
 * <TourTooltip
 *   title="Welcome"
 *   description="This is your dashboard."
 *   step={1}
 *   totalSteps={5}
 *   placement="bottom"
 *   targetEl={document.querySelector('[data-tour="home"]')}
 *   onNext={handleNext}
 *   onClose={handleClose}
 * />
 * ```
 */
function TourTooltip({
  title,
  description,
  step,
  totalSteps,
  placement = 'bottom',
  targetEl,
  isFirst = false,
  isLast = false,
  isVisible = true,
  isEntrance = false,
  onNext,
  onBack,
  onClose,
  className,
}: TourTooltipProps) {
  if (typeof document === 'undefined') return null

  const isCentered = placement === 'center'

  const cardClasses = cn(
    'w-[300px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]',
    'shadow-[0_4px_16px_rgba(0,0,0,0.12)]',
    'transition-opacity duration-[80ms] ease-out',
    isVisible ? 'opacity-100' : 'opacity-0',
    isEntrance && isVisible && 'animate-tour-tooltip-in motion-reduce:animate-none',
    className
  )

  const cardContent = (
    <TourTooltipCard
      title={title}
      description={description}
      step={step}
      totalSteps={totalSteps}
      isFirst={isFirst}
      isLast={isLast}
      onNext={onNext}
      onBack={onBack}
      onClose={onClose}
    />
  )

  if (isCentered) {
    return createPortal(
      <div className='pointer-events-none fixed inset-0 z-[10000300] flex items-center justify-center'>
        <div className={cn(cardClasses, 'pointer-events-auto')}>{cardContent}</div>
      </div>,
      document.body
    )
  }

  if (!targetEl) return null

  return createPortal(
    <PopoverPrimitive.Root open>
      <PopoverPrimitive.Anchor virtualRef={{ current: targetEl }} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={PLACEMENT_TO_SIDE[placement] || 'bottom'}
          sideOffset={10}
          collisionPadding={12}
          avoidCollisions
          className='z-[10000300] outline-none'
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className={cardClasses}>{cardContent}</div>
          <PopoverPrimitive.Arrow width={14} height={7} asChild>
            <svg
              width={14}
              height={7}
              viewBox='0 0 14 7'
              preserveAspectRatio='none'
              className='fill-[var(--surface-1)] stroke-[var(--border)]'
            >
              <polygon points='0,0 14,0 7,7' className='stroke-none' />
              <polyline points='0,0 7,7 14,0' fill='none' strokeWidth={1} />
            </svg>
          </PopoverPrimitive.Arrow>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>,
    document.body
  )
}

export { TourTooltip }
export type { TourTooltipProps, TourTooltipPlacement }
