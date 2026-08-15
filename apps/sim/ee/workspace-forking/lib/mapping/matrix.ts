import { db } from '@sim/db'
import { workspaceForkResourceMap } from '@sim/db/schema'
import { and, inArray, notInArray } from 'drizzle-orm'
import type {
  ForkMappableResourceType,
  ForkMappingCandidate,
  ForkMatrixCell,
  ForkMatrixRow,
} from '@/lib/api/contracts/workspace-fork'
import { forkMappableResourceTypeSchema } from '@/lib/api/contracts/workspace-fork'
import { resourceTypeToForkKind } from '@/ee/workspace-forking/lib/mapping/mapping-store'
import {
  CANDIDATE_LIMIT,
  listForkResourceCandidates,
  loadForkResourceLabels,
} from '@/ee/workspace-forking/lib/mapping/resources'
import type { ForkRemapKind } from '@/ee/workspace-forking/lib/remap/remap-references'

/**
 * Ceiling on the mapping rows one matrix request reads. A lineage's rows scale with the distinct
 * resources its workflows reference — tens to low hundreds per edge — so the cap only trips on an
 * outlier, where a truncated matrix beats a timed-out page.
 */
const MAX_MATRIX_MAPPING_ROWS = 8000

/** Resource types that are never user-mappable, so they never become a matrix row. */
const NON_MAPPABLE_RESOURCE_TYPES = [
  'workflow',
  'workflow_mcp_server',
  'knowledge_document',
] as const

const MAPPABLE_RESOURCE_TYPES: ReadonlySet<string> = new Set(forkMappableResourceTypeSchema.options)

/** One workspace in the matrix's column order, with the edge it hangs off. */
export interface ForkMatrixColumn {
  id: string
  parentId: string | null
}

/** One edge's mapping row, oriented parent resource to child resource. */
export interface ForkMatrixMappingRow {
  childWorkspaceId: string
  resourceType: ForkMappableResourceType
  parentResourceId: string
  childResourceId: string | null
}

/** One resource followed down a lineage. */
export interface ForkMatrixChain {
  resourceType: ForkMappableResourceType
  /** The shallowest workspace that knows this resource — nothing maps into it. */
  originWorkspaceId: string
  originResourceId: string
  /** Resource id per workspace the chain reaches; null where the edge maps to nothing yet. */
  steps: Map<string, string | null>
}

/** `${workspaceId}:${resourceType}:${resourceId}` — a resource's position in the lineage. */
const positionKey = (workspaceId: string, resourceType: string, resourceId: string) =>
  `${workspaceId}:${resourceType}:${resourceId}`

async function loadMatrixMappingRows(childIds: string[]): Promise<ForkMatrixMappingRow[]> {
  if (childIds.length === 0) return []
  const rows = await db
    .select({
      childWorkspaceId: workspaceForkResourceMap.childWorkspaceId,
      resourceType: workspaceForkResourceMap.resourceType,
      parentResourceId: workspaceForkResourceMap.parentResourceId,
      childResourceId: workspaceForkResourceMap.childResourceId,
    })
    .from(workspaceForkResourceMap)
    .where(
      and(
        inArray(workspaceForkResourceMap.childWorkspaceId, childIds),
        notInArray(workspaceForkResourceMap.resourceType, [...NON_MAPPABLE_RESOURCE_TYPES])
      )
    )
    .limit(MAX_MATRIX_MAPPING_ROWS)

  // The query already excludes the non-mappable types; narrowing here is what turns that into a
  // type the rest of the module can trust without a cast.
  return rows.flatMap((row) =>
    MAPPABLE_RESOURCE_TYPES.has(row.resourceType) ? [row as ForkMatrixMappingRow] : []
  )
}

/**
 * Compose per-edge mapping rows into chains, each walked down the tree from its origin.
 *
 * A chain STARTS at a resource nothing maps into — the shallowest workspace that knows it. That is
 * what keeps two unrelated resources sharing a name apart, and what lets a resource introduced
 * halfway down a lineage own its row rather than being grafted onto the root's.
 *
 * Pure over (columns, rows) so the composition is testable without a database.
 */
