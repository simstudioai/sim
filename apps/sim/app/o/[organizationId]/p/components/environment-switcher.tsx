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
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import type { ProjectSection } from '@/app/o/[organizationId]/p/routes'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

interface EnvironmentSwitcherProps {
  project: Project
  section: ProjectSection
  onChange?: (workspaceId: string) => void
}

/**
 * The project's environment (Prod, Staging, Sandbox): each is a forked workspace in the same
 * lineage, and switching keeps the section you are looking at.
 */
export function EnvironmentSwitcher({ project, section, onChange }: EnvironmentSwitcherProps) {
  const router = useRouter()
  const { organization } = useOrganizationContext()
  if (project.environments.length <= 1)
    return (
      <Chip leftIcon={Server} className='text-[var(--text-muted)]'>
        {project.environment}
      </Chip>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip leftIcon={Server} rightIcon={ChevronDown} aria-label='Switch environment'>
          {project.environment}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {project.environments.map((environment) => (
          <DropdownMenuItem
            key={environment.workspaceId}
            onSelect={() =>
              onChange
                ? onChange(environment.workspaceId)
                : router.push(
                    organizationRoutes(organization.id).project(environment.workspaceId, section)
                  )
            }
          >
            <span className='flex-1'>{environment.label}</span>
            {environment.workspaceId === project.id && (
              <Check className='size-[14px] text-[var(--text-icon)]' />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
