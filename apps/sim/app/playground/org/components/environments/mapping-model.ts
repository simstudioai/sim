import type { BadgeProps } from '@sim/emcn'
import {
  type ForkMappingEntry,
  type ForkWorkflowChange,
  forkCopyableKindSchema,
} from '@/lib/api/contracts/workspace-fork'
import type { ProjectEnvironment } from '@/lib/projects'
import {
  MAPPING_SECTION,
  type MappableMappingKind,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'

/** The workflows sub-tab: fed by the sync diff rather than a mapping kind. */
export const WORKFLOW_TAB = 'workflow'

export type ResourceTabId = typeof WORKFLOW_TAB | MappableMappingKind

export interface ResourceTab {
  id: ResourceTabId
  label: string
}

/** Sub-tabs in the sync view's order: workflows first, then every mapping kind. */
export const RESOURCE_TABS: readonly ResourceTab[] = [
  { id: WORKFLOW_TAB, label: 'Workflows' },
  ...(Object.keys(MAPPING_SECTION) as MappableMappingKind[])
    .sort((a, b) => MAPPING_SECTION[a].order - MAPPING_SECTION[b].order)
    .map((id) => ({ id, label: MAPPING_SECTION[id].label })),
]

/** The ids the `?resource=` URL param accepts. */
export const RESOURCE_TAB_IDS: readonly ResourceTabId[] = RESOURCE_TABS.map((tab) => tab.id)

/** The sync view's mapping vocabulary, one status per cell. */
export type MappingStatus = 'mapped' | 'suggested' | 'copy' | 'needs-setup' | 'source-deleted'

/** Badge copy and color per status, matching the sync view's kind badges. */
export const MAPPING_STATUS: Record<
  MappingStatus,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  mapped: { label: 'Mapped', variant: 'green' },
  suggested: { label: 'Suggested', variant: 'amber' },
  copy: { label: 'Copy', variant: 'gray-secondary' },
  'needs-setup': { label: 'Needs setup', variant: 'amber' },
  'source-deleted': { label: 'Source deleted', variant: 'red' },
}

/** Kinds a sync copies into the target when they are left unmapped. */
const COPYABLE_KINDS: ReadonlySet<string> = new Set(forkCopyableKindSchema.options)

export function isCopyableKind(kind: string): boolean {
  return COPYABLE_KINDS.has(kind)
}

/** The status of the child side of an edge entry. */
export function entryStatus(entry: ForkMappingEntry): MappingStatus {
  if (entry.targetId) return entry.suggested ? 'suggested' : 'mapped'
  if (isCopyableKind(entry.kind) && !entry.sourceDeleted) return 'copy'
  return 'needs-setup'
}

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
      label: environment.label,
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

/** One environment's side of a resource row. */
export interface MappingCell {
  /** The resource's id in this environment; null while the child side has no target yet. */
  id: string | null
  label: string
  /** Null on the origin side, where there is nothing to map. */
  status: MappingStatus | null
  /** The edge entry this cell edits; present on the child side of an edge. */
  entry?: ForkMappingEntry
  edge?: LineageEdge
}

export interface MappingRow {
  key: string
  kind: MappableMappingKind
  /** The root-most name of the resource. */
  label: string
  /** By environment (workspace) id; an environment the resource never reached has no cell. */
  cells: Record<string, MappingCell>
}

export interface EdgeMapping {
  edge: LineageEdge
  entries: readonly ForkMappingEntry[]
}

function targetLabel(entry: ForkMappingEntry): string {
  if (!entry.targetId) return ''
  return (
    entry.candidates.find((candidate) => candidate.id === entry.targetId)?.label ?? entry.targetId
  )
}

/**
 * Joins the per-edge mappings into one row per resource: an entry's source on the parent side
 * joins the row that reached that resource through an earlier edge, else starts a row. Edges
 * must arrive parent first (see {@link orderEnvironments}).
 */
