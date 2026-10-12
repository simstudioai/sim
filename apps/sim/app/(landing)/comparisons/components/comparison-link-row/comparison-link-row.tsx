import Link from 'next/link'
import type { CompetitorProfile } from '@/lib/compare/data'
import { BrandIconTile } from '@/app/(landing)/comparisons/components/brand-icon-tile'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'

interface ComparisonLinkRowProps {
  competitor: CompetitorProfile
}

/** One "Sim vs {Competitor}" link row: brand tile, title, one-liner, and chevron. */
export function ComparisonLinkRow({ competitor }: ComparisonLinkRowProps) {
  const Icon = competitor.brand?.icon
  return (
    <Link
      href={`/comparisons/${competitor.id}`}
      className='group/link flex items-center gap-4 px-6 py-4 transition-colors hover-hover:bg-[var(--surface-hover)]'
      aria-label={`Sim vs ${competitor.name} comparison`}
    >
      {Icon ? (
        <BrandIconTile
          icon={Icon}
          selfFramed={competitor.brand?.selfFramed}
          className='size-8 shrink-0'
          iconClassName='size-4'
        />
      ) : null}
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <h3 className='text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em]'>
          Sim vs {competitor.name}
        </h3>
        <p className='hidden text-[var(--text-muted)] text-caption leading-[150%] sm:line-clamp-1'>
          {competitor.oneLiner}
        </p>
      </div>
      <ChevronArrow />
    </Link>
  )
}
