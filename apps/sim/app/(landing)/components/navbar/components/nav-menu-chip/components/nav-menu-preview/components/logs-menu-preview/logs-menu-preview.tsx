import { Chip, cn } from '@sim/emcn'
import { ChevronDown, Search } from '@sim/emcn/icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'
import { LogsRunGraph } from '@/app/(landing)/components/shared/logs-run-graph'
import { SUMMARY_STATS } from '@/app/(landing)/components/shared/logs-run-graph/constants'

interface LogsMenuPreviewProps {
  layout?: 'menu' | 'hero'
}

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
          <LogsRunGraph />
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
