import type { WorkflowGroup } from '@/lib/table/types'

/**
 * Drops the given column ids from a workflow group's dependencies and input
 * mappings, returning the group unchanged when neither referenced them.
 *
 * A pure projection over the group, deliberately kept in its own leaf module
 * rather than alongside the group runtime in `workflow-columns`: that module
 * reaches the executor and, through it, the executable tool registry, so any
 * server graph importing this helper from there pays ~4,700 modules for a
 * function that only reshapes an object.
 */
export function stripGroupDeps(group: WorkflowGroup, removed: ReadonlySet<string>): WorkflowGroup {
  const cols = group.dependencies?.columns ?? []
  const mappings = group.inputMappings ?? []
  const filteredDeps = cols.filter((d) => !removed.has(d))
  const filteredMappings = mappings.filter((m) => !removed.has(m.columnName))
  const depsChanged = filteredDeps.length !== cols.length
  const mappingsChanged = filteredMappings.length !== mappings.length
  if (!depsChanged && !mappingsChanged) return group
  const next: WorkflowGroup = { ...group }
  if (depsChanged) {
    next.dependencies = filteredDeps.length > 0 ? { columns: filteredDeps } : undefined
  }
  if (mappingsChanged) {
    next.inputMappings = filteredMappings.length > 0 ? filteredMappings : undefined
  }
  return next
}
