import { generateId } from '@sim/utils/id'
import {
  remapVariableIdsInSubBlocks,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Replaces preview-stable variable labels only after the graph has been admitted for import. */
export function regenerateImportedVariableIds(state: WorkflowState): Map<string, string> {
  const ids = new Map<string, string>()
  const variables: NonNullable<WorkflowState['variables']> = {}
  for (const [sourceId, variable] of Object.entries(state.variables ?? {})) {
    const id = generateId()
    ids.set(sourceId, id)
    variables[id] = { ...variable, id }
  }
  state.variables = variables
  for (const block of Object.values(state.blocks)) {
    const fields: SubBlockRecord = {}
    for (const [key, field] of Object.entries(block.subBlocks)) fields[key] = { ...field }
    const remapped = remapVariableIdsInSubBlocks(fields, ids)
    for (const [key, field] of Object.entries(remapped)) {
      block.subBlocks[key] = {
        ...block.subBlocks[key],
        value: field.value as (typeof block.subBlocks)[string]['value'],
      }
    }
  }
  return ids
}
