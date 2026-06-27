'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Tooltip } from '@/components/emcn/components/tooltip/tooltip'
import { cn } from '@/lib/core/utils/cn'

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
  /** Optional class names applied to the badge. */
  className?: string
  /** Tooltip side. Defaults to `'top'`. */
  side?: InfoSide
  /** Tooltip alignment. Defaults to `'start'`. */
  align?: InfoAlign
}

/**
 * Inline info badge — an outlined rounded square with a slightly
 * slanted `i` glyph that reveals a tooltip on hover. Drawn as an SVG
 * so the stroke matches the rest of the EMCN icon set.
 *
 * @example
 * ```tsx
 * <Info>Events that start a workflow</Info>
 * ```
 */
export function Info({ children, className, side = 'top', align = 'start' }: InfoProps) {
  const t = useTranslations('auto')
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type='button'
          aria-label={t('more_information')}
          className={cn(
            'inline-flex size-[14px] items-center justify-center text-[var(--text-icon)] focus-visible:outline-none',
            className
          )}
        >
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
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content side={side} align={align} className='max-w-xs'>
        <p>{children}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
