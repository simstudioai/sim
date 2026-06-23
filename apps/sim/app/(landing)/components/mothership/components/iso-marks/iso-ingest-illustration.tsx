import { cn } from '@/lib/core/utils/cn'

export interface IsoIngestIllustrationProps {
  size?: number
  className?: string
}

/**
 * Static supplied illustration for the Ingest context area.
 */
export function IsoIngestIllustration({ size = 156, className }: IsoIngestIllustrationProps) {
  return (
    <img
      src='/landing/sim-feature-illo-ingest.svg?v=4'
      alt='Ingest context illustration'
      width={size}
      height={size}
      draggable={false}
      className={cn('block max-w-none', className)}
    />
  )
}
