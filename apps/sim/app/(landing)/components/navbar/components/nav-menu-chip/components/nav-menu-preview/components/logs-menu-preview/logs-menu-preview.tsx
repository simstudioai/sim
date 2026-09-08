import { Chip, cn } from '@sim/emcn'
import { ChevronDown, Search } from '@sim/emcn/icons'
import { LogsRunGraph } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/logs-menu-preview/components/logs-run-graph/logs-run-graph'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

interface LogsMenuPreviewProps {
  layout?: 'menu' | 'hero'
}

/** Successful runs grouped into hourly buckets, following the earlier RunHealth overview. */
const RUN_COUNTS = [
  3, 5, 4, 6, 4, 7, 5, 6, 8, 5, 7, 6, 9, 6, 8, 7, 10, 6, 8, 7, 9, 8, 6, 7,
] as const
const RUN_BUCKETS = RUN_COUNTS.map((count, hour) => ({ hour, count }))
const COMPLETED_RUNS = RUN_COUNTS.reduce<number>((total, count) => total + count, 0)

const SUMMARY_STATS = [
  { label: 'Success rate', value: '100%' },
  { label: 'Median run', value: '21.8s' },
  { label: 'Completed', value: String(COMPLETED_RUNS) },
  { label: 'Cost', value: `$${(COMPLETED_RUNS * 0.11).toFixed(2)}` },
] as const

/** A successful-only sample of the earlier high-level Logs overview and run-volume graph. */
export function LogsMenuPreview({ layout = 'menu' }: LogsMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind='logs' layout={layout} interactive>
      <div
        className={cn(
          'w-[560px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] font-normal text-[var(--text-body)] text-small shadow-xs',
          layout === 'hero' && 'max-sm:w-[calc(100vw-48px)]'
        )}
      >
        <div aria-hidden='true' inert>
          <div className='flex h-11 items-center gap-1 px-2'>
            <Chip leftIcon={Search} tabIndex={-1}>
              Toolbar
            </Chip>
            <Chip tabIndex={-1}>Editor</Chip>
            <Chip active tabIndex={-1}>
              Logs
            </Chip>
          </div>
          <MenuPreviewHeader
            title='Run overview'
            actions={
              <Chip rightIcon={ChevronDown} tabIndex={-1}>
                Last 24 hours
              </Chip>
            }
          />
        </div>
        <div className='px-4 py-3'>
          <div className='grid grid-cols-2 gap-1.5'>
            {SUMMARY_STATS.map((stat) => (
              <div
                key={stat.label}
                className='min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'
              >
                <p className='text-[var(--text-tertiary)] text-caption'>{stat.label}</p>
                <p className='text-[var(--text-primary)] text-base tabular-nums'>{stat.value}</p>
              </div>
            ))}
          </div>
          <LogsRunGraph buckets={RUN_BUCKETS} />
          <div className='mt-1.5 flex justify-between text-[var(--text-secondary)] text-caption'>
            <span>24 hours ago</span>
            <span>Now</span>
          </div>
          <div className='mt-3 flex items-center gap-1.5 text-[var(--text-secondary)] text-caption'>
            <span className='size-[6px] rounded-full bg-[var(--text-primary)]' />
            All runs succeeded
          </div>
        </div>
      </div>
    </MenuPreviewFrame>
  )
}
