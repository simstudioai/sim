import { useMemo } from 'react'
import { WORKSPACES, type Workspace } from '@/app/playground/org/lib/mock-data'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

/** A real workspace shown as a project, plus the mock overlay for the entities that do not exist yet. */
export interface Project {
  /** Real workspace id; every route and hook uses it. */
  id: string
  name: string
  organizationId: string | null
  /** Issues, changelog, tracker and feedback sources have no real source, so they come from a pack. */
  mock: Workspace
  /** True when the pack was chosen by name, so its description reads as this project's. */
  overlayMatched: boolean
}

/**
 * Picks the overlay pack for a real workspace: the first pack whose `match` hits the workspace
 * name, else round-robin by sidebar position so neighbouring projects get different packs.
 */
export function matchOverlay(
  name: string,
  index: number
): Pick<Project, 'mock' | 'overlayMatched'> {
  const matched = WORKSPACES.find((pack) => pack.match?.test(name))
  return matched
    ? { mock: matched, overlayMatched: true }
    : { mock: WORKSPACES[index % WORKSPACES.length], overlayMatched: false }
}

export function useProjects() {
  const query = useWorkspacesQuery()
  const projects = useMemo<Project[]>(
    () =>
      (query.data ?? []).map((workspace, index) => ({
        id: workspace.id,
        name: workspace.name,
        organizationId: workspace.organizationId ?? null,
        ...matchOverlay(workspace.name, index),
      })),
    [query.data]
  )
  return { projects, isPending: query.isPending, error: query.error }
}

export function useProject(workspaceId: string) {
  const { projects, isPending, error } = useProjects()
  return { project: projects.find((project) => project.id === workspaceId), isPending, error }
}
