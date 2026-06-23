import { cn } from '@/lib/core/utils/cn'

export interface IsoIntegrateIllustrationProps {
  size?: number
  className?: string
}

/**
 * Static supplied illustration for the Integrate area.
 */
export function IsoIntegrateIllustration({ size = 148, className }: IsoIntegrateIllustrationProps) {
  return (
    <img
      src='/landing/sim-feature-illo-1.svg?v=6'
      alt='Integrations illustration'
      width={size}
      height={size}
      draggable={false}
      className={cn('block max-w-none', className)}
    />
  )
}
