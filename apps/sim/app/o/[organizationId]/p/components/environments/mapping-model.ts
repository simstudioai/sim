import type { ProjectEnvironment } from '@/app/o/[organizationId]/p/hooks/use-projects'
import {
  MAPPING_SECTION,
  type MappableMappingKind,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'

type ResourceTabId = MappableMappingKind

interface ResourceTab {
  id: ResourceTabId
  label: string
}

/** Mapping resource types in the sync view's order. */
export const RESOURCE_TABS: readonly ResourceTab[] = (
  Object.keys(MAPPING_SECTION) as MappableMappingKind[]
)
  .sort((a, b) => MAPPING_SECTION[a].order - MAPPING_SECTION[b].order)
  .map((id) => ({ id, label: MAPPING_SECTION[id].label }))

/** The ids the `?environment-resource=` URL param accepts. */
export const RESOURCE_TAB_IDS = RESOURCE_TABS.map((tab) => tab.id) as [
  ResourceTabId,
  ...ResourceTabId[],
]

/** One direct parent to child fork edge; mappings and diffs exist per edge. */
export interface LineageEdge {
  childId: string
  parentId: string
}

/** One environment as a grid column and a lineage card. */
export interface EnvironmentColumn {
  id: string
  label: string
  name: string
  /** The environment this one was forked from; null for the root. */
  parentId: string | null
}

/**
 * Orders the environments root first and each fork after its parent, so every edge's parent
 * side is placed before its child side and rows can be joined edge by edge.
 */
export function orderEnvironments(
  rootId: string,
  environments: readonly ProjectEnvironment[],
  parentOf: ReadonlyMap<string, string | null>,
  nameOf: ReadonlyMap<string, string>
): EnvironmentColumn[] {
  const columns: EnvironmentColumn[] = []
  const seen = new Set<string>()
  const queue = [rootId]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (seen.has(current)) continue
    seen.add(current)
    const environment = environments.find((candidate) => candidate.workspaceId === current)
    if (!environment) continue
    columns.push({
      id: current,
      label: nameOf.get(current) ?? environment.label,
      name: nameOf.get(current) ?? environment.label,
      parentId: current === rootId ? null : (parentOf.get(current) ?? null),
    })
    for (const candidate of environments) {
      if (parentOf.get(candidate.workspaceId) === current) queue.push(candidate.workspaceId)
    }
  }
  /** An environment whose parent left the lineage still gets a column, detached. */
  for (const environment of environments) {
    if (seen.has(environment.workspaceId)) continue
    columns.push({
      id: environment.workspaceId,
      label: environment.label,
      name: nameOf.get(environment.workspaceId) ?? environment.label,
      parentId: null,
    })
  }
  return columns
}

export function lineageEdges(columns: readonly EnvironmentColumn[]): LineageEdge[] {
  const edges: LineageEdge[] = []
  for (const column of columns) {
    if (column.parentId) edges.push({ childId: column.id, parentId: column.parentId })
  }
  return edges
}
