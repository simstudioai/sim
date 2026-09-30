'use client'

import { notFound } from 'next/navigation'
import { ProjectChatPanel } from '@/app/o/[organizationId]/p/components/project-chat-panel'
import { ProjectView } from '@/app/o/[organizationId]/p/components/project-view'
import { useProject } from '@/app/o/[organizationId]/p/hooks/use-projects'
import type { ProjectSection } from '@/app/o/[organizationId]/p/routes'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

interface ProjectPageProps {
  workspaceId: string
  section: ProjectSection
}

/** Resolves the organization's workspace behind the route as a project, then renders its section. */
export function ProjectPage({ workspaceId, section }: ProjectPageProps) {
  const { organization } = useOrganizationContext()
  const { project, isPending } = useProject(organization.id, workspaceId)
  if (!project) {
    if (isPending)
      return <p className='p-6 text-[var(--text-muted)] text-caption'>Loading project…</p>
    notFound()
  }
  return (
    <ProjectChatPanel project={project}>
      <ProjectView project={project} section={section} />
    </ProjectChatPanel>
  )
}
