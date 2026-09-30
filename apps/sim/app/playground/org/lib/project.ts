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
  /** A pack shown as a project of its own because no real workspace claimed it; everything is mock. */
  isMock: boolean
}

/** What a real workspace shows when no pack claims it: real resources, nothing mock on top. */
const NO_PACK: Workspace = {
  id: 'none',
  name: '',
  description: '',
  tracker: { kind: 'sim', label: 'Sim tracker' },
  feedbackSources: [],
  dashboards: [],
  needsYou: 0,
}

/** The ids the mock projects live at; a route with one of these never touches a real workspace. */
export const MOCK_PROJECT_IDS: ReadonlySet<string> = new Set(WORKSPACES.map((pack) => pack.id))

function mockProject(pack: Workspace): Project {
  return {
    id: pack.id,
    name: pack.name,
    organizationId: null,
    mock: pack,
    overlayMatched: true,
    overlayPending: false,
    isMock: true,
  }
}

/**
 * Picks the overlay pack for a real workspace: first the pack whose `matchWorkflows` names one
 * of the workspace's workflows, then the pack whose `match` hits the workspace name. A workspace
 * nothing claims shows only its real resources.
 */
export function matchOverlay(
  name: string,
  workflowNames: readonly string[]
): Pick<Project, 'mock' | 'overlayMatched'> {
  const byWorkflow = WORKSPACES.find((pack) =>
    pack.matchWorkflows?.some((wanted) => workflowNames.includes(wanted))
  )
  const matched = byWorkflow ?? WORKSPACES.find((pack) => pack.match?.test(name))
  return matched
    ? { mock: matched, overlayMatched: true }
    : { mock: NO_PACK, overlayMatched: false }
}

export function useProjects() {
  const query = useWorkspacesQuery()
  const workspaces = query.data ?? []
  /** Shares the workflow list cache with every page that renders the same workspace. */
  const workflowLists = useQueries({
    queries: workspaces.map((workspace) => getWorkflowListQueryOptions(workspace.id)),
  })
  /** A handful of rows, so deriving them each render is cheaper than a memo keyed on the lists. */
  const real: Project[] = workspaces.map((workspace, index) => ({
    id: workspace.id,
    name: workspace.name,
    organizationId: workspace.organizationId ?? null,
    ...matchOverlay(
      workspace.name,
      (workflowLists[index]?.data ?? []).map((workflow) => workflow.name)
    ),
    overlayPending: workflowLists[index]?.isPending ?? true,
    isMock: false,
  }))
  /** Packs no real workspace claimed stay in the sidebar as mock projects, below the real ones. */
  const claimed = new Set(real.map((project) => project.mock.id))
  const settled = !query.isPending && real.every((project) => !project.overlayPending)
  const mocks = settled ? WORKSPACES.filter((pack) => !claimed.has(pack.id)).map(mockProject) : []
  const projects = [...real, ...mocks]
  return { projects, isPending: query.isPending, error: query.error }
}

export function useProject(workspaceId: string) {
  const { projects, isPending, error } = useProjects()
  const found = projects.find((project) => project.id === workspaceId)
  /** A mock id resolves at once so its pages never wait on the real lists. */
  const pack =
    !found && MOCK_PROJECT_IDS.has(workspaceId)
      ? WORKSPACES.find((candidate) => candidate.id === workspaceId)
      : undefined
  return { project: found ?? (pack ? mockProject(pack) : undefined), isPending, error }
}

/** The workspace id a hook may query for this project; empty for a mock project so nothing fires. */
export function realWorkspaceId(project: Project): string {
  return project.isMock ? '' : project.id
}
