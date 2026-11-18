import { useMemo } from 'react'
import { BLOCK_LAYOUT_DATA_FIELDS, BLOCK_LAYOUT_FIELDS } from '@sim/workflow-code/layout'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import type { BlockState } from '@sim/workflow-types/workflow'
import type { Edge } from '@xyflow/react'
import { useVariablesStore } from '@/stores/variables/store'
import type { Variable } from '@/stores/variables/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * The live draft as one workflow state: canvas blocks merged with the
 * sub-block values the editor holds separately, plus this workflow's
 * variables. This is the shape deployment snapshots use, so it compares
 * cleanly against any of them.
 *
 * The merge walks every block on every store change, so a consumer that has
 * nothing to compare against yet passes `false` as `enabled` and gets null
 * without paying for it.
 */
export function useDraftWorkflowState(
  workflowId: string | null,
  enabled = true
): WorkflowState | null {
  const active = enabled && Boolean(workflowId)
  const blocks = useWorkflowStore((state) => (active ? state.blocks : null))
  const edges = useWorkflowStore((state) => (active ? state.edges : null))
  const loops = useWorkflowStore((state) => (active ? state.loops : null))
  const parallels = useWorkflowStore((state) => (active ? state.parallels : null))
  const subBlockValues = useSubBlockStore((state) =>
    active && workflowId ? state.workflowValues[workflowId] : null
  )
  const allVariables = useVariablesStore((state) => (active ? state.variables : null))

  const workflowVariables = useMemo(() => {
    const vars: WorkflowState['variables'] = {}
    if (!workflowId || !allVariables) return vars
    for (const [id, variable] of Object.entries(allVariables)) {
      if (variable.workflowId === workflowId) vars[id] = variable
    }
    return vars
  }, [workflowId, allVariables])

  return useMemo((): WorkflowState | null => {
    if (!workflowId || !blocks || !edges || !loops || !parallels) return null
    return {
      blocks: mergeSubblockStateWithValues(blocks, subBlockValues ?? {}),
      edges,
      loops,
      parallels,
      variables: workflowVariables,
    }
  }, [workflowId, blocks, edges, loops, parallels, subBlockValues, workflowVariables])
}

/**
 * Canvas geometry: block fields a draft reader may ignore. `data` is compared field by field
 * instead, since a resize writes its width and height.
 */
const GEOMETRY_FIELDS: ReadonlySet<string> = new Set([...BLOCK_LAYOUT_FIELDS, 'data'])
const GEOMETRY_DATA_FIELDS: ReadonlySet<string> = new Set(BLOCK_LAYOUT_DATA_FIELDS)
const NO_FIELDS: ReadonlySet<string> = new Set()

/** Whether two records differ by identity in any field outside `ignored`. */
function differsBeyond(next: object, previous: object, ignored: ReadonlySet<string>): boolean {
  if (next === previous) return false
  const fields = (value: object) => Object.entries(value).filter(([field]) => !ignored.has(field))
  const kept = new Map(fields(previous))
  const changed = fields(next)
  return (
    changed.length !== kept.size ||
    changed.some(([field, value]) => !kept.has(field) || kept.get(field) !== value)
  )
}

/** Whether two block maps differ in anything but geometry; a drag replaces only moved blocks. */
function blocksChangedBeyondGeometry(
  next: Record<string, BlockState>,
  previous: Record<string, BlockState>
): boolean {
  const ids = Object.keys(next)
  if (ids.length !== Object.keys(previous).length) return true
  return ids.some((id) => {
    const block = next[id]
    const before = previous[id]
    if (block === before) return false
    if (!before) return true
    return (
      differsBeyond(block, before, GEOMETRY_FIELDS) ||
      differsBeyond(block.data ?? {}, before.data ?? {}, GEOMETRY_DATA_FIELDS)
    )
  })
}

/**
 * Whether the edge list gained, lost or replaced an edge. Block-only writes (a container resize,
 * a handle toggle) copy the array without touching an edge, so identity alone over-reports.
 */
function edgesChanged(next: readonly Edge[], previous: readonly Edge[]): boolean {
  if (next === previous) return false
  return next.length !== previous.length || next.some((edge, index) => edge !== previous[index])
}

/** Whether a variable of `workflowId` was added, removed or replaced. */
function workflowVariablesChanged(
  next: Record<string, Variable>,
  previous: Record<string, Variable>,
  workflowId: string
): boolean {
  if (next === previous) return false
  const ids = new Set([...Object.keys(next), ...Object.keys(previous)])
  for (const id of ids) {
    const after = next[id]
    const before = previous[id]
    if (
      after !== before &&
      (after?.workflowId === workflowId || before?.workflowId === workflowId)
    ) {
      return true
    }
  }
  return false
}

/**
 * Calls `onChange` whenever the draft {@link useDraftWorkflowState} returns for `workflowId`
 * changes: the canvas graph, this workflow's sub-block values, or its variables. A block change
 * that only moves or resizes it does not count, nor does a write that copies the loops or
 * parallels map without replacing an entry (a handle toggle). Returns the unsubscribe function.
 */
export function subscribeToDraftChanges(workflowId: string, onChange: () => void): () => void {
  const unsubscribers = [
    useWorkflowStore.subscribe((state, previous) => {
      if (
        edgesChanged(state.edges, previous.edges) ||
        differsBeyond(state.loops, previous.loops, NO_FIELDS) ||
        differsBeyond(state.parallels, previous.parallels, NO_FIELDS) ||
        (state.blocks !== previous.blocks &&
          blocksChangedBeyondGeometry(state.blocks, previous.blocks))
      ) {
        onChange()
      }
    }),
    useSubBlockStore.subscribe((state, previous) => {
      if (state.workflowValues[workflowId] !== previous.workflowValues[workflowId]) onChange()
    }),
    useVariablesStore.subscribe((state, previous) => {
      if (workflowVariablesChanged(state.variables, previous.variables, workflowId)) onChange()
    }),
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
