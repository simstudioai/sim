import { cn } from '@sim/emcn'
import type { FactSource } from '@/lib/compare/data'
import { CitedContent } from '@/app/(landing)/comparisons/components/source-info'

interface ComparisonCardItem {
  title: string
  description: string
  shortDescription?: string
}

type SourcedComparisonCardItem = ComparisonCardItem &
  ({ source: FactSource } | { sources: FactSource[] })

export interface ComparisonCardsProps {
  items: SourcedComparisonCardItem[]
  tone?: 'default' | 'inverse'
  headingLevel?: 'h3' | 'h4'
  layout?: 'stack' | 'columns'
}

/**
 * Stacks sourced standout features or limitations. Full descriptions remain
 * server-rendered when a shorter summary is shown.
 */
export function ComparisonCards({
  items,
  tone = 'default',
  headingLevel: Heading = 'h3',
  layout = 'stack',
}: ComparisonCardsProps) {
  return (
    <div
      className={cn(
        layout === 'columns' ? 'grid gap-6 lg:grid-cols-2 lg:gap-x-12' : 'flex flex-col gap-6'
      )}
    >
      {items.map((item) => (
        <div key={item.title} className='min-w-0'>
          <Heading
            className={cn(
              'mb-1 text-base leading-snug tracking-[-0.01em]',
              tone === 'inverse' ? 'text-[var(--white)]' : 'text-[var(--text-primary)]'
            )}
          >
            <CitedContent
              sources={'sources' in item ? item.sources : [item.source]}
              label={item.title}
              tone={tone}
            >
              {item.title}
            </CitedContent>
          </Heading>
          <p
            className={cn(
              'text-small leading-[150%]',
              tone === 'inverse' ? 'text-[var(--white)] opacity-80' : 'text-[var(--text-body)]'
            )}
          >
            {item.shortDescription ?? item.description}
          </p>
          {item.shortDescription ? <span className='sr-only'>{item.description}</span> : null}
        </div>
      ))}
    </div>
  )
}
