'use client'

import { Checkbox } from '@sim/emcn/checkbox'
import { LoadMoreFooter } from '@sim/emcn/scroll-area/load-more-footer'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  FieldStack,
  Muted,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useProjects } from '@/platform/embedded/lib/data/access-control'

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
        {projects.error && (
          <FailureNotice
            message={projects.error.message}
            retrying={projects.isFetching}
            onRetry={() => void projects.refetch()}
          />
        )}
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
        <LoadMoreFooter
          state={{
            hasMore: projects.hasNextPage,
            loading: projects.isFetchingNextPage,
            onLoadMore: () => void projects.fetchNextPage(),
          }}
        />
      </FieldStack>
    </SettingsSection>
  )
}
