import { OverflowText, Skeleton } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import {
  projectPaneOptions,
  projectPaneParsers,
} from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { ProjectView } from '@/app/o/[organizationId]/p/components/project-view'
import { useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { ResourceWorkspaceHost } from '@/app/workspace/[workspaceId]/home/components/resource-workspace-host'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/** The pinned tab shows the organization until a project environment is selected. */
export function ProjectPaneContent() {
  const { organization } = useOrganizationContext()
  const { roots, projects, isPending, error } = useProjects(organization.id)
  const [params, setParams] = useQueryStates(projectPaneParsers, projectPaneOptions)
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  const navigate = (next: Parameters<typeof setParams>[0]) =>
    requestLeave(() => {
      void setParams(next)
    })
  const project = projects.find((candidate) => candidate.id === params.project)
  if (isPending) return <Skeleton className='m-6 h-32' />
  if (error)
    return (
      <p role='alert' className='p-6 text-[var(--text-error)] text-small'>
        {error.message}
      </p>
    )
  if (!project)
    return (
      <div className='min-h-0 flex-1 overflow-y-auto px-8 py-8'>
        <div className='mx-auto flex w-full max-w-[560px] flex-col gap-6'>
          <h1 className='text-[var(--text-primary)] text-xl'>{organization.name}</h1>
          <section className='flex flex-col gap-1'>
            <h2 className='mb-2 text-[var(--text-muted)] text-caption'>Projects</h2>
            {roots.map((candidate) => (
              <button
                key={candidate.projectId}
                type='button'
                onClick={() => navigate({ project: candidate.id, section: null, pane: 'project' })}
                className='flex items-center gap-2 rounded-lg px-2 py-2 text-left text-small hover-hover:bg-[var(--surface-active)]'
              >
                <IdentityTile initial={candidate.name[0]} />
                <OverflowText label={candidate.name} className='flex-1 text-[var(--text-body)]' />
              </button>
            ))}
            {!roots.length && (
              <p className='text-[var(--text-muted)] text-small'>No projects yet.</p>
            )}
          </section>
        </div>
      </div>
    )
  return (
    <ResourceWorkspaceHost
      key={project.id}
      workspaceId={project.id}
      organizationId={organization.id}
    >
      <ProjectView
        project={project}
        section={params.section}
        onBrowse={() =>
          navigate({ section: 'resources', resourceKind: '', resourceDetail: '', pane: 'project' })
        }
        onSectionChange={(section) =>
          navigate({ section, resourceKind: '', resourceDetail: '', pane: 'project' })
        }
        onEnvironmentChange={(workspaceId) =>
          navigate({ project: workspaceId, resourceDetail: '', pane: 'project' })
        }
      />
    </ResourceWorkspaceHost>
  )
}
