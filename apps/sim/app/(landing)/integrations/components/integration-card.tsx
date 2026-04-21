import type { ComponentType, SVGProps } from 'react'
import Link from 'next/link'
import type { Integration } from '@/app/(landing)/integrations/data/types'
import { ChevronArrow } from '@/app/(landing)/models/components/model-primitives'
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
