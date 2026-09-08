import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import type { CompetitorProfile } from '@/lib/compare/data'
import { BrandIconTile, SimIconTile } from '@/app/(landing)/comparisons/components/brand-icon-tile'
import { ComparisonCards } from '@/app/(landing)/comparisons/components/comparison-cards'
import type { ComparisonChoicePoint, ComparisonVerdict } from '@/app/(landing)/comparisons/utils'

interface ComparisonChoiceCardsProps {
  competitor: CompetitorProfile
  verdict: ComparisonVerdict
}

interface ChoiceCardProps {
  name: string
  icon: ReactNode
  points: ComparisonChoicePoint[]
  tone?: 'default' | 'inverse'
}

function ChoiceCard({ name, icon, points, tone = 'default' }: ChoiceCardProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-6 rounded-2xl px-8 py-6 max-sm:px-6 lg:px-12 lg:py-8 xl:grid-cols-[220px_minmax(0,1fr)] xl:gap-12',
        tone === 'inverse'
          ? 'bg-[var(--comparison-emphasis-bg)] text-[var(--white)]'
          : 'bg-[var(--comparison-muted-column-bg)] text-[var(--text-primary)]'
      )}
    >
      <div className='flex items-center gap-3 self-center'>
        {icon}
        <h3 className='min-w-0 text-[28px] leading-tight tracking-[-0.02em] lg:text-[32px]'>
          Why {name}?
        </h3>
      </div>
      <ComparisonCards items={points} tone={tone} headingLevel='h4' layout='columns' />
    </div>
  )
}

export function ComparisonChoiceCards({ competitor, verdict }: ComparisonChoiceCardsProps) {
  const CompetitorIcon = competitor.brand?.icon

  return (
    <div className='flex flex-col gap-4'>
      <ChoiceCard
        name='Sim'
        icon={<SimIconTile className='size-9' />}
        points={verdict.simPoints}
        tone='inverse'
      />
      <ChoiceCard
        name={competitor.name}
        icon={
          CompetitorIcon ? (
            <BrandIconTile
              icon={CompetitorIcon}
              selfFramed={competitor.brand?.selfFramed}
              className='size-9'
              iconClassName='size-5'
            />
          ) : null
        }
        points={verdict.competitorPoints}
      />
    </div>
  )
}
