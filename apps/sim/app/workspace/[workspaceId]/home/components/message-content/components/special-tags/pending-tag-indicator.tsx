import { formatDuration } from '@sim/utils/formatting'
import { ThinkingLoader } from '@/components/ui'
import { useElapsedMs } from '@/app/workspace/[workspaceId]/home/hooks/use-elapsed-ms'

/** Past this, a silent wait (e.g. the model reasoning before it speaks) shows its elapsed time. */
export const ELAPSED_VISIBLE_AFTER_MS = 5_000

interface PendingTagIndicatorProps {
  /** Activity phrase next to the loader; crossfades on change. */
  label: string
  /** When the current wait began (epoch ms); undefined while nothing is being waited on. */
  waitingSince?: number
}

interface ElapsedCountProps {
  since?: number
}

/**
 * The wait's elapsed time, ticking in its own component so the loader beside it
 * never re-renders on the clock. Hidden from assistive tech: the loader's status
 * already announces the wait, and a count changing every second would be noise.
 */
function ElapsedCount({ since }: ElapsedCountProps) {
  const elapsedMs = useElapsedMs({ active: since !== undefined, startedAt: since })
  if (elapsedMs < ELAPSED_VISIBLE_AFTER_MS) return null
  return (
    <span
      aria-hidden='true'
      data-wait-elapsed
      className='animate-stream-fade-in text-[var(--text-muted)] text-sm tabular-nums'
    >
      {formatDuration(elapsedMs)}
    </span>
  )
}

/**
 * Renders the turn-level activity shimmer, with the elapsed time once the wait runs long.
 */
export function PendingTagIndicator({ label, waitingSince }: PendingTagIndicatorProps) {
  return (
    <div className='flex animate-stream-fade-in items-center gap-2 py-2'>
      <ThinkingLoader size={20} startVariant='corners' label={label} labelRatio={0.7} />
      <ElapsedCount since={waitingSince} />
    </div>
  )
}
