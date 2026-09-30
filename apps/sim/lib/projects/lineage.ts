/** One workspace of a project, labelled by the environment it plays: Prod, Staging, Sandbox. */
export interface ProjectEnvironment {
  workspaceId: string
  label: string
}

/** Where a workspace sits in its fork lineage. */
export interface WorkspaceLineage {
  /** The workspace at the top of the lineage; the project is listed under it. */
  rootId: string
  /** How many forks below the root this workspace is; 0 for the root. */
  depth: number
}

/** A project is one fork lineage seen from one of its workspaces. */
export interface ProjectLineage extends WorkspaceLineage {
  /** The project name: the root workspace's name without its environment word. */
  name: string
  /** This workspace's environment label. */
  environment: string
  /** Every environment of the project, root first. */
  environments: ProjectEnvironment[]
}

export interface LineageWorkspace {
  id: string
  name: string
  forkedFromWorkspaceId?: string | null
}

/** A trailing environment word on a workspace name names its environment; the rest names the project. */
const ENVIRONMENT_SUFFIX =
  /^(.*?)[\s-]+(prod|production|staging|stage|sandbox|dev|development|test|uat|qa)$/i

/** What a fork is called when its name carries no environment word, by depth below the root. */
export const DEPTH_LABELS = ['Prod', 'Staging', 'Sandbox'] as const

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

export function parseEnvironmentName(name: string): { base: string; environment: string | null } {
  const match = ENVIRONMENT_SUFFIX.exec(name.trim())
  return match
    ? { base: match[1].trim(), environment: capitalize(match[2]) }
    : { base: name.trim(), environment: null }
}

/**
 * Groups forked workspaces under the workspace they were forked from, following
 * `forkedFromWorkspaceId` while the parent is in the list the viewer can see.
 */
export function resolveLineages(
  workspaces: readonly { id: string; forkedFromWorkspaceId?: string | null }[]
): Map<string, WorkspaceLineage> {
  const parents = new Map<string, string | null>()
  for (const workspace of workspaces)
    parents.set(workspace.id, workspace.forkedFromWorkspaceId ?? null)
  const lineages = new Map<string, WorkspaceLineage>()
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
 * Resolves every workspace's project: its lineage, the project name, and the environments of
 * the lineage in root-first order. Environment labels come from the workspace name's trailing
 * environment word, else from the fork depth.
 */
export function resolveProjectLineages(
  workspaces: readonly LineageWorkspace[]
): Map<string, ProjectLineage> {
  const lineages = resolveLineages(workspaces)
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
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
  const projects = new Map<string, ProjectLineage>()
  for (const workspace of workspaces) {
    const lineage = lineages.get(workspace.id) ?? { rootId: workspace.id, depth: 0 }
    const root = byId.get(lineage.rootId) ?? workspace
    const environments = [...(environmentsByRoot.get(lineage.rootId) ?? [])].sort((a, b) =>
      a.workspaceId === lineage.rootId ? -1 : b.workspaceId === lineage.rootId ? 1 : 0
    )
    projects.set(workspace.id, {
      ...lineage,
      name: parseEnvironmentName(root.name).base,
      environment:
        environments.find((candidate) => candidate.workspaceId === workspace.id)?.label ??
        DEPTH_LABELS[0],
      environments,
    })
  }
  return projects
}
