'use client'

import { type ReactNode, useRef, useState } from 'react'
import {
  chipHoverSurfaceClass,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '@sim/emcn'
import { SquareArrowUpRight } from '@sim/emcn/icons'
import type { FactSource } from '@/lib/compare/data'
import { COMPARISON_THEME } from '@/app/(landing)/comparisons/theme'

interface SourcePopoverProps {
  sources: FactSource[]
  label: string
  tone?: 'default' | 'inverse' | 'inverse-desktop'
  children: ReactNode
  description?: string
}

export function SourcePopover({
  sources,
  label,
  tone = 'default',
  children,
  description,
}: SourcePopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstLinkRef = useRef<HTMLAnchorElement>(null)
  const [open, setOpen] = useState(false)

  if (sources.length === 0) return children ?? null

  const countLabel = `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className='flex min-w-0 max-w-full'>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <PopoverTrigger asChild>
              <button
                ref={triggerRef}
                type='button'
                className={cn(
                  'inline-flex min-w-0 max-w-full cursor-pointer items-center text-left focus-visible:outline focus-visible:outline-current focus-visible:outline-offset-2',
                  tone === 'inverse' && 'text-[var(--white)]',
                  tone === 'inverse-desktop' && 'lg:text-white'
                )}
              >
                {children}
                <span className='sr-only'>
                  {' '}
                  — {label}: {countLabel}
                </span>
              </button>
            </PopoverTrigger>
          </Tooltip.Trigger>
          {!open && <Tooltip.Content>{countLabel}</Tooltip.Content>}
        </Tooltip.Root>
      </span>
      <PopoverContent
        aria-label={`Sources for ${label}`}
        align='start'
        sideOffset={8}
        updatePositionStrategy='always'
        maxWidth='min(360px, calc(100vw - 32px))'
        maxHeight={360}
        className={cn(
          'w-[360px] shadow-overlay',
          COMPARISON_THEME,
          !description && sources.length <= 3
            ? 'max-h-none! overflow-visible'
            : 'overscroll-contain'
        )}
        border
        onWheel={(event) => event.stopPropagation()}
        onOpenAutoFocus={() => firstLinkRef.current?.focus()}
        onCloseAutoFocus={() => triggerRef.current?.focus()}
      >
        {description ? (
          <p className='px-2 py-2 text-[var(--text-body)] text-small leading-relaxed'>
            {description}
          </p>
        ) : null}
        <ul className='flex flex-col gap-1'>
          {sources.map((source, index) => (
            <li key={source.url}>
              <a
                ref={index === 0 ? firstLinkRef : undefined}
                href={source.url}
                target='_blank'
                rel='noopener noreferrer'
                className={cn(
                  'flex items-start gap-2 rounded-lg px-2 py-2 text-[var(--text-body)] transition-colors focus-visible:outline focus-visible:outline-[var(--text-muted)] focus-visible:outline-offset-[-2px]',
                  chipHoverSurfaceClass,
                  'dark:hover-hover:bg-[var(--comparison-column-bg)]'
                )}
              >
                <span className='flex min-w-0 grow flex-col gap-1'>
                  <span className='break-words text-small leading-relaxed'>{source.label}</span>
                  <span className='break-words text-[var(--text-muted)] text-caption'>
                    {new URL(source.url).hostname}
                  </span>
                  <span className='text-[var(--text-muted)] text-caption'>
                    Checked{' '}
                    <time dateTime={source.asOf}>
                      {new Date(source.asOf).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </time>
                  </span>
                </span>
                <SquareArrowUpRight
                  className='mt-0.5 size-[14px] shrink-0 text-[var(--text-icon)]'
                  aria-hidden='true'
                />
                <span className='sr-only'>(opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
