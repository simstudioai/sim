'use client'

import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check, ChevronDown, Server } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { ProjectScope } from '@/app/o/[organizationId]/p/hooks/use-projects'
import type { ProjectSection } from '@/app/o/[organizationId]/p/routes'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

interface EnvironmentSwitcherProps {
  project: ProjectScope
  section: ProjectSection
}

/** The project's environment: each is a workspace of the project, and switching keeps the section. */
export function EnvironmentSwitcher({ project, section }: EnvironmentSwitcherProps) {
  const router = useRouter()
  const { organization } = useOrganizationContext()
  if (project.environments.length <= 1)
    return (
      <Chip leftIcon={Server} className='text-[var(--text-muted)]'>
        {project.environment.name}
      </Chip>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip leftIcon={Server} rightIcon={ChevronDown} aria-label='Switch environment'>
          {project.environment.name}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {project.environments.map((environment) => (
          <DropdownMenuItem
            key={environment.workspaceId}
            onSelect={() =>
              router.push(
                organizationRoutes(organization.id).project(environment.workspaceId, section)
              )
            }
          >
            <span className='flex-1'>{environment.name}</span>
            {environment.workspaceId === project.workspaceId && (
              <Check className='size-[14px] text-[var(--text-icon)]' />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
