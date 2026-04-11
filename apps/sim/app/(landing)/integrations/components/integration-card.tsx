import type { ComponentType, SVGProps } from 'react'
import Link from 'next/link'
import type { Integration } from '@/app/(landing)/integrations/data/types'
import { IntegrationIcon } from './integration-icon'

interface IntegrationCardProps {
  integration: Integration
  IconComponent?: ComponentType<SVGProps<SVGSVGElement>>
}

/**
 * Featured integration card — matches blog featured post pattern.
 * Used in flex rows separated by border-l dividers.
 */
export function IntegrationCard({ integration, IconComponent }: IntegrationCardProps) {
  const { slug, name, description, bgColor } = integration

  return (
    <Link
      href={`/integrations/${slug}`}
      className='group/link flex flex-1 flex-col gap-4 border-[var(--landing-bg-elevated)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--landing-bg-elevated)] sm:border-t-0 sm:border-l sm:first:border-l-0'
    >
      <IntegrationIcon
        bgColor={bgColor}
        name={name}
        Icon={IconComponent}
        className='h-10 w-10 rounded-[5px]'
        aria-hidden='true'
      />
      <div className='flex flex-col gap-2'>
        <h3 className='text-lg text-white leading-tight tracking-[-0.01em]'>{name}</h3>
        <p className='line-clamp-2 text-[var(--landing-text-muted)] text-sm leading-[150%]'>
          {description}
        </p>
      </div>
    </Link>
  )
}

interface IntegrationRowProps {
  integration: Integration
  IconComponent?: ComponentType<SVGProps<SVGSVGElement>>
}

/**
 * Integration list row — matches blog remaining post pattern.
 * Each row followed by an h-px divider.
 */
export function IntegrationRow({ integration, IconComponent }: IntegrationRowProps) {
  const { slug, name, description, bgColor } = integration

  return (
    <>
      <Link
        href={`/integrations/${slug}`}
        className='group/link flex items-center gap-4 px-6 py-4 transition-colors hover:bg-[var(--landing-bg-elevated)]'
        aria-label={`${name} integration`}
      >
        <IntegrationIcon
          bgColor={bgColor}
          name={name}
          Icon={IconComponent}
          className='h-8 w-8 shrink-0 rounded-[5px]'
          iconClassName='h-4 w-4'
          fallbackClassName='text-[13px]'
          aria-hidden='true'
        />

        {/* Name + description */}
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <h3 className='text-[14px] text-white leading-snug tracking-[-0.02em]'>{name}</h3>
          <p className='line-clamp-1 hidden text-[12px] text-[var(--landing-text-muted)] leading-[150%] sm:block'>
            {description}
          </p>
        </div>

        {/* Animated arrow */}
        <ChevronArrow />
      </Link>
      <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
    </>
  )
}

/**
 * Animated chevron arrow matching the footer/landing pattern.
 * Line scales in from left, chevron translates right on hover.
 */
function ChevronArrow() {
  return (
    <svg
      className='h-3 w-3 shrink-0 text-[var(--landing-text-subtle)]'
      viewBox='0 0 10 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
    >
      <line
        x1='0'
        y1='5'
        x2='9'
        y2='5'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        className='origin-left scale-x-0 transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100'
      />
      <path
        d='M3.5 2L6.5 5L3.5 8'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        strokeLinejoin='miter'
        fill='none'
        className='transition-transform duration-200 ease-out group-hover/link:translate-x-[30%]'
      />
    </svg>
  )
}