export function buildMappingRows(edgeMappings: readonly EdgeMapping[]): MappingRow[] {
  const rows: MappingRow[] = []
  /** Rows by `${workspaceId}:${kind}:${resourceId}` for every side they reached. */
  const byResource = new Map<string, MappingRow>()
  for (const { edge, entries } of edgeMappings) {
    for (const entry of entries) {
      if (entry.kind === 'knowledge-document') continue
      const sourceKey = `${edge.parentId}:${entry.kind}:${entry.sourceId}`
      let row = byResource.get(sourceKey)
      if (!row) {
        row = {
          key: sourceKey,
          kind: entry.kind,
          label: entry.sourceLabel,
          cells: {
            [edge.parentId]: {
              id: entry.sourceId,
              label: entry.sourceLabel,
              status: entry.sourceDeleted ? 'source-deleted' : null,
            },
          },
        }
        rows.push(row)
        byResource.set(sourceKey, row)
      }
      row.cells[edge.childId] = {
        id: entry.targetId,
        label: targetLabel(entry),
        status: entryStatus(entry),
        entry,
        edge,
      }
      if (entry.targetId) {
        byResource.set(`${edge.childId}:${entry.kind}:${entry.targetId}`, row)
      }
    }
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The resource's id in the youngest environment that has it, so a row's icon follows the leaf
 * credential (one Atlassian token serves Jira and Confluence; the fork's own pick decides).
 */
export function leafResourceId(
  row: MappingRow,
  columns: readonly EnvironmentColumn[]
): { environmentId: string; id: string } | null {
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const column = columns[index]
    const id = row.cells[column.id]?.id
    if (id) return { environmentId: column.id, id }
  }
  return null
}

/** One environment's side of a workflow row. */
export interface WorkflowCell {
  /** Null when the workflow does not exist in this environment yet. */
  name: string | null
  status: MappingStatus | null
  /** Null when the environment's workflow list does not name it. */
  deployed: boolean | null
}

export interface WorkflowRow {
  key: string
  label: string
  cells: Record<string, WorkflowCell>
}

export interface EdgeDiff {
  edge: LineageEdge
  workflows: readonly ForkWorkflowChange[]
}

/**
 * Joins the per-edge sync previews into one row per deployed workflow, by name: a pull's
 * `otherName` is the parent's workflow, `currentName` the child's. `update` means both sides
 * have it, `create` that the child lacks it, `archive` that only the child has it.
 */
export function buildWorkflowRows(
  edgeDiffs: readonly EdgeDiff[],
  deployedByEnv: ReadonlyMap<string, ReadonlyMap<string, boolean>>
): WorkflowRow[] {
  const rows: WorkflowRow[] = []
  const byName = new Map<string, WorkflowRow>()
  const deployed = (workspaceId: string, name: string): boolean | null =>
    deployedByEnv.get(workspaceId)?.get(name) ?? null
  for (const { edge, workflows } of edgeDiffs) {
    for (const change of workflows) {
      if (change.action === 'archive') {
        const key = `${edge.childId}:${change.currentName}`
        if (byName.has(key)) continue
        const row: WorkflowRow = {
          key,
          label: change.currentName,
          cells: {
            [edge.childId]: {
              name: change.currentName,
              status: 'source-deleted',
              deployed: deployed(edge.childId, change.currentName),
            },
          },
        }
        rows.push(row)
        byName.set(key, row)
        continue
      }
      const sourceKey = `${edge.parentId}:${change.otherName}`
      let row = byName.get(sourceKey)
      if (!row) {
        row = {
          key: sourceKey,
          label: change.otherName,
          cells: {
            [edge.parentId]: {
              name: change.otherName,
              status: null,
              deployed: deployed(edge.parentId, change.otherName),
            },
          },
        }
        rows.push(row)
        byName.set(sourceKey, row)
      }
      if (change.action === 'create') {
        row.cells[edge.childId] = { name: null, status: 'copy', deployed: null }
        continue
      }
      row.cells[edge.childId] = {
        name: change.currentName,
        status: 'mapped',
        deployed: deployed(edge.childId, change.currentName),
      }
      byName.set(`${edge.childId}:${change.currentName}`, row)
    }
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label))
}
