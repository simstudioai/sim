'use client'

import type { ReactNode } from 'react'
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
import { DashboardFile } from '@/app/playground/org/components/dashboard-file'
import { RunsDashboard } from '@/app/playground/org/components/runs-dashboard'
import { mockTableAnalytics } from '@/app/playground/org/fixtures'
import { MOCK_DASHBOARDS } from '@/app/playground/org/lib/dashboards'
import { type Project, realWorkspaceId } from '@/app/playground/org/lib/project'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import { useProjectResources } from '@/app/playground/org/lib/use-project-resources'
import { TableAnalyticsSourceContext } from '@/hooks/queries/table-analytics'

const RUNS_ID = 'runs'

interface DashboardOption {
  id: string
  title: string
  kind: 'file' | 'runs' | 'sample'
}

/**
 * The project's dashboards: its real dashboard files rendered live, a built-in Runs dashboard
 * from the workspace's execution stats, and the pack's sample dashboards only when the
 * workspace has no dashboard file of its own.
 */
export function ProtoDashboard({ project }: { project: Project }) {
  const [{ dashboard: selected }, setParams] = useQueryStates(protoParsers)
  const { dashboardFiles, filesPending } = useProjectResources(realWorkspaceId(project))

  if (filesPending)
    return <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>Loading…</p>

  const samples = (suffix: string): DashboardOption[] =>
    project.mock.dashboards.map((id) => ({
      id,
      title: `${MOCK_DASHBOARDS[id]?.title ?? id}${suffix}`,
      kind: 'sample' as const,
    }))
  /** A mock project has only its pack's dashboards; a real one leads with its own files and runs. */
  const options: DashboardOption[] = project.isMock
    ? samples('')
    : [
        ...dashboardFiles.map((file) => ({ id: file.id, title: file.name, kind: 'file' as const })),
        { id: RUNS_ID, title: 'Runs', kind: 'runs' },
        ...(dashboardFiles.length ? [] : samples(' (sample)')),
      ]
  if (!options.length)
    return (
      <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>
        No dashboards yet. Ask Sim to build one from this project’s tables.
      </p>
    )
  const current = options.find((option) => option.id === selected) ?? options[0]

  const title = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          className='flex items-center gap-2 self-start rounded-lg text-left @min-[1000px]/dashboard:text-[32px] text-[28px] text-[var(--text-primary)] leading-tight tracking-[-0.02em]'
        >
          {current.title}
          <ChevronDown className='size-[16px] text-[var(--text-icon)]' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => void setParams({ dashboard: option.id }, { history: 'replace' })}
          >
            <span className='flex-1'>{option.title}</span>
            {option.id === current.id && <Check className='size-[14px] text-[var(--text-icon)]' />}
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

  return <DashboardBody project={project} option={current} title={title} />
}

interface DashboardBodyProps {
  project: Project
  option: DashboardOption
  title: ReactNode
}

function DashboardBody({ project, option, title }: DashboardBodyProps) {
  const { dashboardFiles } = useProjectResources(realWorkspaceId(project))
  if (option.kind === 'runs') return <RunsDashboard key={RUNS_ID} project={project} title={title} />
  if (option.kind === 'file') {
    const file = dashboardFiles.find((candidate) => candidate.id === option.id)
    if (!file) return null
    return <DashboardFile key={file.id} workspaceId={project.id} file={file} title={title} />
  }
  const sample = MOCK_DASHBOARDS[option.id]
  if (!sample) return null
  return (
    <TableAnalyticsSourceContext value={mockTableAnalytics}>
      <DashboardPreview
        key={option.id}
        content={sample.content}
        workspaceId={`proto-${project.id}`}
        fileId={`proto-${option.id}`}
        title={title}
      />
    </TableAnalyticsSourceContext>
  )
}
