'use client'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@sim/emcn'
import { Check, ChevronDown } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { DashboardPreview } from '@/components/dashboards/dashboard-preview'
import { RunsDashboard } from '@/app/o/[organizationId]/p/components/runs-dashboard'
import type { ProjectScope } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { projectParsers } from '@/app/o/[organizationId]/p/search-params'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useWorkspaceDashboard } from '@/hooks/queries/dashboards'

const RUNS_ID = 'runs'

interface DashboardOption {
  id: string
  title: string
}

interface ProjectDashboardProps {
  project: ProjectScope
}

/** The environment's dashboard, once Sim has saved one, then a built-in Runs dashboard. */
export function ProjectDashboard({ project }: ProjectDashboardProps) {
  const [{ dashboard: selected }, setParams] = useQueryStates(projectParsers)
  const dashboardsEnabled = useFeatureFlag('dashboards')
  const query = useWorkspaceDashboard(project.workspaceId, { enabled: dashboardsEnabled })

  if (dashboardsEnabled && query.isPending)
    return <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>Loading…</p>
  if (query.error)
    return (
      <p role='alert' className='px-6 py-16 text-center text-[var(--text-error)] text-small'>
        {query.error.message}
      </p>
    )

  const saved = query.data?.dashboard && query.data.content !== null ? query.data : null
  const options: DashboardOption[] = [
    ...(saved?.dashboard ? [{ id: saved.dashboard.id, title: saved.dashboard.name }] : []),
    { id: RUNS_ID, title: 'Runs' },
  ]
  const current = options.find((option) => option.id === selected) ?? options[0]

  const title = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          className='flex items-center gap-2 self-start rounded-lg text-left @min-[1000px]/dashboard:text-3xl text-2xl text-[var(--text-primary)] leading-tight tracking-[-0.02em]'
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
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (current.id === RUNS_ID || !saved?.dashboard || saved.content === null)
    return <RunsDashboard key={RUNS_ID} project={project} title={title} />
  return (
    <DashboardPreview
      key={saved.dashboard.id}
      content={saved.content}
      workspaceId={project.workspaceId}
      dashboardId={saved.dashboard.id}
      title={title}
    />
  )
}
