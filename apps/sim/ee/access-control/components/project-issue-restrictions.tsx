'use client'

import { Checkbox, Chip } from '@sim/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import { useProjects } from '@/hooks/queries/projects'

interface ProjectIssueRestrictionsProps {
  organizationId: string
  value: string[]
  onChange: (value: string[]) => void
}

/** Project choices use the authorized inventory; policy remains enforced at the application boundary. */
export function ProjectIssueRestrictions({
  organizationId,
  value,
  onChange,
}: ProjectIssueRestrictionsProps) {
  const projects = useProjects(organizationId)
  if (projects.isPending || (isApiClientError(projects.error) && projects.error.status === 503)) {
    return null
  }
  const selected = new Set(value)
  return (
    <div className='flex flex-col gap-2'>
      <p className='text-small'>Restrict Issues for partial-access teammates</p>
      <p className='text-[var(--text-muted)] text-small'>
        For selected Projects, teammates governed by this group need access to every active
        environment to use Issues.
      </p>
      {projects.error && (
        <p className='text-[var(--text-error)] text-small'>{projects.error.message}</p>
      )}
      {projects.data?.pages
        .flatMap((page) => page.projects)
        .map((project) => (
          <label
            htmlFor={`project-issues-${project.id}`}
            key={project.id}
            className='flex items-center gap-2'
          >
            <Checkbox
              id={`project-issues-${project.id}`}
              checked={selected.has(project.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? [...new Set([...value, project.id])]
                    : value.filter((id) => id !== project.id)
                )
              }
            />
            <span className='text-small'>{project.name}</span>
          </label>
        ))}
      {projects.hasNextPage && (
        <Chip disabled={projects.isFetchingNextPage} onClick={() => void projects.fetchNextPage()}>
          Load more
        </Chip>
      )}
    </div>
  )
}
