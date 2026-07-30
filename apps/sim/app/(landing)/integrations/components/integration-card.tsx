import type { ComponentType, SVGProps } from 'react'
import { memo } from 'react'
import Link from 'next/link'
import type { IntegrationSummary } from '@/lib/integrations'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import { IntegrationIcon } from '@/app/(landing)/integrations/components/integration-icon'

const HOVER_BG = 'transition-colors hover:bg-[var(--surface-hover)]' as const

interface IntegrationItemProps {
  integration: IntegrationSummary
  IconComponent?: ComponentType<SVGProps<SVGSVGElement>>
}

/**
 * Featured integration card - matches blog featured post pattern.
 * Used in flex rows separated by border-l dividers.
 */
export function IntegrationCard({ integration, IconComponent }: IntegrationItemProps) {
  const { slug, name, description, bgColor } = integration

  return (
    <Link
      href={`/integrations/${slug}`}
      className={`group/link flex flex-1 flex-col gap-4 border-[var(--border)] border-t p-6 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0 ${HOVER_BG}`}
    >
      <IntegrationIcon
        bgColor={bgColor}
        name={name}
        Icon={IconComponent}
        className='size-10 rounded-xl border border-[var(--border-1)]'
        aria-hidden='true'
      />
      <div className='flex flex-col gap-2'>
        <h3 className='text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em]'>
          {name}
        </h3>
        <p className='line-clamp-2 text-[var(--text-muted)] text-sm leading-[150%]'>
          {description}
        </p>
      </div>
    </Link>
  )
}

/**
 * Integration list row - matches blog remaining post pattern.
 * Each row followed by an h-px divider.
 */
export const IntegrationRow = memo(function IntegrationRow({
  integration,
  IconComponent,
}: IntegrationItemProps) {
  const { slug, name, description, bgColor } = integration

  return (
    <>
      <Link
        href={`/integrations/${slug}`}
        className={`group/link flex items-center gap-4 px-6 py-4 ${HOVER_BG}`}
        aria-label={`${name} integration`}
      >
        <IntegrationIcon
          bgColor={bgColor}
          name={name}
          Icon={IconComponent}
          className='size-8 shrink-0 rounded-xl border border-[var(--border-1)]'
          iconClassName='size-4'
          fallbackClassName='text-[13px]'
          aria-hidden='true'
        />

        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <h3 className='text-[14px] text-[var(--text-primary)] leading-snug tracking-[-0.02em]'>
            {name}
          </h3>
          <p className='line-clamp-1 hidden text-[12px] text-[var(--text-muted)] leading-[150%] sm:block'>
            {description}
          </p>
        </div>

        <ChevronArrow />
      </Link>
      <div className='h-px w-full bg-[var(--border)]' />
    </>
  )
})
