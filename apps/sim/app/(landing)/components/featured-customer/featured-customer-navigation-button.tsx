'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { ArrowLeft, ArrowRight } from '@sim/emcn/icons'

const HOVER_NAVIGATION_DELAY_MS = 1000

interface FeaturedCustomerNavigationButtonProps {
  direction: 'next' | 'previous'
  label: string
  /** No story lies in this direction: the arrow stays as a landmark but takes no input. */
  disabled?: boolean
  onSelect: () => void
}

/**
 * One arrow of the carousel's control pair, drawn for the page ground in the
 * landing's ink tokens: a live arrow is full ink inside a mid-grey ring, a
 * disabled one a lighter grey inside a hairline-grey ring, so both read on the
 * white and the live one reads first. Advances on click or after a sustained
 * mouse hover; positioned by the pair that holds it, not by itself.
 */
export function FeaturedCustomerNavigationButton({
  direction,
  label,
  disabled = false,
  onSelect,
}: FeaturedCustomerNavigationButtonProps) {
  const hoverTimerRef = useRef<number | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  const [showTooltipContent, setShowTooltipContent] = useState(true)
  const Icon = direction === 'next' ? ArrowRight : ArrowLeft

  const stopHoverProgress = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setIsHovering(false)
  }

  const selectStory = () => {
    stopHoverProgress()
    setShowTooltipContent(false)
    onSelect()
  }

  const startHoverProgress = () => {
    if (disabled) return
    stopHoverProgress()
    setShowTooltipContent(true)
    setIsHovering(true)
    hoverTimerRef.current = window.setTimeout(selectStory, HOVER_NAVIGATION_DELAY_MS)
  }

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  return (
    <Tooltip.Root key={label}>
      <Tooltip.Trigger asChild>
        <Button
          variant='ghost'
          onClick={selectStory}
          onMouseEnter={startHoverProgress}
          onMouseLeave={stopHoverProgress}
          onFocus={() => setShowTooltipContent(true)}
          aria-label={label}
          disabled={disabled}
          type='button'
          className={cn(
            'group relative size-10 rounded-full border-0 bg-transparent p-0 shadow-none transition-[background-color,color,transform] duration-150 max-sm:size-9',
            disabled
              ? 'cursor-default text-[var(--text-subtle)]'
              : 'text-[var(--text-primary)] hover-hover:bg-[var(--surface-hover)] active:scale-[0.96]'
          )}
        >
          <svg
            aria-hidden='true'
            viewBox='0 0 40 40'
            className='-rotate-90 pointer-events-none absolute inset-0 size-full overflow-visible'
          >
            <circle
              data-customer-progress-track='true'
              cx='20'
              cy='20'
              r='19'
              strokeWidth='2'
              className={cn(
                'fill-none transition-colors duration-150',
                disabled
                  ? 'stroke-[var(--border)]'
                  : 'stroke-[var(--text-subtle)] group-hover-hover:stroke-[var(--text-secondary)]'
              )}
            />
            <circle
              data-customer-progress-ring='true'
              cx='20'
              cy='20'
              r='19'
              pathLength='100'
              strokeWidth='2'
              strokeLinecap='round'
              className={cn(
                'fill-none stroke-[var(--text-primary)] transition-[stroke-dashoffset] ease-linear [stroke-dasharray:100] motion-reduce:transition-none',
                isHovering
                  ? 'opacity-100 duration-1000 [stroke-dashoffset:0]'
                  : 'opacity-0 duration-0 [stroke-dashoffset:100]'
              )}
            />
          </svg>
          <Icon className='relative z-10 size-[16px]' />
        </Button>
      </Tooltip.Trigger>
      {showTooltipContent && !disabled && <Tooltip.Content side='top'>{label}</Tooltip.Content>}
    </Tooltip.Root>
  )
}
