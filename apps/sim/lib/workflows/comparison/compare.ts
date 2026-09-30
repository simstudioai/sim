import {
  blockRetryEquals,
  collectErrorSourceBlockIds,
  resolveEffectiveErrorEnabled,
} from '@sim/workflow-types/workflow'
import { resolveCanonicalBlockSpec } from '@/lib/workflows/canonical/block-spec'
import {
  type CanonicalFieldSpec,
  canonicalizeSubBlockValue,
} from '@/lib/workflows/canonical/subblock-value'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  extractBlockFieldsForComparison,
  filterSubBlockIds,
  normalizedStringify,
  normalizeEdge,
  normalizeLoop,
  normalizeParallel,
  normalizeTriggerConfigValues,
  normalizeValue,
  normalizeVariables,
  sanitizeVariable,
} from './normalize'

/**
 * Compare the current workflow state with the deployed state to detect meaningful changes.
 * Uses generateWorkflowDiffSummary internally to ensure consistent change detection.
 */
export function hasWorkflowChanged(
  currentState: WorkflowState,
  deployedState: WorkflowState | null
): boolean {
  return generateWorkflowDiffSummary(currentState, deployedState).hasChanges
}

/**
 * Represents a single field change with old and new values
 */
interface FieldChange {
  field: string
  oldValue: unknown
  newValue: unknown
}

/** The loop configuration fields a container diff compares, in the order they are reported. */
export const LOOP_CONFIG_FIELDS = [
  'loopType',
  'iterations',
  'forEachItems',
  'whileCondition',
  'doWhileCondition',
] as const

/** The parallel configuration fields a container diff compares, in the order they are reported. */
export const PARALLEL_CONFIG_FIELDS = ['parallelType', 'count', 'distribution'] as const

export type ContainerConfigField =
  | (typeof LOOP_CONFIG_FIELDS)[number]
  | (typeof PARALLEL_CONFIG_FIELDS)[number]

/**
 * A loop or parallel container present on both sides whose configuration or
 * membership differs. Added and removed containers are reported as blocks.
 */
export interface ContainerChange {
  id: string
  kind: 'loop' | 'parallel'
  name?: string
  changes: FieldChange[]
  /** Block ids that are inside the container on the current side only */
  nodesAdded: string[]
  /** Block ids that were inside the container on the previous side only */
  nodesRemoved: string[]
}

/**
 * Result of workflow diff analysis between two workflow states
 */
export interface WorkflowDiffSummary {
  addedBlocks: Array<{ id: string; type: string; name?: string }>
  removedBlocks: Array<{ id: string; type: string; name?: string }>
  modifiedBlocks: Array<{ id: string; type: string; name?: string; changes: FieldChange[] }>
  edgeChanges: {
    added: number
    removed: number
    addedDetails: Array<{ sourceName: string; targetName: string }>
    removedDetails: Array<{ sourceName: string; targetName: string }>
  }
  loopChanges: { added: number; removed: number; modified: number }
  parallelChanges: { added: number; removed: number; modified: number }
  containerChanges: ContainerChange[]
  variableChanges: {
    added: number
    removed: number
    modified: number
    addedNames: string[]
    removedNames: string[]
    modifiedNames: string[]
  }
  hasChanges: boolean
}

/**
 * Field-by-field description of a container that changed, from the normalized
 * shapes the equality check already uses so the two can never disagree.
 */
function describeContainerChange(
  id: string,
  kind: ContainerChange['kind'],
  name: string | undefined,
  current: { nodes: string[] } | null,
  previous: { nodes: string[] } | null,
  fields: readonly string[]
): ContainerChange {
  const changes: FieldChange[] = []
  const currentRecord = (current ?? {}) as Record<string, unknown>
  const previousRecord = (previous ?? {}) as Record<string, unknown>
  for (const field of fields) {
    if (normalizedStringify(currentRecord[field]) !== normalizedStringify(previousRecord[field])) {
      changes.push({
        field,
        oldValue: previousRecord[field] ?? null,
        newValue: currentRecord[field] ?? null,
      })
    }
  }
  const currentNodes = new Set(current?.nodes ?? [])
  const previousNodes = new Set(previous?.nodes ?? [])
  return {
    id,
    kind,
    name,
    changes,
    nodesAdded: [...currentNodes].filter((node) => !previousNodes.has(node)),
    nodesRemoved: [...previousNodes].filter((node) => !currentNodes.has(node)),
  }
}

