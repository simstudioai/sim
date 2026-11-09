'use client'

import { useCallback, useMemo } from 'react'
import type { Edge } from '@xyflow/react'
import { isEqual } from 'es-toolkit'
import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useVariablesStore } from '@/stores/variables/store'
import type { Variable } from '@/stores/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { EMPTY_SUBBLOCK_VALUES, useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

const EMPTY_VARIABLES: Variable[] = []
const EMPTY_LOOPS: Record<string, Loop> = {}
const EMPTY_PARALLELS: Record<string, Parallel> = {}

/**
 * The graph half of the workflow a `<block.output>` autocomplete resolves against: everything a
 * block's reachability depends on.
 *
 * Split out from the rest because it is what the reference-validation path reads, on every
 * keystroke, from several sub-block editors at once. Widening that read to the whole scope
 * would subscribe those editors to live sub-block values — which change on every keystroke
 * anywhere in the workflow — and re-render them for edits that cannot affect reachability.
 */
interface WorkflowReferenceGraph {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
}

interface WorkflowReferenceScope extends WorkflowReferenceGraph {
  /** Scopes workflow-level variables; `null` when no workflow is in scope. */
  workflowId: string | null
  /**
   * Unsaved sub-block edits layered over `blocks`, so a reference reflects what the user is
   * typing rather than what was last persisted.
   */
  subBlockValues: Record<string, Record<string, unknown>>
  variables: Variable[]
}

/** The graph of the workflow open in the editor, from the live workflow store. */
export function useWorkflowReferenceGraph(): WorkflowReferenceGraph {
  return useWorkflowStore(
    useShallow((state) => ({
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || EMPTY_LOOPS,
      parallels: state.parallels || EMPTY_PARALLELS,
    }))
  )
}

/**
 * The full scope of the workflow open in the editor, for surfaces that render the tag list itself
 * (block outputs need live sub-block values to type their fields; workflow variables are their own
 * tag group).
 */
export function useWorkflowReferenceScope(): WorkflowReferenceScope {
  const graph = useWorkflowReferenceGraph()
  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const subBlockValues = useSubBlockStore(
    (state) => (workflowId ? state.workflowValues[workflowId] : undefined) ?? EMPTY_SUBBLOCK_VALUES
  )
  const variables = useStoreWithEqualityFn(
    useVariablesStore,
    useCallback(
      (state) =>
        workflowId
          ? Object.values(state.variables).filter((variable) => variable.workflowId === workflowId)
          : EMPTY_VARIABLES,
      [workflowId]
    ),
    isEqual
  )
  return useMemo(
    () => ({ ...graph, workflowId, subBlockValues, variables }),
    [graph, workflowId, subBlockValues, variables]
  )
}
