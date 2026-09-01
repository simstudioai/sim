/**
 * Schema invariants for workflow-group columns, kept in a leaf module.
 *
 * Pure functions over a `TableSchema`. They lived in `workflow-columns.ts`,
 * which transitively reaches the executable tool registry, so importing them
 * from `service.ts` to validate a create pulled ~5,200 modules into every page
 * graph that renders a table. Splitting them out keeps one source of truth for
 * what a valid schema is — reachable from the create path and from every later
 * mutation — without the weight.
 */

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getColumnId } from '@/lib/table/column-keys'
import { validateColumnTypeLimits } from '@/lib/table/column-types'
import type { TableSchema, WorkflowGroup } from '@/lib/table/types'

/**
 * Validates schema-level invariants. Run on every `addTableColumn`,
 * `addWorkflowGroup`, `updateWorkflowGroup`, `renameColumn`, `reorderColumns`,
 * etc. Returns a list of human-readable errors (empty if valid).
 */
export function validateSchema(schema: TableSchema, columnOrder: string[] | undefined): string[] {
  const errors = validateColumnTypeLimits(schema.columns)
  // Group refs and columnOrder hold stable column ids (not display names).
  const columnsById = new Map(schema.columns.map((c) => [getColumnId(c), c]))
  const groups = schema.workflowGroups ?? []
  const groupsById = new Map(groups.map((g) => [g.id, g]))

  // Reference integrity for group outputs.
  const claimedColumns = new Map<string, string>() // columnId → groupId
  for (const group of groups) {
    if (group.outputs.length === 0) {
      errors.push(`Workflow group "${group.name ?? group.id}" has no outputs.`)
    }
    for (const out of group.outputs) {
      const col = columnsById.get(out.columnName)
      if (!col) {
        errors.push(
          `Workflow group "${group.name ?? group.id}" references missing column "${out.columnName}".`
        )
        continue
      }
      if (col.workflowGroupId !== group.id) {
        errors.push(
          `Column "${col.name}" is referenced by group "${group.id}" but its workflowGroupId is "${col.workflowGroupId ?? '(unset)'}".`
        )
      }
      const claimer = claimedColumns.get(out.columnName)
      if (claimer && claimer !== group.id) {
        errors.push(
          `Column "${out.columnName}" is claimed by both groups "${claimer}" and "${group.id}".`
        )
      } else {
        claimedColumns.set(out.columnName, group.id)
      }
    }
  }

  // Every column flagged with a workflowGroupId must appear in exactly one group's outputs.
  for (const col of schema.columns) {
    if (!col.workflowGroupId) continue
    if (!groupsById.has(col.workflowGroupId)) {
      errors.push(
        `Column "${col.name}" references missing workflow group "${col.workflowGroupId}".`
      )
      continue
    }
    if (claimedColumns.get(getColumnId(col)) !== col.workflowGroupId) {
      errors.push(
        `Column "${col.name}" has workflowGroupId "${col.workflowGroupId}" but isn't in that group's outputs.`
      )
    }
    if (col.required) {
      errors.push(`Workflow-output column "${col.name}" cannot be required.`)
    }
    if (col.unique) {
      errors.push(`Workflow-output column "${col.name}" cannot be unique.`)
    }
  }

  // Dependency integrity. Deps are columns only — workflow output columns are
  // valid deps too (the upstream group fills them, downstream becomes eligible
  // when filled). A group can't depend on its own outputs.
  for (const group of groups) {
    const ownOutputs = new Set(group.outputs.map((o) => o.columnName))
    for (const depCol of group.dependencies?.columns ?? []) {
      const col = columnsById.get(depCol)
      if (!col) {
        errors.push(`Group "${group.name ?? group.id}" depends on missing column "${depCol}".`)
        continue
      }
      if (ownOutputs.has(depCol)) {
        errors.push(
          `Group "${group.name ?? group.id}" depends on its own output column "${depCol}".`
        )
      }
    }
  }

  // Cycle detection on the column-induced group graph. An edge A → B exists
  // when B depends on a column that A produces.
  const cycle = findGroupCycle(groups)
  if (cycle) {
    errors.push(
      `Workflow groups form a dependency cycle: ${cycle.map((id) => groupsById.get(id)?.name ?? id).join(' → ')}.`
    )
  }

  // Layout: every group's outputs must be contiguous in columnOrder (when set).
  if (columnOrder && columnOrder.length > 0) {
    for (const split of findSplitGroups(columnOrder, groups)) {
      errors.push(
        `Workflow group "${split.groupName}" output columns must be contiguous; got order [${split.actual.join(', ')}].`
      )
    }
  }

  return errors
}

/**
 * Returns the cycle as an ordered list of group ids, or null if acyclic. Edges
 * are induced by columns: an edge A → B exists iff B depends on a column that
 * A produces.
 */
function findGroupCycle(groups: WorkflowGroup[]): string[] | null {
  // Map each output column → the group that produces it.
  const producerByColumn = new Map<string, string>()
  for (const g of groups) {
    for (const o of g.outputs) producerByColumn.set(o.columnName, g.id)
  }
  const adjacency = new Map<string, string[]>()
  for (const g of groups) {
    const upstream = new Set<string>()
    for (const depCol of g.dependencies?.columns ?? []) {
      const producer = producerByColumn.get(depCol)
      if (producer && producer !== g.id) upstream.add(producer)
    }
    adjacency.set(g.id, [...upstream])
  }
  const VISITING = 1
  const VISITED = 2
  const state = new Map<string, number>()
  const stack: string[] = []

  const dfs = (id: string): string[] | null => {
    if (state.get(id) === VISITED) return null
    if (state.get(id) === VISITING) {
      const cycleStart = stack.indexOf(id)
      return cycleStart >= 0 ? [...stack.slice(cycleStart), id] : [id]
    }
    state.set(id, VISITING)
    stack.push(id)
    for (const next of adjacency.get(id) ?? []) {
      const found = dfs(next)
      if (found) return found
    }
    stack.pop()
    state.set(id, VISITED)
    return null
  }

  for (const g of groups) {
    const cycle = dfs(g.id)
    if (cycle) return cycle
  }
  return null
}

interface SplitGroupReport {
  groupId: string
  groupName: string
  actual: number[]
}

/**
 * Returns groups whose output columns occupy non-contiguous positions in the
 * given columnOrder. Empty array means all groups are cohesive.
 */
export function findSplitGroups(
  columnOrder: string[],
  groups: WorkflowGroup[]
): SplitGroupReport[] {
  const positions = new Map<string, number>()
  columnOrder.forEach((name, idx) => positions.set(name, idx))
  const reports: SplitGroupReport[] = []
  for (const group of groups) {
    const indices = group.outputs
      .map((o) => positions.get(o.columnName))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b)
    if (indices.length < 2) continue
    const min = indices[0]
    const max = indices[indices.length - 1]
    if (max - min + 1 !== indices.length) {
      reports.push({
        groupId: group.id,
        groupName: group.name ?? group.id,
        actual: indices,
      })
    }
  }
  return reports
}

export function assertValidSchema(schema: TableSchema, columnOrder: string[] | undefined): void {
  const errs = validateSchema(schema, columnOrder)
  if (errs.length > 0) {
    throw new OrchestrationError('validation', `Schema validation failed: ${errs.join('; ')}`)
  }
}
