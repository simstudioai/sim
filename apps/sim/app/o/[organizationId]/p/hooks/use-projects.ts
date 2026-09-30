import { type ProjectEnvironment, resolveProjectLineages } from '@/lib/projects'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

/** A workspace seen as a project: its fork lineage, with this workspace as one environment. */
export interface Project {
  /** The workspace this view is on; every route and hook uses it. */
  id: string
  name: string
  organizationId: string | null
  /** The workspace at the top of the lineage; lists show one project per root. */
  rootId: string
  /** Which environment this workspace is within its project: Prod, Staging, Sandbox. */
  environment: string
  /** Every environment of the project, root first. */
  environments: ProjectEnvironment[]
}

/** The organization's projects: every workspace it hosts, grouped by fork lineage. */
export function useProjects(organizationId: string) {
  const query = useWorkspacesQuery()
  const workspaces = (query.data ?? []).filter(
    (workspace) => workspace.organizationId === organizationId
  )
  /** A handful of rows, so deriving them each render is cheaper than a memo keyed on the list. */
  const lineages = resolveProjectLineages(workspaces)
  const projects: Project[] = workspaces.map((workspace) => {
    const lineage = lineages.get(workspace.id)
    if (!lineage) throw new Error(`No lineage for workspace ${workspace.id}`)
    return {
      id: workspace.id,
      name: lineage.name,
      organizationId: workspace.organizationId ?? null,
      rootId: lineage.rootId,
      environment: lineage.environment,
      environments: lineage.environments,
    }
  })
  /** One entry per project for the sidebar and pickers: each lineage's root. */
  const roots = projects.filter((project) => project.rootId === project.id)
  return { projects, roots, isPending: query.isPending, error: query.error }
}

export function useProject(organizationId: string, workspaceId: string) {
  const { projects, isPending, error } = useProjects(organizationId)
  return { project: projects.find((project) => project.id === workspaceId), isPending, error }
}
