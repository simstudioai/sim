'use client'

import { notFound } from 'next/navigation'
import { ProjectChatPanel } from '@/app/o/[organizationId]/p/components/project-chat-panel'
import { ProjectView } from '@/app/o/[organizationId]/p/components/project-view'
import { useProjectScope } from '@/app/o/[organizationId]/p/hooks/use-projects'
import type { ProjectSection } from '@/app/o/[organizationId]/p/routes'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

interface ProjectPageProps {
  workspaceId: string
  section: ProjectSection
}

/** Resolves the project the route's workspace is an environment of, then renders its section. */
export function ProjectPage({ workspaceId, section }: ProjectPageProps) {
  const { organization } = useOrganizationContext()
  const { project, isPending, error } = useProjectScope(workspaceId)
  if (error)
    return (
      <p role='alert' className='p-6 text-[var(--text-error)] text-small'>
        {error.message}
      </p>
    )
  if (isPending || !project)
    return <p className='p-6 text-[var(--text-muted)] text-caption'>Loading project…</p>
  if (project.organizationId !== organization.id) notFound()
  return (
    <ProjectChatPanel project={project}>
      <ProjectView project={project} section={section} />
    </ProjectChatPanel>
  )
}
