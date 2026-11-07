'use client'

import { type ReactNode, useId, useState } from 'react'
import { cn } from '../../lib/cn'
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover'
import { FloatingTooltip, Tooltip, useFloatingTooltip } from '../tooltip/tooltip'

/**
 * Tooltip placement side.
 */
type InfoSide = 'top' | 'right' | 'bottom' | 'left'

/**
 * Tooltip alignment along the chosen side.
 */
type InfoAlign = 'start' | 'center' | 'end'

interface InfoProps {
  /** Tooltip content rendered on hover. */
  children: ReactNode
  /** Accessible name describing the subject of the help. */
  label?: string
  /** Adds a larger target and click/tap-pinned help; compact badges remain the default. */
  interactive?: boolean
  /** Optional class names applied to the badge. */
  className?: string
  /** Preferred side for pinned help. Hover help follows the cursor. Defaults to `'top'`. */
  side?: InfoSide
  /** Alignment for pinned help. Hover help follows the cursor. Defaults to `'start'`. */
  align?: InfoAlign
}

/**
 * Inline info badge with hover/focus help. Set interactive for a larger trigger
 * that pins the same content on click or tap.
 *
 * @example
 * ```tsx
 * <Info>Events that start a workflow</Info>
 * ```
 */
export function Info({
  children,
  className,
  side = 'top',
  align = 'start',
  label = 'More information',
  interactive = false,
}: InfoProps) {
  if (interactive) {
    return (
      <InteractiveInfo label={label} className={className} side={side} align={align}>
        {children}
      </InteractiveInfo>
    )
  }
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type='button'
          aria-label={label}
          className={cn(
            'inline-flex size-[14px] items-center justify-center text-[var(--text-icon)] focus-visible:outline-hidden',
            className
          )}
        >
          {INFO_ICON}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content side={side} align={align} className='max-w-xs'>
        <p>{children}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

function InteractiveInfo({ children, className, side, align, label }: InfoProps) {
  const contentId = useId()
  const [open, setOpen] = useState(false)
  const { state, handlers, dismiss } = useFloatingTooltip(() => !open, {
    preferAbove: side === 'top',
    revalidateKey: open,
    dismissOnEscape: true,
  })
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) dismiss()
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label={label}
          aria-describedby={!open && state.visible ? contentId : undefined}
          className={cn(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-icon)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--border)] focus-visible:ring-inset max-md:pointer-coarse:size-11',
            className
          )}
          {...handlers}
          onClick={(event) => event.stopPropagation()}
        >
          <span className='size-[14px]'>{INFO_ICON}</span>
        </button>
      </PopoverTrigger>
      {!open && (
        <FloatingTooltip state={state} role='tooltip' id={contentId} className='max-w-xs'>
          {children}
        </FloatingTooltip>
      )}
      <PopoverContent
        appearance='tooltip'
        maxWidth={320}
        side={side}
        align={align}
        aria-label={label}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

const INFO_ICON = (
  <svg
    width='100%'
    height='100%'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.55'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <rect x='3' y='3' width='18' height='18' rx='4' />
    <line x1='12.7' y1='10.5' x2='11.3' y2='16.5' />
    <line x1='13.2' y1='7.5' x2='13.21' y2='7.5' />
  </svg>
)
