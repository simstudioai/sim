'use client'

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  OverflowText,
} from '@sim/emcn'
import { Check, ChevronDown } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import {
  projectPaneOptions,
  projectPaneParsers,
} from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface ProjectControlProps {
  active: boolean
  onShow: () => void
}

/** Project navigation stays separate from the chat's resource tabs and ownership. */
export function ProjectControl({ active, onShow }: ProjectControlProps) {
  const { organization } = useOrganizationContext()
  const { projects, roots } = useProjects(organization.id)
  const [params, setParams] = useQueryStates(projectPaneParsers, projectPaneOptions)
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  const project = projects.find((candidate) => candidate.id === params.project)
  const name = project?.name ?? organization.name
  const pick = (workspaceId: string) =>
    requestLeave(() => {
      void setParams({
        project: workspaceId,
        section: null,
        resourceKind: '',
        resourceDetail: '',
        pane: 'project',
      })
      onShow()
    })
  return (
    <div className='flex h-[var(--tab-strip-band,30px)] shrink-0 items-center overflow-hidden rounded-lg border border-[var(--border)]'>
      <button
        type='button'
        aria-pressed={active}
        aria-label={`Show ${name}`}
        onClick={onShow}
        className={cn(
          'flex h-full items-center gap-1.5 pr-2 pl-1.5 text-small transition-colors',
          active
            ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
            : 'text-[var(--text-body)] hover-hover:bg-[var(--surface-hover)]'
        )}
      >
        <IdentityTile initial={name[0]} />
        <OverflowText label={name} className='max-w-[136px]' />
      </button>
      <span aria-hidden className={cn('h-4 w-px bg-[var(--border)]', active && 'invisible')} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            aria-label='Switch project'
            className='flex h-full w-6 items-center justify-center text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-hover)]'
          >
            <ChevronDown className='size-[12px]' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-[246px]'>
          <DropdownMenuLabel>Switch project</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => pick('')}>
            <IdentityTile initial={organization.name[0]} />
            {organization.name}
            {!project && <Check />}
          </DropdownMenuItem>
          {roots.map((candidate) => (
            <DropdownMenuItem
              key={candidate.projectId}
              onSelect={() =>
                pick(candidate.projectId === project?.projectId ? project.id : candidate.id)
              }
            >
              <IdentityTile initial={candidate.name[0]} />
              {candidate.name}
              {candidate.projectId === project?.projectId && <Check />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
