import type { CompetitorProfile } from '@/lib/compare/data'
import { ComparisonLinkRow } from '@/app/(landing)/comparisons/components/comparison-link-row'

interface ComparisonLinksProps {
  competitors: CompetitorProfile[]
}

/** "Compare Sim" section linking a library article to the comparison pages it relates to. */
export function ComparisonLinks({ competitors }: ComparisonLinksProps) {
  return (
    <section aria-labelledby='comparison-links-heading'>
      <h2
        id='comparison-links-heading'
        className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em] lg:text-2xl'
      >
        Compare Sim
      </h2>
      <ul className='divide-y divide-[var(--border)] border-[var(--border)] border-y'>
        {competitors.map((competitor) => (
          <li key={competitor.id}>
            <ComparisonLinkRow competitor={competitor} />
          </li>
        ))}
      </ul>
    </section>
  )
}
