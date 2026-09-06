import { cn } from '@sim/emcn'
import { Logos } from '@/app/(landing)/components/logos'

interface TrustedByProps {
  /** Layout/placement classes for the outer wrapper (e.g. grid cell). Never chrome. */
  className?: string
  /**
   * Layout intent, forwarded to {@link Logos}.
   * - `grid` (default) - left-aligned label above the bordered 3-up logo-card grid.
   * - `row` - centered label above a single centered row of bare wordmarks.
   */
  layout?: 'grid' | 'row'
  /**
   * Overrides the default proof label. The homepage leads with a figure
   * ("100,000+ builders...") because a bare "Trusted by" over unlabeled
   * wordmarks reads as weaker proof than a number does; every other consumer
   * keeps the default so the two surfaces stay recognizably the same block.
   */
  label?: string
}

/**
 * The canonical customer-proof block - a muted "Trusted by technical teams at"
 * label above the shared {@link Logos} block, stacked at the hero's `gap-[22px]`
 * rhythm. The single owner of that label copy and rhythm, reused verbatim by the
 * landing hero and the demo page so the two can never drift. Consumers pass only
 * placement via `className` and a `layout` intent.
 */
export function TrustedBy({
  className,
  label = 'Trusted by technical teams at',
  layout = 'grid',
}: TrustedByProps) {
  return (
    <div className={cn('flex flex-col gap-[22px]', layout === 'row' && 'items-center', className)}>
      <p className='text-[var(--text-muted)] text-sm'>{label}</p>
      <Logos layout={layout} />
    </div>
  )
}
