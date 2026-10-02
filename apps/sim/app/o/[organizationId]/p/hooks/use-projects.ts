import type { ProjectApi } from '@/lib/api/contracts/projects'
import type { ProjectEnvironment } from '@/lib/projects/types'
import { useProjectsQuery } from '@/hooks/queries/projects'

/** A workspace seen as a project: the project it belongs to, with this workspace as one environment. */
export interface Project {
  /** The workspace this view is on; every route and hook uses it. */
  id: string
  /** The project's own id, used for project settings. */
  projectId: string
  name: string
  organizationId: string | null
  /** The project's first workspace the viewer can access; lists show one project per root. */
  rootId: string
  /** This workspace's environment, labelled by its name. */
  environment: string
  /** Every environment of the project the viewer can access, root first; labels are workspace names. */
  environments: ProjectEnvironment[]
}

/** Each accessible workspace of each project, as the view it opens on. */
export function toProjectViews(projects: readonly ProjectApi[]): Project[] {
  return projects.flatMap((project) => {
    const environments = project.workspaces.map((workspace) => ({
      workspaceId: workspace.id,
      label: workspace.name,
    }))
    const rootId = environments[0]?.workspaceId
    if (!rootId) return []
    return project.workspaces.map((workspace) => ({
      id: workspace.id,
      projectId: project.id,
      name: project.name,
      organizationId: project.organizationId,
      rootId,
      environment: workspace.name,
      environments,
    }))
  })
}

/** The organization's projects, from the projects the viewer can access there. */
export function useProjects(organizationId: string) {
  const query = useProjectsQuery(organizationId)
  const projects = toProjectViews(query.data ?? [])
  /** One entry per project for the sidebar and pickers: each project's root. */
  const roots = projects.filter((project) => project.rootId === project.id)
  const rootById = new Map(roots.map((root) => [root.id, root]))
  /** The project each workspace belongs to, by workspace id. */
  const projectByWorkspace = new Map<string, Project>()
  for (const project of projects) {
    const root = rootById.get(project.rootId)
    if (root) projectByWorkspace.set(project.id, root)
  }
  /** Each project's root view, by project id, for things that record projects rather than workspaces. */
  const projectById = new Map(roots.map((root) => [root.projectId, root]))
  return {
    projects,
    roots,
    projectByWorkspace,
    projectById,
    isPending: query.isPending,
    error: query.error,
  }
}

export function useProject(organizationId: string, workspaceId: string) {
  const { projects, isPending, error } = useProjects(organizationId)
  return { project: projects.find((project) => project.id === workspaceId), isPending, error }
}