export function buildForkMatrixChains(
  columns: ForkMatrixColumn[],
  rows: ForkMatrixMappingRow[]
): ForkMatrixChain[] {
  const parentByWorkspace = new Map(columns.map((column) => [column.id, column.parentId]))
  const childWorkspaces = new Map<string, string[]>()
  for (const column of columns) {
    if (!column.parentId) continue
    const siblings = childWorkspaces.get(column.parentId)
    if (siblings) siblings.push(column.id)
    else childWorkspaces.set(column.parentId, [column.id])
  }

  /** Parent position to each child edge's landing, so a chain can be walked downward. */
  const downward = new Map<string, Array<{ workspaceId: string; resourceId: string | null }>>()
  /** Every position some edge maps INTO — i.e. every position that is not an origin. */
  const mappedInto = new Set<string>()

  for (const row of rows) {
    const parentWorkspaceId = parentByWorkspace.get(row.childWorkspaceId)
    if (!parentWorkspaceId) continue
    const from = positionKey(parentWorkspaceId, row.resourceType, row.parentResourceId)
    const step = { workspaceId: row.childWorkspaceId, resourceId: row.childResourceId }
    const steps = downward.get(from)
    if (steps) steps.push(step)
    else downward.set(from, [step])
    if (row.childResourceId) {
      mappedInto.add(positionKey(row.childWorkspaceId, row.resourceType, row.childResourceId))
    }
  }

  const chains: ForkMatrixChain[] = []
  const seenOrigins = new Set<string>()

  for (const row of rows) {
    const parentWorkspaceId = parentByWorkspace.get(row.childWorkspaceId)
    if (!parentWorkspaceId) continue
    const origin = positionKey(parentWorkspaceId, row.resourceType, row.parentResourceId)
    if (mappedInto.has(origin) || seenOrigins.has(origin)) continue
    seenOrigins.add(origin)

    const steps = new Map<string, string | null>([[parentWorkspaceId, row.parentResourceId]])
    const visit = (workspaceId: string, resourceId: string) => {
      for (const step of downward.get(positionKey(workspaceId, row.resourceType, resourceId)) ??
        []) {
        // The fork graph is a tree, so a workspace is reached once; the guard only protects
        // against malformed data pointing a chain back at a workspace it already passed.
        if (steps.has(step.workspaceId) && steps.get(step.workspaceId) === step.resourceId) continue
        steps.set(step.workspaceId, step.resourceId)
        if (step.resourceId) visit(step.workspaceId, step.resourceId)
      }
      // A child workspace with no row still gets a cell, so the matrix offers the mapping that
      // does not exist yet instead of rendering a silent gap.
      for (const childId of childWorkspaces.get(workspaceId) ?? []) {
        if (!steps.has(childId)) steps.set(childId, null)
      }
    }
    visit(parentWorkspaceId, row.parentResourceId)

    chains.push({
      resourceType: row.resourceType,
      originWorkspaceId: parentWorkspaceId,
      originResourceId: row.parentResourceId,
      steps,
    })
  }

  return chains
}

export interface ForkMatrixData {
  rows: ForkMatrixRow[]
  /** Mapping targets a cell may pick, keyed by workspace id then by remap kind. */
  candidates: Record<string, Record<string, ForkMappingCandidate[]>>
  /** Workspaces whose candidate list hit the per-kind cap, so their pickers are partial. */
  candidatesTruncated: string[]
}

/**
 * The mappings matrix for one lineage: every resource chain across its workspaces, each cell
 * labelled from the workspace it lands in, plus the targets a cell may be re-pointed at.
 *
 * Labels come from an exact-id lookup rather than the capped candidate list, so a workspace past
 * the candidate cap still resolves a live resource's name — an id that fails to resolve therefore
 * means exactly one thing, which is what `missing` reports.
 */
export async function getForkMatrix(columns: ForkMatrixColumn[]): Promise<ForkMatrixData> {
  const childIds = columns.flatMap((column) => (column.parentId ? [column.id] : []))
  const chains = buildForkMatrixChains(columns, await loadMatrixMappingRows(childIds))

  // Ids to resolve per workspace, grouped by remap kind, so each workspace takes one bounded read
  // rather than one per cell.
  const idsByWorkspace = new Map<string, Partial<Record<ForkRemapKind, Set<string>>>>()
  for (const chain of chains) {
    const kind = resourceTypeToForkKind(chain.resourceType)
    if (!kind) continue
    for (const [workspaceId, resourceId] of chain.steps) {
      if (!resourceId) continue
      let byKind = idsByWorkspace.get(workspaceId)
      if (!byKind) {
        byKind = {}
        idsByWorkspace.set(workspaceId, byKind)
      }
      const bucket = byKind[kind] ?? new Set<string>()
      bucket.add(resourceId)
      byKind[kind] = bucket
    }
  }

  const [labelEntries, candidateEntries] = await Promise.all([
    Promise.all(
      columns.map(async (column) => {
        const idsByKind = idsByWorkspace.get(column.id)
        const labels = idsByKind ? await loadForkResourceLabels(db, column.id, idsByKind) : {}
        return [column.id, labels] as const
      })
    ),
    Promise.all(
      columns.map(
        async (column) => [column.id, await listForkResourceCandidates(db, column.id)] as const
      )
    ),
  ])

  const labelsByWorkspace = new Map(labelEntries)
  const candidates: Record<string, Record<string, ForkMappingCandidate[]>> = {}
  const candidatesTruncated: string[] = []
  for (const [workspaceId, byKind] of candidateEntries) {
    candidates[workspaceId] = byKind
    if (Object.values(byKind).some((list) => list.length >= CANDIDATE_LIMIT)) {
      candidatesTruncated.push(workspaceId)
    }
  }

  const rows: ForkMatrixRow[] = []
  for (const chain of chains) {
    const kind = resourceTypeToForkKind(chain.resourceType)
    if (!kind) continue
    const cells: Record<string, ForkMatrixCell> = {}
    for (const [workspaceId, resourceId] of chain.steps) {
      const label = resourceId
        ? (labelsByWorkspace.get(workspaceId)?.[kind]?.get(resourceId) ?? null)
        : null
      cells[workspaceId] = {
        resourceId,
        label: resourceId ? (label ?? resourceId) : null,
        missing: resourceId !== null && label === null,
      }
    }
    rows.push({
      key: positionKey(chain.originWorkspaceId, chain.resourceType, chain.originResourceId),
      resourceType: chain.resourceType,
      kind,
      originWorkspaceId: chain.originWorkspaceId,
      label: cells[chain.originWorkspaceId]?.label ?? chain.originResourceId,
      cells,
    })
  }

  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
  return { rows, candidates, candidatesTruncated }
}
