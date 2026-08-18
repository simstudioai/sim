import { ChipLink } from '@sim/emcn'
import { BookOpen } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'

const LOGS_DOCS_URL = 'https://docs.sim.ai/logs-debugging'

/**
 * Neutral ink at graded strengths.
 *
 * `--surface-4`/`--surface-5` are near-white in light mode (#f5f5f5/#f3f3f3), so
 * skeleton geometry built on them dissolves against the page. Mixing
 * `--text-secondary` into transparent gives a real mid-grey that inverts with the
 * theme — the idiom the workflow editor's vignette uses for the one bar it needs
 * you to actually see.
 */
const INK = {
  title: 'color-mix(in srgb, var(--text-secondary) 32%, transparent)',
  detail: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
} as const

interface ActivityRow {
  /** The only literal text in the graphic — everything else is skeleton. */
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
 * Runs settling into the feed, newest lifted onto its own card.
 *
 * Sized so four rows occupy the same ~148px the other resource graphics do —
 * the frame centres graphic and copy together, so a taller graphic pushes the
 * title down and the set stops reading as one collection.
 *
 * The vertical falloff is the same idea as the tables grid's corner fade — the
 * list is a repeating structure, so cropping it costs nothing and it can dissolve
 * into the page instead of ending on a hard last row.
 */
const FEED_FADE =
  '[-webkit-mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)] [mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)]'

function LogsGraphic() {
  return (
    <div aria-hidden='true' className={`w-[286px] ${FEED_FADE}`}>
      {ROWS.map((row, index) => (
        <div
          key={row.stamp}
          className={
            index === 0
              ? 'flex items-center gap-2.5 rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2 shadow-[0_2px_8px_rgba(0,0,0,0.05)]'
              : 'flex items-center gap-2.5 px-2.5 py-2'
          }
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
          <span className='shrink-0 text-[10px] text-[var(--text-muted)] leading-none'>
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
      action={
        <ChipLink
          href={LOGS_DOCS_URL}
          target='_blank'
          rel='noopener noreferrer'
          variant='border'
          leftIcon={BookOpen}
        >
          Docs
        </ChipLink>
      }
    />
  )
}
