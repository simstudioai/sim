import { useMemo } from 'react'
import type { ProjectRecord } from '@/lib/api/contracts/projects'
import { useOrganizationProjects, useWorkspaceProject } from '@/hooks/queries/projects'

/** One environment of a project: a workspace, named by the workspace itself. */
export interface ProjectEnvironment {
  workspaceId: string
  name: string
  /** The environment this one was forked from; null for a root of the project. */
  parentId: string | null
}

export interface Project {
  id: string
  name: string
  organizationId: string | null
  /** In the API's order: roots first, each fork after its parent, siblings by name. */
  environments: ProjectEnvironment[]
  canAdminister: boolean
}

/** A project seen from one of its environments: the workspace a project page is on. */
export interface ProjectScope extends Project {
  workspaceId: string
  environment: ProjectEnvironment
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name)
}

function toProject(record: ProjectRecord): Project {
  return {
    id: record.id,
    name: record.name,
    organizationId: record.organizationId,
    environments: record.environments.map((environment) => ({
      workspaceId: environment.id,
      name: environment.name,
      parentId: environment.forkedFromWorkspaceId,
    })),
    canAdminister: record.capabilities.administer,
  }
}

/** The environment a project opens in: its first root. */
export function defaultEnvironment(project: Project): ProjectEnvironment {
  const [first] = project.environments
  if (!first) throw new Error(`Project ${project.id} has no environment the viewer can open`)
  return first
}

function scopeProject(project: Project, workspaceId: string): ProjectScope {
  const environment = project.environments.find(
    (candidate) => candidate.workspaceId === workspaceId
  )
  if (!environment) throw new Error(`Workspace ${workspaceId} is not in project ${project.id}`)
  return { ...project, workspaceId, environment }
}

/** The organization's projects, as the sidebar and pickers list them. */
export function useProjects(organizationId: string) {
  const query = useOrganizationProjects(organizationId)
  const projects = useMemo(() => [...(query.data ?? [])].sort(byName).map(toProject), [query.data])
  return { projects, isPending: query.isPending, error: query.error }
}

/** The project a workspace belongs to, scoped to that workspace as its environment. */
export function useProjectScope(workspaceId: string) {
  const query = useWorkspaceProject(workspaceId)
  const project = useMemo(
    () => (query.data ? scopeProject(toProject(query.data), workspaceId) : undefined),
    [query.data, workspaceId]
  )
  return { project, isPending: query.isPending, error: query.error }
}
