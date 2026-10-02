'use client'

import { useState } from 'react'
import {
  Checkbox,
  Chip,
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItemLabel,
  DropdownMenuSearchInput,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'
import type { ProjectApi } from '@/lib/api/contracts/projects'

/** Project rules include future environments; workspace IDs are explicit selections only. */
export interface ProjectEnvironmentSelection {
  projectIds: string[]
  workspaceIds: string[]
}

interface ProjectEnvironmentSelectProps {
  projects: ProjectApi[]
  value: ProjectEnvironmentSelection
  onChange: (value: ProjectEnvironmentSelection) => void
  disabled?: boolean
  isLoading?: boolean
  error?: string
  fullWidth?: boolean
  className?: string
  includeFuture?: boolean
  allOrganization?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  id?: string
}

/** Project selection with an accessible environment submenu shared by organization settings. */
export function ProjectEnvironmentSelect({
  projects,
  value,
  onChange,
  disabled,
  isLoading,
  error,
  fullWidth,
  className,
  includeFuture = true,
  allOrganization = false,
  ...aria
}: ProjectEnvironmentSelectProps) {
  const [search, setSearch] = useState('')
  const selectedProjects = projects.filter(
    (project) =>
      value.projectIds.includes(project.id) ||
      project.workspaces.some((environment) => value.workspaceIds.includes(environment.id))
  )
  const label = error
    ? 'Could not load projects'
    : isLoading
      ? 'Loading projects…'
      : allOrganization
        ? 'All projects'
        : selectedProjects.length === 1
          ? selectedProjects[0].name
          : selectedProjects.length
            ? `${selectedProjects.length} projects`
            : 'Select projects…'
  const query = search.trim().toLowerCase()
  const visible = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(query) ||
      project.workspaces.some((environment) => environment.name.toLowerCase().includes(query))
  )
  const selectProject = (project: ProjectApi, checked: boolean) => {
    const environmentIds = new Set(project.workspaces.map((environment) => environment.id))
    onChange({
      projectIds: [
        ...value.projectIds.filter((id) => id !== project.id),
        ...(checked && includeFuture ? [project.id] : []),
      ],
      workspaceIds: [
        ...value.workspaceIds.filter((id) => !environmentIds.has(id)),
        ...(checked && !includeFuture ? [...environmentIds] : []),
      ],
    })
  }
  const selectEnvironment = (project: ProjectApi, environmentId: string, checked: boolean) => {
    const selected = new Set(value.workspaceIds)
    if (value.projectIds.includes(project.id))
      for (const environment of project.workspaces) selected.add(environment.id)
    if (checked) selected.add(environmentId)
    else selected.delete(environmentId)
    onChange({
      projectIds: value.projectIds.filter((id) => id !== project.id),
      workspaceIds: [...selected],
    })
  }
  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
      <DropdownMenuTrigger asChild>
        <Chip
          {...aria}
          disabled={disabled || isLoading}
          rightIcon={ChevronDown}
          className={cn(fullWidth && 'w-full justify-between', className)}
        >
          {label}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={fullWidth ? 'start' : 'end'}
        className={cn('min-w-[240px]', fullWidth && 'w-[var(--radix-dropdown-menu-trigger-width)]')}
      >
        <DropdownMenuSearchInput
          placeholder='Search projects…'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {visible.map((project) => {
          const all =
            value.projectIds.includes(project.id) ||
            (!includeFuture &&
              project.workspaces.every((environment) =>
                value.workspaceIds.includes(environment.id)
              ))
          const count = value.projectIds.includes(project.id)
            ? project.workspaces.length
            : project.workspaces.filter((environment) =>
                value.workspaceIds.includes(environment.id)
              ).length
          return (
            <DropdownMenuSub key={project.id}>
              <DropdownMenuSubTrigger
                onClick={() => selectProject(project, !all)}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault()
                    selectProject(project, !all)
                  }
                }}
              >
                <Checkbox
                  aria-label={`Select all environments in ${project.name}`}
                  checked={all ? true : count ? 'indeterminate' : false}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={() => selectProject(project, !all)}
                />
                <DropdownMenuItemLabel label={project.name}>{project.name}</DropdownMenuItemLabel>
                <span className='text-[var(--text-muted)] text-caption'>
                  {count}/{project.workspaces.length}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuCheckboxItem
                  checked={all}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => selectProject(project, checked)}
                >
                  {includeFuture ? 'All current and future environments' : 'All environments'}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {project.workspaces.map((environment) => (
                  <DropdownMenuCheckboxItem
                    key={environment.id}
                    checked={
                      value.projectIds.includes(project.id) ||
                      value.workspaceIds.includes(environment.id)
                    }
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                      selectEnvironment(project, environment.id, checked)
                    }
                  >
                    {environment.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        })}
        {error && (
          <p role='alert' className='p-2 text-[var(--text-error)] text-small'>
            {error}
          </p>
        )}
        {!error && !visible.length && (
          <p className='p-2 text-[var(--text-muted)] text-small'>No projects found</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
