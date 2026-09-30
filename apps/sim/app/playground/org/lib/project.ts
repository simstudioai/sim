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
  /** The workspace at the top of this fork lineage; the sidebar lists one project per root. */
  rootId: string
  /** Which environment this workspace is within its project: Prod, Staging, Sandbox. */
  environment: string
  /** Every environment of the project, root first. */
  environments: ProjectEnvironment[]
}

export interface ProjectEnvironment {
  workspaceId: string
  label: string
}

/** A trailing environment word on a workspace name names its environment; the rest names the project. */
const ENVIRONMENT_SUFFIX =
  /^(.*?)[\s-]+(prod|production|staging|stage|sandbox|dev|development|test|uat|qa)$/i
/** What a fork is called when its name carries no environment word, by depth below the root. */
const DEPTH_LABELS = ['Prod', 'Staging', 'Sandbox'] as const

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

function parseEnvironmentName(name: string): { base: string; environment: string | null } {
  const match = ENVIRONMENT_SUFFIX.exec(name.trim())
  return match
    ? { base: match[1].trim(), environment: capitalize(match[2]) }
    : { base: name.trim(), environment: null }
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
    rootId: pack.id,
    environment: DEPTH_LABELS[0],
    environments: [{ workspaceId: pack.id, label: DEPTH_LABELS[0] }],
  }
}

interface Lineage {
  rootId: string
  depth: number
}

/**
 * Groups forked workspaces under the workspace they were forked from, following
 * `forkedFromWorkspaceId` while the parent is in the list the viewer can see.
 */
function resolveLineages(
  workspaces: readonly { id: string; forkedFromWorkspaceId?: string | null }[]
): Map<string, Lineage> {
  const parents = new Map<string, string | null>()
  for (const workspace of workspaces)
    parents.set(workspace.id, workspace.forkedFromWorkspaceId ?? null)
  const lineages = new Map<string, Lineage>()
  for (const workspace of workspaces) {
    let rootId = workspace.id
    let depth = 0
    const seen = new Set<string>([rootId])
    for (;;) {
      const parent = parents.get(rootId)
      if (!parent || !parents.has(parent) || seen.has(parent)) break
      seen.add(parent)
      rootId = parent
      depth += 1
    }
    lineages.set(workspace.id, { rootId, depth })
  }
  return lineages
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
  const lineages = resolveLineages(workspaces)
  const environmentsByRoot = new Map<string, ProjectEnvironment[]>()
  for (const workspace of workspaces) {
    const lineage = lineages.get(workspace.id)
    if (!lineage) continue
    const { environment } = parseEnvironmentName(workspace.name)
    const label = environment ?? DEPTH_LABELS[lineage.depth] ?? `Fork ${lineage.depth}`
    const list = environmentsByRoot.get(lineage.rootId) ?? []
    list.push({ workspaceId: workspace.id, label })
    environmentsByRoot.set(lineage.rootId, list)
  }
  const real: Project[] = workspaces.map((workspace, index) => {
    const lineage = lineages.get(workspace.id) ?? { rootId: workspace.id, depth: 0 }
    const root = workspaces.find((candidate) => candidate.id === lineage.rootId) ?? workspace
    const environments = [...(environmentsByRoot.get(lineage.rootId) ?? [])].sort((a, b) =>
      a.workspaceId === lineage.rootId ? -1 : b.workspaceId === lineage.rootId ? 1 : 0
    )
    return {
      id: workspace.id,
      name: parseEnvironmentName(root.name).base,
      organizationId: workspace.organizationId ?? null,
      ...matchOverlay(
        workspace.name,
        (workflowLists[index]?.data ?? []).map((workflow) => workflow.name)
      ),
      overlayPending: workflowLists[index]?.isPending ?? true,
      isMock: false,
      rootId: lineage.rootId,
      environment:
        environments.find((candidate) => candidate.workspaceId === workspace.id)?.label ??
        DEPTH_LABELS[0],
      environments,
    }
  })
  /** Packs no real workspace claimed stay in the sidebar as mock projects, below the real ones. */
  const claimed = new Set(real.map((project) => project.mock.id))
  const settled = !query.isPending && real.every((project) => !project.overlayPending)
  const mocks = settled ? WORKSPACES.filter((pack) => !claimed.has(pack.id)).map(mockProject) : []
  const projects = [...real, ...mocks]
  /** One entry per project for the sidebar and pickers: each lineage's root, then the mocks. */
  const roots = projects.filter((project) => project.rootId === project.id)
  return { projects, roots, isPending: query.isPending, error: query.error }
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
