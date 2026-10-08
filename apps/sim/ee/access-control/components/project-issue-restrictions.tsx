'use client'

import { Checkbox, Chip, Info, OverflowText } from '@sim/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useProjects } from '@/hooks/queries/projects'

interface ProjectIssueRestrictionsProps {
  organizationId: string
  value: string[]
  onChange: (value: string[]) => void
}

/**
 * Project choices use the authorized inventory; policy remains enforced at the
 * application boundary.
 */
export function ProjectIssueRestrictions({
  organizationId,
  value,
  onChange,
}: ProjectIssueRestrictionsProps) {
  const projects = useProjects(organizationId)
  if (projects.isPending || (isApiClientError(projects.error) && projects.error.status === 503)) {
    return null
  }
  const choices = projects.data?.pages.flatMap((page) => page.projects) ?? []
  if (!projects.error && choices.length === 0) return null
  const selected = new Set(value)
  return (
    <SettingsSection
      label='Project Issues'
      headerAccessory={
        <Info side='top'>
          For selected Projects, teammates governed by this group need access to every active
          environment to use Issues.
        </Info>
      }
      action={
        projects.hasNextPage ? (
          <Chip
            disabled={projects.isFetchingNextPage}
            onClick={() => void projects.fetchNextPage()}
          >
            {projects.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Chip>
        ) : undefined
      }
    >
      {projects.error && (
        <p className='pl-2 text-[var(--text-error)] text-caption'>{projects.error.message}</p>
      )}
      <div className='flex flex-col gap-0.5'>
        {choices.map((project) => (
          <div
            key={project.id}
            className='flex items-center gap-1.5 rounded-md pr-2 transition-colors hover-hover:bg-[var(--surface-active)]'
          >
            <label
              htmlFor={`project-issues-${project.id}`}
              className='flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-[5px] pl-2'
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
              <OverflowText label={project.name} className='text-sm' />
            </label>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}
