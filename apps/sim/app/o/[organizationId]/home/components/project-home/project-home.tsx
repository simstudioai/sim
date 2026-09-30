'use client'

import { type ReactElement, useState } from 'react'
import {
  Chip,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check, ChevronDown, Folder, X } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { organizationRoutes } from '@/lib/navigation/paths'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'
import { type Project, useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { projectParsers } from '@/app/o/[organizationId]/p/search-params'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

const NO_PROJECT = 'none'

interface ProjectHomeProps {
  userName?: string
}

/**
 * Home with a project picker. Build with a project picked opens that project's chat; every
 * other mode, and Build with no project, is the organization chat Home already runs.
 */
export function ProjectHome({ userName }: ProjectHomeProps) {
  const router = useRouter()
  const { organization } = useOrganizationContext()
  const { roots: projects } = useProjects(organization.id)
  const [{ project }, setParams] = useQueryStates(projectParsers)
  /** The first project is the default so a fresh visit lands in a project, not an org-wide chat. */
  const selected =
    project === NO_PROJECT ? undefined : (projects.find((p) => p.id === project) ?? projects[0])
  const select = (id: string) => void setParams({ project: id })

  return (
    <OrganizationHome
      userName={userName}
      landing={(mode) =>
        mode === 'agent'
          ? {
              heading: selected ? `What should we build in ${selected.name}?` : undefined,
              accessory: (
                <div className='mb-2 flex items-center gap-1'>
                  <ProjectMenu
                    projects={projects}
                    value={selected?.id ?? NO_PROJECT}
                    onSelect={select}
                  >
                    <Chip leftIcon={selected ? Folder : X} rightIcon={ChevronDown}>
                      {selected ? selected.name : 'No project'}
                    </Chip>
                  </ProjectMenu>
                </div>
              ),
            }
          : undefined
      }
      onBeforeSend={(message, mode) => {
        if (mode !== 'agent' || !selected) return false
        router.push(
          `${organizationRoutes(organization.id).project(selected.id)}?chat=new&q=${encodeURIComponent(message)}`
        )
        return true
      }}
    />
  )
}

interface ProjectMenuProps {
  projects: Project[]
  value: string
  onSelect: (id: string) => void
  children: ReactElement
}

function ProjectMenu({ projects, value, onSelect, children }: ProjectMenuProps) {
  const [search, setSearch] = useState('')
  const matches = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-[300px] font-sans'>
        <DropdownMenuSearchInput
          placeholder='Search projects'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {matches.map((project) => (
          <DropdownMenuItem key={project.id} onSelect={() => onSelect(project.id)}>
            <Folder />
            <span className='min-w-0 flex-1 truncate'>{project.name}</span>
            <Check className={cn(project.id !== value && 'invisible')} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onSelect(NO_PROJECT)}>
          <X />
          Don’t work in a project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
