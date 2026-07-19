import { createLogger } from '@sim/logger'
import { remapConditionBlockIds } from '@/lib/workflows/condition-ids'
import {
  type CanonicalModeOverrides,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
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
 * Rewrite cross-workflow references through a workflow id map. Only SELECTOR-sourced (structured)
 * references are remapped/cleared: the basic `workflow-selector` value, the multi-select
 * `workflowSelector` list (logs block), the workspace-event trigger's multi-select `workflowIds`
 * dropdown (its options are workspace workflow ids), and `workflow_input` sub-workflow tools
 * nested in a `tool-input` array (an agent picking another workflow as a tool - its
 * `params.workflowId` comes from the workflow picker, never free-form input).
 *
 * The advanced, free-form MANUAL fields (`manualWorkflowId`, comma-separated `manualWorkflowIds`)
 * are user-owned and pass through VERBATIM - mirroring `manualCredential` in the fork remap - so a
 * hand-typed value (an env ref `{{VAR}}`, a `<block.output>` tag, a literal id, or arbitrary text)
 * is never rewritten or cleared. The `workflowIds` handling is gated on subblock TYPE `dropdown`
 * for the same reason: the legacy logs block's `workflowIds` is a free-form `short-input`
 * (user-owned, verbatim), and only the workspace-event trigger uses a `workflowIds` dropdown.
 *
 * `clearUnmapped` controls the cross-workspace case for those selector references: fork/promote pass
 * `true` so a selector pointing at a workflow that wasn't copied is cleared/dropped rather than left
 * pointing at the source workspace (a silent cross-workspace execution). Same-workspace duplication
 * leaves it `false` to preserve references to untouched sibling workflows.
 */
export function remapWorkflowReferencesInSubBlocks(
  subBlocks: SubBlockRecord,
  workflowIdMap: Map<string, string> | undefined,
  options?: { clearUnmapped?: boolean; canonicalModes?: CanonicalModeOverrides }
): SubBlockRecord {
  if (!workflowIdMap?.size) return subBlocks
  const clearUnmapped = options?.clearUnmapped ?? false
  const remapScalar = (value: string): string => {
    const mapped = workflowIdMap.get(value)
    if (mapped) return mapped
    return clearUnmapped ? '' : value
  }
  // The `workflowId` canonical pair: basic `workflow-selector` + advanced `manualWorkflowId`. Capture
  // each key (by type/baseKey, regardless of value) and its ORIGINAL value so the inputMapping wipe
  // below can decide on the ACTIVE mode's disposition via `resolveCanonicalMode`. Only the basic
  // selector is ever remapped; the advanced manual member is captured for mode resolution only.
  let basicId: string | undefined
  let basicValue = ''
  let advancedId: string | undefined
  let advancedValue = ''
  const updated: SubBlockRecord = {}
  for (const [key, subBlock] of Object.entries(subBlocks)) {
    if (subBlock && typeof subBlock === 'object') {
      const baseKey = key.replace(/_\d+$/, '')
      if (subBlock.type === 'workflow-selector' && basicId === undefined) {
        basicId = key
        basicValue = typeof subBlock.value === 'string' ? subBlock.value : ''
      } else if (baseKey === 'manualWorkflowId' && advancedId === undefined) {
        advancedId = key
        advancedValue = typeof subBlock.value === 'string' ? subBlock.value : ''
      }
      // Remap only the SELECTOR member; the manual `manualWorkflowId` passes through verbatim.
      if (
        subBlock.type === 'workflow-selector' &&
        typeof subBlock.value === 'string' &&
        subBlock.value
      ) {
        updated[key] = { ...subBlock, value: remapScalar(subBlock.value) }
        continue
      }
      // Remap only the STRUCTURED multi-workflow lists: the logs block's `workflowSelector` and
      // the workspace-event trigger's `workflowIds` dropdown. The latter is gated on TYPE
      // `dropdown` so the legacy logs block's `workflowIds` short-input (manual, user-owned)
      // passes through verbatim, as does the manual comma-separated `manualWorkflowIds`.
      if (
        baseKey === 'workflowSelector' ||
        (subBlock.type === 'dropdown' && baseKey === 'workflowIds')
      ) {
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

  if (basicId !== undefined || advancedId !== undefined) {
    const isEmptyValue = (value: unknown) => value === '' || value == null
    const values: Record<string, unknown> = {}
    if (basicId !== undefined) values[basicId] = basicValue
    if (advancedId !== undefined) values[advancedId] = advancedValue
    const activeMode = resolveCanonicalMode(
      { canonicalId: 'workflowId', basicId, advancedIds: advancedId ? [advancedId] : [] },
      values,
      options?.canonicalModes
    )
    const activeKey = activeMode === 'advanced' ? advancedId : basicId
    const originalActive = activeKey === basicId ? basicValue : advancedValue
    const postActive = activeKey !== undefined ? updated[activeKey]?.value : undefined
    if (activeKey !== undefined && !isEmptyValue(originalActive) && isEmptyValue(postActive)) {
      for (const [key, subBlock] of Object.entries(updated)) {
        if (key.replace(/_\d+$/, '') !== 'inputMapping') continue
        if (!subBlock || typeof subBlock !== 'object') continue
        if (subBlock.value === '' || subBlock.value == null) continue
        updated[key] = { ...subBlock, value: '' }
      }
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
