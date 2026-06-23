import { cn } from '@/lib/core/utils/cn'

export interface IsoMonitorIllustrationProps {
  size?: number
  className?: string
}

/**
 * Static supplied illustration for the Monitor area.
 */
export function IsoMonitorIllustration({ size = 166, className }: IsoMonitorIllustrationProps) {
  return (
    <img
      src='/landing/sim-feature-illo-2.svg?v=7'
      alt='Monitor illustration'
      width={size}
      height={size}
      draggable={false}
      className={cn('block max-w-none', className)}
    />
  )
}
