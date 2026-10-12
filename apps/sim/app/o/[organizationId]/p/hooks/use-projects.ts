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
  /** Roots first, each fork after its parent, siblings by name. */
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
  const visible = new Set(record.environments.map((environment) => environment.id))
  const children = new Map<string | null, ProjectEnvironment[]>()
  for (const environment of record.environments) {
    const parent = environment.forkedFromWorkspaceId
    const parentId = parent && visible.has(parent) ? parent : null
    const siblings = children.get(parentId) ?? []
    siblings.push({ workspaceId: environment.id, name: environment.name, parentId })
    children.set(parentId, siblings)
  }
  const environments: ProjectEnvironment[] = []
  const visit = (parentId: string | null) => {
    for (const environment of [...(children.get(parentId) ?? [])].sort(byName)) {
      environments.push(environment)
      visit(environment.workspaceId)
    }
  }
  visit(null)
  if (environments.length !== record.environments.length)
    throw new Error(`Project ${record.id} has a fork cycle among its environments`)
  return {
    id: record.id,
    name: record.name,
    organizationId: record.organizationId,
    environments,
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