/** Whether any counted section of a summary reports a difference. */
export function summaryHasChanges(summary: Omit<WorkflowDiffSummary, 'hasChanges'>): boolean {
  return (
    summary.addedBlocks.length > 0 ||
    summary.removedBlocks.length > 0 ||
    summary.modifiedBlocks.length > 0 ||
    summary.edgeChanges.added > 0 ||
    summary.edgeChanges.removed > 0 ||
    summary.loopChanges.added > 0 ||
    summary.loopChanges.removed > 0 ||
    summary.loopChanges.modified > 0 ||
    summary.parallelChanges.added > 0 ||
    summary.parallelChanges.removed > 0 ||
    summary.parallelChanges.modified > 0 ||
    summary.variableChanges.added > 0 ||
    summary.variableChanges.removed > 0 ||
    summary.variableChanges.modified > 0
  )
}

/**
 * Generate a detailed diff summary between two workflow states
 */
export function generateWorkflowDiffSummary(
  currentState: WorkflowState,
  previousState: WorkflowState | null
): WorkflowDiffSummary {
  const result: WorkflowDiffSummary = {
    addedBlocks: [],
    removedBlocks: [],
    modifiedBlocks: [],
    edgeChanges: { added: 0, removed: 0, addedDetails: [], removedDetails: [] },
    loopChanges: { added: 0, removed: 0, modified: 0 },
    parallelChanges: { added: 0, removed: 0, modified: 0 },
    containerChanges: [],
    variableChanges: {
      added: 0,
      removed: 0,
      modified: 0,
      addedNames: [],
      removedNames: [],
      modifiedNames: [],
    },
    hasChanges: false,
  }

  if (!previousState) {
    const currentBlocks = currentState.blocks || {}
    for (const [id, block] of Object.entries(currentBlocks)) {
      result.addedBlocks.push({
        id,
        type: block.type,
        name: block.name,
      })
    }

    const edges = currentState.edges || []
    result.edgeChanges.added = edges.length
    for (const edge of edges) {
      const sourceBlock = currentBlocks[edge.source]
      const targetBlock = currentBlocks[edge.target]
      result.edgeChanges.addedDetails.push({
        sourceName: sourceBlock?.name || sourceBlock?.type || edge.source,
        targetName: targetBlock?.name || targetBlock?.type || edge.target,
      })
    }

    result.loopChanges.added = Object.keys(currentState.loops || {}).length
    result.parallelChanges.added = Object.keys(currentState.parallels || {}).length

    const variables = currentState.variables || {}
    const varEntries = Object.entries(variables)
    result.variableChanges.added = varEntries.length
    for (const [id, variable] of varEntries) {
      result.variableChanges.addedNames.push((variable as { name?: string }).name || id)
    }

    result.hasChanges = true
    return result
  }

  const currentBlocks = currentState.blocks || {}
  const previousBlocks = previousState.blocks || {}
  const currentBlockIds = new Set(Object.keys(currentBlocks))
  const previousBlockIds = new Set(Object.keys(previousBlocks))
  const currentErrorSources = collectErrorSourceBlockIds(currentState.edges)
  const previousErrorSources = collectErrorSourceBlockIds(previousState.edges)

  for (const id of currentBlockIds) {
    if (!previousBlockIds.has(id)) {
      const block = currentBlocks[id]
      result.addedBlocks.push({
        id,
        type: block.type,
        name: block.name,
      })
    }
  }

  for (const id of previousBlockIds) {
    if (!currentBlockIds.has(id)) {
      const block = previousBlocks[id]
      result.removedBlocks.push({
        id,
        type: block.type,
        name: block.name,
      })
    }
  }

  for (const id of currentBlockIds) {
    if (!previousBlockIds.has(id)) continue

    const currentBlock = currentBlocks[id]
    const previousBlock = previousBlocks[id]
    const changes: FieldChange[] = []

    const {
      blockRest: currentRest,
      normalizedData: currentDataRest,
      subBlocks: currentSubBlocks,
    } = extractBlockFieldsForComparison(currentBlock)
    const {
      blockRest: previousRest,
      normalizedData: previousDataRest,
      subBlocks: previousSubBlocks,
    } = extractBlockFieldsForComparison(previousBlock)

    /**
     * Outside the structural gate below: the flag alone can match while the edges
     * disagree, and reading it alone pins a block with a stale `errorEnabled: false`
     * and a live error edge to "needs redeploy" forever.
     */
    const currentErrorEnabled = resolveEffectiveErrorEnabled(currentBlock, id, currentErrorSources)
    const previousErrorEnabled = resolveEffectiveErrorEnabled(
      previousBlock,
      id,
      previousErrorSources
    )
    if (currentErrorEnabled !== previousErrorEnabled) {
      changes.push({
        field: 'errorEnabled',
        oldValue: previousErrorEnabled,
        newValue: currentErrorEnabled,
      })
    }

    const normalizedCurrentBlock = { ...currentRest, data: currentDataRest, subBlocks: undefined }
    const normalizedPreviousBlock = {
      ...previousRest,
      data: previousDataRest,
      subBlocks: undefined,
    }

    if (
      normalizedStringify(normalizedCurrentBlock) !== normalizedStringify(normalizedPreviousBlock)
    ) {
      if (currentBlock.type !== previousBlock.type) {
        changes.push({ field: 'type', oldValue: previousBlock.type, newValue: currentBlock.type })
      }
      if (currentBlock.name !== previousBlock.name) {
        changes.push({ field: 'name', oldValue: previousBlock.name, newValue: currentBlock.name })
      }
      if (currentBlock.enabled !== previousBlock.enabled) {
        changes.push({
          field: 'enabled',
          oldValue: previousBlock.enabled,
          newValue: currentBlock.enabled,
        })
      }
      /** `errorEnabled` is compared above, against the edges as well as the flag. */
      const blockFields = ['horizontalHandles', 'advancedMode', 'triggerMode'] as const
      for (const field of blockFields) {
        if (!!currentBlock[field] !== !!previousBlock[field]) {
          changes.push({
            field,
            oldValue: previousBlock[field],
            newValue: currentBlock[field],
          })
        }
      }
      /** Outside `blockFields`, whose `!!` coercion cannot tell two policies apart. */
      if (!blockRetryEquals(currentBlock.retry, previousBlock.retry)) {
        changes.push({
          field: 'retry',
          oldValue: previousBlock.retry,
          newValue: currentBlock.retry,
        })
      }
      if (normalizedStringify(currentDataRest) !== normalizedStringify(previousDataRest)) {
        const allDataKeys = new Set([
          ...Object.keys(currentDataRest),
          ...Object.keys(previousDataRest),
        ])
        for (const key of allDataKeys) {
          if (
            normalizedStringify(currentDataRest[key]) !== normalizedStringify(previousDataRest[key])
          ) {
            changes.push({
              field: `data.${key}`,
              oldValue: previousDataRest[key] ?? null,
              newValue: currentDataRest[key] ?? null,
            })
          }
        }
      }
    }

    const normalizedCurrentSubs = normalizeTriggerConfigValues(currentSubBlocks)
    const normalizedPreviousSubs = normalizeTriggerConfigValues(previousSubBlocks)

    const allSubBlockIds = filterSubBlockIds([
      ...new Set([...Object.keys(normalizedCurrentSubs), ...Object.keys(normalizedPreviousSubs)]),
    ])

    /*
     * Resolved from the CURRENT definition and applied to both sides, so a field
     * added to a block definition after a workflow was deployed reads the same
     * on the frozen snapshot as on the live draft.
     */
    const blockSpec = resolveCanonicalBlockSpec(currentBlock)

    for (const subId of allSubBlockIds) {
      const currentSub = normalizedCurrentSubs[subId] as Record<string, unknown> | undefined
      const previousSub = normalizedPreviousSubs[subId] as Record<string, unknown> | undefined

      /*
       * A field the definition does not declare still gets blank-collapsed; it
       * just has no default to compare against. Falling back to the stored type
       * keeps the shape rules working for undeclared and custom-block fields.
       */
      const declared = blockSpec?.fields.get(subId)
      const spec: CanonicalFieldSpec = {
        type: (declared?.type ?? currentSub?.type ?? previousSub?.type) as string | undefined,
        defaultValue: declared?.defaultValue,
        emptyIsValid: declared?.emptyIsValid,
      }

      /*
       * Absence and blankness are the same answer here, so a key present on one
       * side only is not itself a change — it is a change only if the value it
       * holds resolves to something. Comparing presence directly is what made
       * `acceptOtherMethods: false` on the live side differ from a deployed
       * snapshot that predates the field.
       */
      const currentValue = canonicalizeSubBlockValue(subId, currentSub?.value, spec)
      const previousValue = canonicalizeSubBlockValue(subId, previousSub?.value, spec)

      if (normalizedStringify(currentValue) !== normalizedStringify(previousValue)) {
        changes.push({
          field: subId,
          oldValue: previousSub?.value ?? null,
          newValue: currentSub?.value ?? null,
        })
      }
    }

    if (changes.length > 0) {
      result.modifiedBlocks.push({
        id,
        type: currentBlock.type,
        name: currentBlock.name,
        changes,
      })
    }
  }

  const currentEdges = (currentState.edges || []).map(normalizeEdge)
  const previousEdges = (previousState.edges || []).map(normalizeEdge)
  const currentEdgeSet = new Set(currentEdges.map(normalizedStringify))
  const previousEdgeSet = new Set(previousEdges.map(normalizedStringify))

  const resolveBlockName = (blockId: string): string => {
    const block = currentBlocks[blockId] || previousBlocks[blockId]
    return block?.name || block?.type || blockId
  }

  for (const edgeStr of currentEdgeSet) {
    if (!previousEdgeSet.has(edgeStr)) {
      result.edgeChanges.added++
      const edge = JSON.parse(edgeStr) as { source: string; target: string }
      result.edgeChanges.addedDetails.push({
        sourceName: resolveBlockName(edge.source),
        targetName: resolveBlockName(edge.target),
      })
    }
  }
  for (const edgeStr of previousEdgeSet) {
    if (!currentEdgeSet.has(edgeStr)) {
      result.edgeChanges.removed++
      const edge = JSON.parse(edgeStr) as { source: string; target: string }
      result.edgeChanges.removedDetails.push({
        sourceName: resolveBlockName(edge.source),
        targetName: resolveBlockName(edge.target),
      })
    }
  }

  const currentLoops = currentState.loops || {}
  const previousLoops = previousState.loops || {}
  const currentLoopIds = Object.keys(currentLoops)
  const previousLoopIds = Object.keys(previousLoops)

  for (const id of currentLoopIds) {
    if (!previousLoopIds.includes(id)) {
      result.loopChanges.added++
    } else {
      const normalizedCurrent = normalizeLoop(currentLoops[id])
      const normalizedPrevious = normalizeLoop(previousLoops[id])
      if (
        normalizedStringify(normalizeValue(normalizedCurrent)) !==
        normalizedStringify(normalizeValue(normalizedPrevious))
      ) {
        result.loopChanges.modified++
        result.containerChanges.push(
          describeContainerChange(
            id,
            'loop',
            currentBlocks[id]?.name ?? previousBlocks[id]?.name,
            normalizedCurrent ?? null,
            normalizedPrevious ?? null,
            LOOP_CONFIG_FIELDS
          )
        )
      }
    }
  }
  for (const id of previousLoopIds) {
    if (!currentLoopIds.includes(id)) {
      result.loopChanges.removed++
    }
  }

  const currentParallels = currentState.parallels || {}
  const previousParallels = previousState.parallels || {}
  const currentParallelIds = Object.keys(currentParallels)
  const previousParallelIds = Object.keys(previousParallels)

  for (const id of currentParallelIds) {
    if (!previousParallelIds.includes(id)) {
      result.parallelChanges.added++
    } else {
      const normalizedCurrent = normalizeParallel(currentParallels[id])
      const normalizedPrevious = normalizeParallel(previousParallels[id])
      if (
        normalizedStringify(normalizeValue(normalizedCurrent)) !==
        normalizedStringify(normalizeValue(normalizedPrevious))
      ) {
        result.parallelChanges.modified++
        result.containerChanges.push(
          describeContainerChange(
            id,
            'parallel',
            currentBlocks[id]?.name ?? previousBlocks[id]?.name,
            normalizedCurrent ?? null,
            normalizedPrevious ?? null,
            PARALLEL_CONFIG_FIELDS
          )
        )
      }
    }
  }
  for (const id of previousParallelIds) {
    if (!currentParallelIds.includes(id)) {
      result.parallelChanges.removed++
    }
  }

  const currentVars = normalizeVariables(currentState.variables)
  const previousVars = normalizeVariables(previousState.variables)
  const currentVarIds = Object.keys(currentVars)
  const previousVarIds = Object.keys(previousVars)

  for (const id of currentVarIds) {
    if (!previousVarIds.includes(id)) {
      result.variableChanges.added++
      result.variableChanges.addedNames.push(currentVars[id].name || id)
    }
  }
  for (const id of previousVarIds) {
    if (!currentVarIds.includes(id)) {
      result.variableChanges.removed++
      result.variableChanges.removedNames.push(previousVars[id].name || id)
    }
  }

  for (const id of currentVarIds) {
    if (!previousVarIds.includes(id)) continue
    const currentVar = normalizeValue(sanitizeVariable(currentVars[id]))
    const previousVar = normalizeValue(sanitizeVariable(previousVars[id]))
    if (normalizedStringify(currentVar) !== normalizedStringify(previousVar)) {
      result.variableChanges.modified++
      result.variableChanges.modifiedNames.push(currentVars[id].name || id)
    }
  }

  result.hasChanges = summaryHasChanges(result)

  return result
}
