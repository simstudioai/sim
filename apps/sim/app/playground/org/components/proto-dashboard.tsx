'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check, ChevronDown, Plus } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { DashboardPreview } from '@/components/dashboards/dashboard-preview'
import { MOCK_DASHBOARDS } from '@/app/playground/org/lib/dashboards'
import { mockTableAnalytics } from '@/app/playground/org/lib/mock-analytics'
import type { Workspace } from '@/app/playground/org/lib/mock-data'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import { TableAnalyticsSourceContext } from '@/hooks/queries/table-analytics'

/** The real dashboard renderer over seeded mock rows, with a switcher on the title. */
export function ProtoDashboard({ workspace }: { workspace: Workspace }) {
  const [{ dashboard: selected }, setParams] = useQueryStates(protoParsers)
  if (!workspace.dashboards.length)
    return (
      <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>
        No dashboards yet. Ask Sim to build one from this workspace’s tables.
      </p>
    )
  const id =
    selected && workspace.dashboards.includes(selected) ? selected : workspace.dashboards[0]
  const dashboard = MOCK_DASHBOARDS[id]
  if (!dashboard) throw new Error(`Unknown mock dashboard ${id}`)

  const title = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          className='flex items-center gap-2 self-start rounded-lg text-left @min-[1000px]/dashboard:text-[32px] text-[28px] text-[var(--text-primary)] leading-tight tracking-[-0.02em]'
        >
          {dashboard.title}
          <ChevronDown className='size-[16px] text-[var(--text-icon)]' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {workspace.dashboards.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => void setParams({ dashboard: option as typeof selected })}
          >
            <span className='flex-1'>{MOCK_DASHBOARDS[option]?.title}</span>
            {option === id && <Check className='size-[14px] text-[var(--text-icon)]' />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Plus className='size-[14px] text-[var(--text-icon)]' />
          New dashboard
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <TableAnalyticsSourceContext value={mockTableAnalytics}>
      <DashboardPreview
        key={id}
        content={dashboard.content}
        workspaceId={`proto-${workspace.id}`}
        fileId={`proto-${id}`}
        title={title}
      />
    </TableAnalyticsSourceContext>
  )
}
