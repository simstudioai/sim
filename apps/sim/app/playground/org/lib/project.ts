import { useQueries } from '@tanstack/react-query'
import { WORKSPACES, type Workspace } from '@/app/playground/org/lib/mock-data'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

/** A real workspace shown as a project, plus the mock overlay for the entities that do not exist yet. */
export interface Project {
  /** Real workspace id; every route and hook uses it. */
  id: string
  name: string
  organizationId: string | null
  /** Issues, changelog, tracker and feedback sources have no real source, so they come from a pack. */
  mock: Workspace
  /** True when the pack was chosen by what the workspace holds or is called, not by position. */
  overlayMatched: boolean
  /** True until the workspace's workflow list has loaded, so the pack may still change. */
  overlayPending: boolean
}

/**
 * Picks the overlay pack for a real workspace: first the pack whose `matchWorkflows` names one
 * of the workspace's workflows, then the pack whose `match` hits the workspace name, else
 * round-robin by sidebar position so neighbouring projects get different packs.
 */
export function matchOverlay(
  name: string,
  workflowNames: readonly string[],
  index: number
): Pick<Project, 'mock' | 'overlayMatched'> {
  const byWorkflow = WORKSPACES.find((pack) =>
    pack.matchWorkflows?.some((wanted) => workflowNames.includes(wanted))
  )
  const matched = byWorkflow ?? WORKSPACES.find((pack) => pack.match?.test(name))
  return matched
    ? { mock: matched, overlayMatched: true }
    : { mock: WORKSPACES[index % WORKSPACES.length], overlayMatched: false }
}

export function useProjects() {
  const query = useWorkspacesQuery()
  const workspaces = query.data ?? []
  /** Shares the workflow list cache with every page that renders the same workspace. */
  const workflowLists = useQueries({
    queries: workspaces.map((workspace) => getWorkflowListQueryOptions(workspace.id)),
  })
  /** A handful of rows, so deriving them each render is cheaper than a memo keyed on the lists. */
  const projects: Project[] = workspaces.map((workspace, index) => ({
    id: workspace.id,
    name: workspace.name,
    organizationId: workspace.organizationId ?? null,
    ...matchOverlay(
      workspace.name,
      (workflowLists[index]?.data ?? []).map((workflow) => workflow.name),
      index
    ),
    overlayPending: workflowLists[index]?.isPending ?? true,
  }))
  return { projects, isPending: query.isPending, error: query.error }
}

export function useProject(workspaceId: string) {
  const { projects, isPending, error } = useProjects()
  return { project: projects.find((project) => project.id === workspaceId), isPending, error }
}
