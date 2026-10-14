'use client'

import { Chip, toast } from '@sim/emcn'
import { DashboardResource } from '@/components/dashboards/dashboard-resource'
import { EmptyState } from '@/components/empty-state/empty-state'
import { sendMothershipMessage } from '@/lib/mothership/events'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

interface ProjectDashboardProps {
  project: Project
}

export function ProjectDashboard({ project }: ProjectDashboardProps) {
  const { canBuild, mothershipAvailable } = useOrganizationContext()
  const createDashboard = () => {
    const message = [
      `Help me create the first dashboard for project ${JSON.stringify(project.name)} (project ID: ${project.projectId}).`,
      `I'm viewing environment ${JSON.stringify(project.environment)} (workspace ID: ${project.id}), which has no dashboard.`,
      `Project environments: ${JSON.stringify(project.environments)}.`,
      'First ask me what I want to see in the dashboard: goals, metrics, data sources, and layout. Do not create dashboards until we agree on what to include.',
      'Then check the dashboard in every accessible environment of this project and create one for each environment that does not already have one, using that environment’s own tables and data. Preserve existing dashboards. Tell me if an environment needs data or permissions before it can be set up.',
    ].join('\n\n')
    if (!sendMothershipMessage(message, undefined, undefined, undefined, 'agent')) {
      toast.error('Could not open dashboard setup in chat. Please try again.')
    }
  }
  return (
    <DashboardResource
      key={project.id}
      workspaceId={project.id}
      emptyState={
        <EmptyState
          title='Create your first dashboard'
          description='Tell Sim what you want to track across your project’s environments.'
          action={
            canBuild && mothershipAvailable ? (
              <Chip onClick={createDashboard}>Create dashboard</Chip>
            ) : undefined
          }
        />
      }
    />
  )
}
