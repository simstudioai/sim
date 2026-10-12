import { useMemo } from 'react'
import type { ProjectRecord } from '@/lib/api/contracts/projects'
import { useOrganizationProjects, useWorkspaceProject } from '@/hooks/queries/projects'

/** One workspace of a project, labelled by its workspace name. */
export interface ProjectEnvironment {
  workspaceId: string
  label: string
  /** The environment this one was forked from; null for a root of the project. */
  parentId: string | null
}

/** A workspace seen as a project: the project it belongs to, with this workspace as one environment. */
export interface Project {
  /** The workspace this view is on; every route and hook uses it. */
  id: string
  /** The project's own id, used for project settings. */
  projectId: string
  name: string
  organizationId: string | null
  /** The project's first environment; lists show one project per root. */
  rootId: string
  /** This workspace's environment, labelled by its name. */
  environment: string
  /** Every environment of the project the viewer can access, in the API's fork order. */
  environments: ProjectEnvironment[]
  /** Organization admin or admin of every environment: may rename and archive the project. */
  canAdminister: boolean
}

function toEnvironments(project: ProjectRecord): ProjectEnvironment[] {
  return project.environments.map((environment) => ({
    workspaceId: environment.id,
    label: environment.name,
    parentId: environment.forkedFromWorkspaceId,
  }))
}

/** Each accessible workspace of each project, as the view it opens on. */
function toProjectViews(projects: readonly ProjectRecord[]): Project[] {
  return projects.flatMap((project) => {
    const environments = toEnvironments(project)
    const rootId = environments[0]?.workspaceId
    if (!rootId) return []
    return environments.map((environment) => ({
      id: environment.workspaceId,
      projectId: project.id,
      name: project.name,
      organizationId: project.organizationId,
      rootId,
      environment: environment.label,
      environments,
      canAdminister: project.capabilities.administer,
    }))
  })
}

/** The organization's projects, from the projects the viewer can access there. */
export function useProjects(organizationId: string) {
  const query = useOrganizationProjects(organizationId)
  const projects = useMemo(() => toProjectViews(query.data ?? []), [query.data])
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

/** The project a workspace belongs to, seen from that workspace, without loading the organization's list. */
export function useWorkspaceProjectView(workspaceId: string) {
  const query = useWorkspaceProject(workspaceId)
  const project = useMemo(
    () =>
      query.data ? toProjectViews([query.data]).find((view) => view.id === workspaceId) : undefined,
    [query.data, workspaceId]
  )
  return { project, isPending: query.isPending, error: query.error }
}
