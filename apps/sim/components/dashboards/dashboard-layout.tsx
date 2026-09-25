'use client'

import { cn, TabStrip } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { DashboardPanel } from '@/components/dashboards/dashboard-panel'
import { dashboardTabParser, dashboardUrlOptions } from '@/components/dashboards/search-params'
import type { DashboardBlock, DashboardSource, DashboardTabs } from '@/lib/dashboards/spec'
import type { DashboardTimeRange } from '@/lib/dashboards/time'

interface DashboardLayoutProps {
  blocks: DashboardBlock[]
  defaults?: DashboardSource
  workspaceId: string
  fileId: string
  range: DashboardTimeRange
  now: number
  path?: string
  startIndex?: number
}
interface DashboardTabsProps extends Omit<DashboardLayoutProps, 'blocks'> {
  block: DashboardTabs
  path: string
}

const ROW_GROW: Record<number, string> = {
  1: 'grow',
  2: 'grow-2',
  3: 'grow-3',
  4: 'grow-4',
  5: 'grow-5',
  6: 'grow-6',
  7: 'grow-7',
  8: 'grow-8',
  9: 'grow-9',
  10: 'grow-10',
  11: 'grow-11',
  12: 'grow-12',
}

function DashboardTabGroup({ block, path, ...props }: DashboardTabsProps) {
  const [selected, setSelected] = useQueryState(
    `dash-${props.fileId}-tab-${path}`,
    dashboardTabParser.withOptions(dashboardUrlOptions)
  )
  const names = Object.keys(block.tabs)
  const active = selected !== null && names.includes(selected) ? selected : names[0]
  return (
    <div className='min-w-0'>
      <TabStrip
        variant='underline'
        size='large'
        dividers={false}
        tabs={names.map((name) => ({ id: name, title: name, active: name === active }))}
        onSelect={(name) => void setSelected(name)}
        className='mb-8 [--tab-strip-inline-start:0px]'
      />
      <DashboardLayout
        {...props}
        path={`${path}.${names.indexOf(active)}`}
        blocks={block.tabs[active]}
      />
    </div>
  )
}

export function DashboardLayout({
  blocks,
  path = 'root',
  startIndex = 0,
  ...props
}: DashboardLayoutProps) {
  return (
    <div className='flex min-w-0 flex-col gap-8'>
      {blocks.map((block, index) => {
        const key = `${path}.${index + startIndex}`
        if ('text' in block)
          return (
            <p
              key={key}
              className='max-w-[72ch] whitespace-pre-wrap break-words text-[var(--text-tertiary)] text-base leading-relaxed'
            >
              {block.text}
            </p>
          )
        if ('tabs' in block)
          return <DashboardTabGroup key={key} {...props} block={block} path={key} />
        if ('row' in block) {
          const metrics = block.row.every((child) => 'stat' in child)
          return (
            <div key={key} className={cn('flex min-w-0 flex-wrap', metrics ? 'gap-6' : 'gap-8')}>
              {block.row.map((child, childIndex) => (
                <div
                  key={childIndex}
                  className={cn(
                    'basis-0',
                    metrics ? 'min-w-[min(100%,200px)]' : 'min-w-[min(100%,320px)]',
                    ROW_GROW[child.flex ?? 1]
                  )}
                >
                  <DashboardLayout {...props} path={`${key}.${childIndex}`} blocks={[child]} />
                </div>
              ))}
            </div>
          )
        }
        return <DashboardPanel key={key} {...props} block={block} />
      })}
    </div>
  )
}
