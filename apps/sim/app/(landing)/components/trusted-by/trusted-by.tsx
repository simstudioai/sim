import { cn } from '@/lib/core/utils/cn'
import { Logos } from '@/app/(landing)/components/logos'

interface TrustedByProps {
  /** Layout/placement classes for the outer wrapper (e.g. grid cell). Never chrome. */
  className?: string
}

/**
 * The canonical customer-proof block - a muted "Trusted by technical teams at"
 * label above the shared {@link Logos} grid, stacked at the hero's `gap-[22px]`
 * rhythm. The single owner of that label copy and rhythm, reused verbatim by the
 * landing hero and the demo page so the two can never drift. Consumers pass only
 * placement via `className`.
 */
export function TrustedBy({ className }: TrustedByProps) {
  return (
    <div className={cn('flex flex-col gap-[22px]', className)}>
      <p className='text-[var(--text-muted)] text-sm'>Trusted by technical teams at</p>
      <Logos layout='grid' />
    </div>
  )
}
