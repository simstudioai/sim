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
import type { Project } from '@/app/playground/org/lib/project'
import { protoRoutes, type WorkspaceSection } from '@/app/playground/org/lib/routes'

interface EnvironmentSwitcherProps {
  project: Project
  section: WorkspaceSection
  /** Whether the current page is the full view, so the switch lands on the same view. */
  full: boolean
}

/**
 * The project's environment (Prod, Staging, Sandbox): each is a forked workspace in the same
 * lineage, and switching keeps the section you are looking at.
 */
export function EnvironmentSwitcher({ project, section, full }: EnvironmentSwitcherProps) {
  const router = useRouter()
  const target = (workspaceId: string) =>
    full ? protoRoutes.full(workspaceId, section) : protoRoutes.workspace(workspaceId, section)
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
            onSelect={() => router.push(target(environment.workspaceId))}
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
