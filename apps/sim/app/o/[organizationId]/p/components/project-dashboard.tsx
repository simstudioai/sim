'use client'

import type { ReactNode } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@sim/emcn'
import { Check, ChevronDown } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { DashboardFile } from '@/app/o/[organizationId]/p/components/dashboard-file'
import { RunsDashboard } from '@/app/o/[organizationId]/p/components/runs-dashboard'
import { useProjectResources } from '@/app/o/[organizationId]/p/hooks/use-project-resources'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { projectParsers } from '@/app/o/[organizationId]/p/search-params'

const RUNS_ID = 'runs'

interface DashboardOption {
  id: string
  title: string
  kind: 'file' | 'runs'
}

/** The project's dashboards: its `.dashboard` files rendered live, then a built-in Runs dashboard. */
export function ProjectDashboard({ project }: { project: Project }) {
  const [{ dashboard: selected }, setParams] = useQueryStates(projectParsers)
  const { dashboardFiles, filesPending } = useProjectResources(project.id)

  if (filesPending)
    return <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>Loading…</p>

  const options: DashboardOption[] = [
    ...dashboardFiles.map((file) => ({ id: file.id, title: file.name, kind: 'file' as const })),
    { id: RUNS_ID, title: 'Runs', kind: 'runs' },
  ]
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
  const { dashboardFiles } = useProjectResources(project.id)
  if (option.kind === 'runs') return <RunsDashboard key={RUNS_ID} project={project} title={title} />
  const file = dashboardFiles.find((candidate) => candidate.id === option.id)
  if (!file) return null
  return <DashboardFile key={file.id} workspaceId={project.id} file={file} title={title} />
}
