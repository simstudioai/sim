'use client'

import type * as React from 'react'
import { type RefObject, useRef } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/emcn/components/button/button'
import { cn } from '@/lib/core/utils/cn'

type TourTooltipPlacement = 'top' | 'right' | 'bottom' | 'left' | 'center'

interface TourCardProps {
  /** Title displayed in the card header */
  title: string
  /** Description text in the card body */
  description: React.ReactNode
  /** Current step number (1-based) */
  step: number
  /** Total number of steps in the tour */
  totalSteps: number
  /** Whether this is the first step (hides Back button) */
  isFirst?: boolean
  /** Whether this is the last step (changes Next to Done) */
  isLast?: boolean
  /** Called when the user clicks Next or Done */
  onNext?: () => void
  /** Called when the user clicks Back */
  onBack?: () => void
  /** Called when the user dismisses the tour */
  onClose?: () => void
}

function TourCard({
  title,
  description,
  step,
  totalSteps,
  isFirst,
  isLast,
  onNext,
  onBack,
  onClose,
}: TourCardProps) {
  return (
    <>
      <div className='flex items-center justify-between gap-2 px-4 pt-4 pb-2'>
        <h3 className='min-w-0 font-medium text-[var(--text-primary)] text-small leading-none'>
          {title}
        </h3>
        <Button
          variant='ghost'
          className='relative h-[16px] w-[16px] flex-shrink-0 p-0 before:absolute before:inset-[-14px] before:content-[""]'
          onClick={onClose}
          aria-label='Close tour'
        >
          <X className='h-[16px] w-[16px]' />
          <span className='sr-only'>Close</span>
        </Button>
      </div>

      <div className='px-4 pt-1 pb-3'>
        <p className='text-[var(--text-secondary)] text-caption leading-[1.6]'>{description}</p>
      </div>

      <div className='flex items-center justify-between rounded-b-xl border-[var(--border)] border-t bg-[color-mix(in_srgb,var(--surface-3)_50%,transparent)] px-4 py-2'>
        <span className='text-[var(--text-muted)] text-xs [font-variant-numeric:tabular-nums]'>
          {step} / {totalSteps}
        </span>
        <div className='flex items-center gap-1.5'>
          <Button
            variant='default'
            size='sm'
            onClick={onBack}
            tabIndex={isFirst ? -1 : undefined}
            className={cn(isFirst && 'invisible')}
          >
            Back
          </Button>
          <Button variant='tertiary' size='sm' onClick={onNext}>
            {isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </>
  )
}

interface TourTooltipProps extends TourCardProps {
  /** Placement relative to the target element */
  placement?: TourTooltipPlacement
  /** Target DOM element to anchor the tooltip to */
  targetEl: HTMLElement | null
  /** Controls tooltip visibility for smooth transitions */
  isVisible?: boolean
  /** Whether this is the initial entrance (plays full entrance animation) */
  isEntrance?: boolean
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
 * A positioned tooltip component for guided product tours.
 *
 * Anchors to a target DOM element using Radix Popover primitives for
 * collision-aware positioning. Supports centered placement for overlay steps.
 * The card surface matches the emcn Modal / DropdownMenu conventions.
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
  const virtualRef = useRef<HTMLElement | null>(null)
  virtualRef.current = targetEl

  if (typeof document === 'undefined') return null
  if (!isVisible) return null

  const isCentered = placement === 'center'

  const cardClasses = cn(
    'w-[260px] overflow-hidden rounded-xl bg-[var(--bg)]',
    isEntrance && 'animate-tour-tooltip-in motion-reduce:animate-none',
    className
  )

  const cardContent = (
    <TourCard
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
      <div className='fixed inset-0 z-[10000300] flex items-center justify-center'>
        <div
          className={cn(
            cardClasses,
            'pointer-events-auto relative shadow-overlay ring-1 ring-foreground/10'
          )}
        >
          {cardContent}
        </div>
      </div>,
      document.body
    )
  }

  if (!targetEl) return null

  return createPortal(
    <PopoverPrimitive.Root open>
      <PopoverPrimitive.Anchor virtualRef={virtualRef as RefObject<HTMLElement>} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={PLACEMENT_TO_SIDE[placement] || 'bottom'}
          sideOffset={10}
          collisionPadding={12}
          avoidCollisions
          className='z-[10000300] outline-none drop-shadow-tour'
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
              className='-mt-px fill-[var(--bg)] stroke-[var(--border)]'
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

export { TourCard, TourTooltip }
export type { TourCardProps, TourTooltipPlacement, TourTooltipProps }
