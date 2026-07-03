import type { FactSource } from '@/lib/compare/data'
import { SourceLink } from '@/app/(landing)/comparison/components/source-info'

interface ComparisonCardItem {
  title: string
  description: string
  shortDescription?: string
  source: FactSource
}

export interface ComparisonCardsProps {
  items: ComparisonCardItem[]
}

/**
 * A vertically stacked list of atomic, independently quotable fact cards,
 * each self-contained title + a one-line `shortDescription` (falling back to
 * `description` if a short version hasn't been authored yet). Used for both
 * a competitor's standout features and its documented limitations.
 *
 * The full `description` is always present as `sr-only` text. Server
 * rendered regardless of hover/JS state. So an LLM or crawler reading the
 * page still gets the complete claim even though a human sees only the
 * one-line summary. Hovering the title itself (`SourceLink`) shows a short
 * "Source: X" tooltip and clicking it opens the source, rather than a
 * separate info-icon affordance next to every card.
 */
export function ComparisonCards({ items }: ComparisonCardsProps) {
  return (
    <div className='flex flex-col'>
      {items.map((item, index) => (
        <div
          key={item.title}
          className={index > 0 ? 'border-[var(--border)] border-t px-6 py-4' : 'px-6 py-4'}
        >
          <h3 className='mb-1 text-[var(--text-primary)] text-base leading-snug tracking-[-0.01em]'>
            <SourceLink source={item.source}>{item.title}</SourceLink>
          </h3>
          <p className='text-[var(--text-body)] text-small leading-[150%]'>
            {item.shortDescription ?? item.description}
          </p>
          {item.shortDescription ? <span className='sr-only'>{item.description}</span> : null}
        </div>
      ))}
    </div>
  )
}
