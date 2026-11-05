'use client'

import {
  FieldStack,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { Button, Checkbox } from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import { isApiClientError, useProjectList } from '@/platform/lib/data/access-control'

interface ProjectIssueRestrictionsProps {
  organizationId: string
  projectsEnabled: boolean
  value: string[]
  onChange: (value: string[]) => void
}

/** Project choices use the authorized inventory; policy remains enforced at the application boundary. */
export function ProjectIssueRestrictions({
  organizationId,
  projectsEnabled,
  value,
  onChange,
}: ProjectIssueRestrictionsProps) {
  const projects = useProjectList(organizationId, projectsEnabled)
  if (
    !projects.isEnabled ||
    projects.isPending ||
    (isApiClientError(projects.error) && projects.error.status === 503)
  ) {
    return null
  }
  const choices = projects.data?.pages.flatMap((page) => page.projects) ?? []
  if (!projects.error && choices.length === 0) return null
  const selected = new Set(value)
  return (
    <SettingsSection title='Project Issues'>
      <FieldStack>
        <Muted>
          For selected Projects, teammates governed by this group need access to every active
          environment to use Issues.
        </Muted>
        {projects.error && <Muted>{projects.error.message}</Muted>}
        {choices.map((project) => (
          <Checkbox
            key={project.id}
            label={project.name}
            checked={selected.has(project.id)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...new Set([...value, project.id])]
                  : value.filter((id) => id !== project.id)
              )
            }
          />
        ))}
        {projects.hasNextPage && (
          <Button
            size='compact'
            disabled={projects.isFetchingNextPage}
            onClick={() => void projects.fetchNextPage()}
          >
            {projects.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </FieldStack>
    </SettingsSection>
  )
}
