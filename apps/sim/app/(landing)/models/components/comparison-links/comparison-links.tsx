import { ChipLink } from '@sim/emcn'
import type { ModelComparison } from '@/app/(landing)/models/comparisons'

interface ComparisonLinksProps {
  comparisons: ModelComparison[]
}

export function ComparisonLinks({ comparisons }: ComparisonLinksProps) {
  return (
    <div className='flex flex-wrap gap-2'>
      {comparisons.map((comparison) => (
        <ChipLink key={comparison.slug} href={comparison.href} variant='outline'>
          {comparison.title}
        </ChipLink>
      ))}
    </div>
  )
}
