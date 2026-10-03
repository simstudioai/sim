import { cn } from '@sim/emcn'
import { EmptyState } from '@/components/empty-state/empty-state'
import { EmptyStateDocsLink } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/docs-link'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

const LOGS_DOCS_URL = 'https://docs.sim.ai/logs-debugging'

/** Skeleton ink — see the `INK` note in `tables-empty-state.tsx` for why not the surface ramp. */
const INK = {
  title: 'color-mix(in srgb, var(--text-secondary) 32%, transparent)',
  detail: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
} as const

interface ActivityRow {
  stamp: string
  title: number
  detail: number
}

const ROWS: ActivityRow[] = [
  { stamp: 'Now', title: 72, detail: 112 },
  { stamp: '12 min ago', title: 62, detail: 124 },
  { stamp: '1h ago', title: 76, detail: 100 },
  { stamp: 'Jul 8', title: 56, detail: 108 },
]

/**
 * Vertical falloff so the feed dissolves into the page instead of ending on a hard
 * last row — the list is a repeating structure, so cropping it costs nothing.
 */
const FEED_FADE =
  '[-webkit-mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)] [mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)]'

/** Four rows, sized to the ~148px the other resource graphics occupy so the frame centres the set alike. */
function LogsGraphic() {
  return (
    <div aria-hidden='true' className={cn('w-[286px]', FEED_FADE, MASK_NO_REPEAT)}>
      {ROWS.map((row, index) => (
        <div
          key={row.stamp}
          className={cn(
            'flex items-center gap-2.5 px-2.5 py-2',
            index === 0 &&
              'rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] shadow-card'
          )}
        >
          <span className='size-[22px] shrink-0 rounded-full bg-[var(--surface-6)]' />
          <span className='flex min-w-0 flex-1 flex-col gap-[6px]'>
            <span
              className='block h-[6px] rounded-full'
              style={{ width: row.title, background: INK.title }}
            />
            <span
              className='block h-[4px] rounded-full'
              style={{ width: row.detail, background: INK.detail }}
            />
          </span>
          <span className='shrink-0 text-[var(--text-muted)] text-micro leading-none'>
            {row.stamp}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Empty state for the logs list when the workspace has no runs yet. */
export function LogsEmptyState() {
  return (
    <EmptyState
      graphic={<LogsGraphic />}
      title='Logs'
      description='Every workflow execution lands here, traced block by block.'
      action={<EmptyStateDocsLink href={LOGS_DOCS_URL} />}
    />
  )
}
