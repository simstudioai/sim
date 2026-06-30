import { createLogger } from '@sim/logger'
import { remapConditionBlockIds } from '@/lib/workflows/condition-ids'
import { SYSTEM_SUBBLOCK_IDS, TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

const logger = createLogger('WorkflowRemapInternalIds')

/**
 * Untrusted shape of a persisted block subBlocks JSON column. Callers narrow
 * `type`/`value` with runtime checks before mutating; the index signature exists
 * because the raw record is handed back to drizzle without knowing which subBlock
 * keys it contains.
 */
export type SubBlockRecord = Record<
  string,
  { type?: unknown; value?: unknown; [key: string]: unknown }
>

type VariableAssignment = Record<string, unknown> & { variableId?: unknown }

const DUPLICATE_STRIPPED_SYSTEM_SUBBLOCK_IDS = new Set(
  SYSTEM_SUBBLOCK_IDS.filter((id) => id !== 'triggerCredentials')
)

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Coerce a subblock value that holds a JSON array (stored as an array or a JSON string). */
export function coerceObjectArray(value: unknown): { array: unknown[] | null; wasString: boolean } {
  if (Array.isArray(value)) return { array: value, wasString: false }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return { array: parsed, wasString: true }
    } catch {}
  }
  return { array: null, wasString: false }
}

export function isSystemSubBlockKey(key: string, ids: Set<string> | string[]): boolean {
  const idList = Array.isArray(ids) ? ids : Array.from(ids)
  return idList.some((id) => key === id || key.startsWith(`${id}_`))
}

/** Strip trigger-runtime and non-credential system subblocks for a fresh copy. */
export function sanitizeSubBlocksForDuplicate(subBlocks: SubBlockRecord): SubBlockRecord {
  const sanitized: SubBlockRecord = {}
  for (const [key, subBlock] of Object.entries(subBlocks)) {
    if (isSystemSubBlockKey(key, TRIGGER_RUNTIME_SUBBLOCK_IDS)) continue
    if (isSystemSubBlockKey(key, DUPLICATE_STRIPPED_SYSTEM_SUBBLOCK_IDS)) continue
    sanitized[key] = subBlock
  }
  return sanitized
}

function remapVariableAssignment(value: unknown, varIdMap: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapVariableAssignment(item, varIdMap))
  }
  if (!isRecord(value)) {
    return value
  }
  const assignment = value as VariableAssignment
  const next: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(assignment)) {
    next[key] = remapVariableAssignment(nestedValue, varIdMap)
  }
  if (typeof assignment.variableId === 'string') {
    const newVarId = varIdMap.get(assignment.variableId)
    if (newVarId) {
      next.variableId = newVarId
    } else {
      logger.warn('Skipping unknown variable reference during copy', {
        variableId: assignment.variableId,
      })
    }
  }
  return next
}

function remapVariableInputValue(value: unknown, varIdMap: Map<string, string>): unknown {
  if (value == null) {
    return value
  }
  if (Array.isArray(value)) {
    return remapVariableAssignment(value, varIdMap)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return value
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('Variables input assignments could not be parsed for copy')
    }
    if (Array.isArray(parsed)) {
      return remapVariableAssignment(parsed, varIdMap)
    }
    throw new Error('Variables input assignments must be an array')
  }
  throw new Error('Variables input assignments must be an array')
}

/**
 * Remap old variable IDs to new variable IDs inside block subBlocks, targeting
 * `variables-input` subblocks whose value is an array of variable assignments.
 */
export function remapVariableIdsInSubBlocks(
  subBlocks: SubBlockRecord,
  varIdMap: Map<string, string>
): SubBlockRecord {
  const updated: SubBlockRecord = {}
  for (const [key, subBlock] of Object.entries(subBlocks)) {
    if (subBlock && typeof subBlock === 'object' && subBlock.type === 'variables-input') {
      updated[key] = {
        ...subBlock,
        value: remapVariableInputValue(subBlock.value, varIdMap),
      }
    } else {
      updated[key] = subBlock
    }
  }
  return updated
}

/**
 * Rewrite cross-workflow references through a workflow id map: single
 * `workflow-selector` / `manualWorkflowId` values, multi-workflow lists
 * (`workflowSelector` multi-select + comma-separated `manualWorkflowIds`, as used
 * by the logs block), and `workflow_input` sub-workflow tools nested in a
 * `tool-input` array (an agent calling another workflow as a tool).
 *
 * `clearUnmapped` controls the cross-workspace case: fork/promote pass `true` so a
 * reference to a workflow that wasn't copied is cleared/dropped rather than left
 * pointing at the source workspace (a silent cross-workspace execution). Same-
 * workspace duplication leaves it `false` to preserve references to untouched
 * sibling workflows.
 */
