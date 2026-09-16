import { ThinkingLoader } from '@/components/ui'

interface PendingTagIndicatorProps {
  /** Activity phrase next to the loader; crossfades on change. */
  label: string
}

/**
 * Renders the turn-level activity shimmer.
 */
export function PendingTagIndicator({ label }: PendingTagIndicatorProps) {
  return (
    <div className='animate-stream-fade-in py-2'>
      <ThinkingLoader size={20} startVariant='corners' label={label} labelRatio={0.7} />
    </div>
  )
}
