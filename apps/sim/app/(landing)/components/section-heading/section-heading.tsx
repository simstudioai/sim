import type { ComponentType, ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import Link from 'next/link'
import { LANDING_TYPE } from '@/app/(landing)/components/landing-layout'

/** Render size for a section's iso mark, and the box that optically centers it. */
const MARK_SIZE = 92
const MARK_BOX = 'flex size-[76px] items-center justify-center'

interface SectionHeadingProps {
  /** Stable id the owning `<section>` points its `aria-labelledby` at. */
  headingId: string
  /** The section's `<h2>` copy. */
  title: ReactNode
  /** Supporting paragraph, rendered in the right column beside the heading. */
  description: ReactNode
  /**
   * Optional abstract iso mark rendered above the heading. The marks are the
   * landing page's brand glyphs; spending one per section reads as a through
   * line, where four stacked in a single row read as a feature list.
   */
  mark?: ComponentType<{ size?: number; className?: string }>
  /** Optional trailing link destination, rendered under the description. */
  href?: string
  /** Label for {@link href}. */
  linkLabel?: string
  /** Layout/placement classes for the outer wrapper. Never chrome. */
  className?: string
}

/**
 * The shared heading block for the homepage's content sections - an optional
 * iso mark and `<h2>` in the left column, with the supporting description and
 * an optional arrow link in a fixed right column, bottom-aligned to the
 * heading's last line.
 *
 * This is deliberately the same split the hero uses. Repeating one composition
 * down the page - display type left, supporting copy and the action right - is
 * what makes the layout read as a designed system rather than a stack of
 * unrelated marketing blocks, and it keeps every section's heading measure
 * identical no matter how long its description runs.
 *
 * The right column is `w-[400px]`, matching the hero exactly. Below `xl` the
 * split collapses to a stacked left-aligned column.
 *
 * Server Component. Consumers pass content and placement only.
 */
export function SectionHeading({
  headingId,
  title,
  description,
  mark: Mark,
  href,
  linkLabel,
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'flex w-full items-end justify-between gap-12',
        'max-xl:flex-col max-xl:items-start max-xl:gap-6',
        className
      )}
    >
      <div className='flex min-w-0 flex-1 flex-col items-start gap-5'>
        {Mark && (
          <div aria-hidden='true' className={MARK_BOX}>
            <Mark size={MARK_SIZE} />
          </div>
        )}

        <h2
          id={headingId}
          className={cn('max-w-[18ch] text-balance text-[var(--text-primary)]', LANDING_TYPE.h2)}
        >
          {title}
        </h2>
      </div>

      <div className='flex w-[400px] flex-none flex-col items-start gap-4 pb-2 max-xl:w-full max-xl:pb-0'>
        <p
          className={cn(
            'w-full min-w-0 max-w-[38ch] text-pretty text-[var(--text-body)]',
            LANDING_TYPE.lead
          )}
        >
          {description}
        </p>

        {href && linkLabel && (
          <Link
            href={href}
            className='flex items-center gap-1.5 text-[16px] text-[var(--text-body)] transition-colors hover-hover:text-[var(--text-primary)]'
          >
            {linkLabel}
            <ArrowRight className='size-[14px]' />
          </Link>
        )}
      </div>
    </div>
  )
}