export function remapWorkflowReferencesInSubBlocks(
  subBlocks: SubBlockRecord,
  workflowIdMap: Map<string, string> | undefined,
  options?: { clearUnmapped?: boolean }
): SubBlockRecord {
  if (!workflowIdMap?.size) return subBlocks
  const clearUnmapped = options?.clearUnmapped ?? false
  let clearedWorkflowSelector = false
  const remapScalar = (value: string): string => {
    const mapped = workflowIdMap.get(value)
    if (mapped) return mapped
    if (clearUnmapped) {
      clearedWorkflowSelector = true
      return ''
    }
    return value
  }
  const updated: SubBlockRecord = {}
  for (const [key, subBlock] of Object.entries(subBlocks)) {
    if (subBlock && typeof subBlock === 'object') {
      const baseKey = key.replace(/_\d+$/, '')
      if (
        (subBlock.type === 'workflow-selector' || baseKey === 'manualWorkflowId') &&
        typeof subBlock.value === 'string' &&
        subBlock.value
      ) {
        updated[key] = { ...subBlock, value: remapScalar(subBlock.value) }
        continue
      }
      if (baseKey === 'manualWorkflowIds' || baseKey === 'workflowSelector') {
        const remapped = remapWorkflowIdList(subBlock.value, workflowIdMap, clearUnmapped)
        if (remapped !== subBlock.value) {
          updated[key] = { ...subBlock, value: remapped }
          continue
        }
      }
      if (subBlock.type === 'tool-input') {
        const remapped = remapWorkflowInputTools(subBlock.value, workflowIdMap, clearUnmapped)
        if (remapped !== subBlock.value) {
          updated[key] = { ...subBlock, value: remapped }
          continue
        }
      }
    }
    updated[key] = subBlock
  }
  // A cleared workflow selector (its target workflow wasn't copied) leaves the block's
  // `inputMapping` pointing at a workflow that no longer exists; clear it too so no orphaned
  // mapping survives. The nested `workflow_input` tool case drops the whole tool (with its
  // inputMapping) above, so only the top-level block-level inputMapping needs this.
  if (clearedWorkflowSelector) {
    for (const [key, subBlock] of Object.entries(updated)) {
      if (key.replace(/_\d+$/, '') !== 'inputMapping') continue
      if (!subBlock || typeof subBlock !== 'object') continue
      if (subBlock.value === '' || subBlock.value == null) continue
      updated[key] = { ...subBlock, value: '' }
    }
  }
  return updated
}

/**
 * Rewrite a multi-workflow value (comma-separated string or array of workflow ids)
 * through a workflow id map. Unmapped ids are dropped when `clearUnmapped` is set
 * (cross-workspace) and preserved otherwise. Returns the original reference when
 * nothing changed.
 */
function remapWorkflowIdList(
  value: unknown,
  workflowIdMap: Map<string, string>,
  clearUnmapped: boolean
): unknown {
  const remapId = (id: string): string | null => {
    const mapped = workflowIdMap.get(id)
    if (mapped) return mapped
    return clearUnmapped ? null : id
  }
  if (Array.isArray(value)) {
    let changed = false
    const next: unknown[] = []
    for (const item of value) {
      if (typeof item !== 'string' || !item) {
        next.push(item)
        continue
      }
      const mapped = remapId(item)
      if (mapped === null) {
        changed = true
        continue
      }
      if (mapped !== item) changed = true
      next.push(mapped)
    }
    return changed ? next : value
  }
  if (typeof value === 'string' && value) {
    const next: string[] = []
    for (const id of value.split(',').map((entry) => entry.trim())) {
      if (!id) continue
      const mapped = remapId(id)
      if (mapped !== null) next.push(mapped)
    }
    const joined = next.join(',')
    return joined === value ? value : joined
  }
  return value
}

/**
 * Rewrite `workflow_input` tools' `params.workflowId` through a workflow id map.
 * When `clearUnmapped` is set, a tool pointing at a workflow that wasn't copied is
 * dropped (it can't be referenced cross-workspace).
 */
function remapWorkflowInputTools(
  value: unknown,
  workflowIdMap: Map<string, string>,
  clearUnmapped: boolean
): unknown {
  const { array, wasString } = coerceObjectArray(value)
  if (!array) return value
  let changed = false
  const next = array.flatMap((tool) => {
    if (!isRecord(tool) || tool.type !== 'workflow_input' || !isRecord(tool.params)) return [tool]
    const workflowId = tool.params.workflowId
    if (typeof workflowId !== 'string') return [tool]
    const mapped = workflowIdMap.get(workflowId)
    if (mapped) {
      if (mapped === workflowId) return [tool]
      changed = true
      return [{ ...tool, params: { ...tool.params, workflowId: mapped } }]
    }
    if (clearUnmapped) {
      changed = true
      return []
    }
    return [tool]
  })
  if (!changed) return value
  return wasString ? JSON.stringify(next) : next
}

/**
 * Remap condition/router block IDs within subBlocks when a block is copied with
 * a new ID. Returns a new object without mutating the input.
 */
export function remapConditionIdsInSubBlocks(
  subBlocks: SubBlockRecord,
  oldBlockId: string,
  newBlockId: string
): SubBlockRecord {
  const updated: SubBlockRecord = {}
  for (const [key, subBlock] of Object.entries(subBlocks)) {
    if (
      subBlock &&
      typeof subBlock === 'object' &&
      (subBlock.type === 'condition-input' || subBlock.type === 'router-input') &&
      typeof subBlock.value === 'string'
    ) {
      try {
        const parsed = JSON.parse(subBlock.value)
        if (Array.isArray(parsed) && remapConditionBlockIds(parsed, oldBlockId, newBlockId)) {
          updated[key] = { ...subBlock, value: JSON.stringify(parsed) }
          continue
        }
      } catch {}
    }
    updated[key] = subBlock
  }
  return updated
}
