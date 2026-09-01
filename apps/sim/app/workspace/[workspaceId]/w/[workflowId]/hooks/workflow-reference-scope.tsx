'use client'

import { createContext, useCallback, useContext, useMemo } from 'react'
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
const EMPTY_BLOCKS: Record<string, BlockState> = {}
const EMPTY_EDGES: Edge[] = []
const EMPTY_LOOPS: Record<string, Loop> = {}
const EMPTY_PARALLELS: Record<string, Parallel> = {}

/**
 * The workflow a `<block.output>` autocomplete resolves against.
 *
 * On the canvas this is the workflow open in the editor, read from the live stores — which is
 * why every reference surface used to read those stores directly. Off-canvas there IS no open
 * workflow, so a surface that configures a block belonging to some OTHER workflow (the fork
 * sync modal configuring a custom block in a target workspace's workflow) supplies the graph
 * itself. Both paths then produce identical, position-aware suggestions.
 */
/**
 * The graph half of a scope: everything a block's REACHABILITY depends on.
 *
 * Split out from the rest because it is what the reference-validation path reads, on every
 * keystroke, from several sub-block editors at once. Widening that read to the whole scope
 * would subscribe those editors to live sub-block values — which change on every keystroke
 * anywhere in the workflow — and re-render them for edits that cannot affect reachability.
 */
export interface WorkflowReferenceGraph {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  /**
   * Offer every block in the graph rather than only the referencing block's ancestors.
   *
   * The ancestor walk needs the referencing block to BE in the graph. A surface configuring a
   * block the graph does not contain yet — the fork sync modal reaching a block this sync is
   * about to add — would otherwise resolve to an empty ancestor set and suggest nothing at all.
   * Showing the whole workflow is the honest degradation: over-offering a reference the user
   * can see is wrong beats offering none.
   */
  unrestricted?: boolean
}

export interface WorkflowReferenceScope extends WorkflowReferenceGraph {
  /** Scopes workflow-level variables; `null` when no workflow is in scope. */
  workflowId: string | null
  /**
   * Unsaved sub-block edits layered over `blocks`, so a reference reflects what the user is
   * typing rather than what was last persisted. Empty off-canvas: nothing is being edited there.
   */
  subBlockValues: Record<string, Record<string, unknown>>
  variables: Variable[]
}

const WorkflowReferenceScopeContext = createContext<WorkflowReferenceScope | null>(null)

interface WorkflowReferenceScopeProviderProps {
  scope: WorkflowReferenceScope
  children: React.ReactNode
}

/**
 * Point every reference autocomplete inside at a workflow other than the one open in the
 * editor. Canvas surfaces mount no provider and keep reading the live stores.
 */
export function WorkflowReferenceScopeProvider({
  scope,
  children,
}: WorkflowReferenceScopeProviderProps) {
  return (
    <WorkflowReferenceScopeContext.Provider value={scope}>
      {children}
    </WorkflowReferenceScopeContext.Provider>
  )
}

/**
 * The graph a reference resolves against: a supplied scope's when one is provided, the live
 * editor's otherwise.
 *
 * The live read runs either way — hooks cannot be called conditionally — which costs nothing
 * off-canvas, where the workflow store holds no workflow and never updates. It subscribes to
 * exactly the workflow-store slice the canvas always did, and nothing else.
 */
export function useWorkflowReferenceGraph(): WorkflowReferenceGraph {
  const provided = useContext(WorkflowReferenceScopeContext)
  const live = useWorkflowStore(
    useShallow((state) => ({
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || EMPTY_LOOPS,
      parallels: state.parallels || EMPTY_PARALLELS,
    }))
  )
  return provided ?? live
}

/** The editor's own workflow-scoped values, straight from the live stores. */
function useLiveWorkflowValues(): Omit<WorkflowReferenceScope, keyof WorkflowReferenceGraph> {
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
  return { workflowId, subBlockValues, variables }
}

/**
 * The full scope, for surfaces that render the tag list itself (block outputs need live
 * sub-block values to type their fields; workflow variables are their own tag group).
 */
export function useWorkflowReferenceScope(): WorkflowReferenceScope {
  const provided = useContext(WorkflowReferenceScopeContext)
  const graph = useWorkflowReferenceGraph()
  const live = useLiveWorkflowValues()
  const values = provided ?? live
  return useMemo(
    () => ({
      ...graph,
      workflowId: values.workflowId,
      subBlockValues: values.subBlockValues,
      variables: values.variables,
    }),
    [graph, values.workflowId, values.subBlockValues, values.variables]
  )
}

/**
 * A scope for a workflow loaded outside the editor. `unrestricted` is derived rather than
 * asked for: it is exactly the case where the referencing block is absent from the graph, and
 * making the caller work that out invites getting it wrong.
 */
export function buildWorkflowReferenceScope(params: {
  workflowId: string | null
  blocks: Record<string, BlockState> | undefined
  edges: Edge[] | undefined
  loops?: Record<string, Loop>
  parallels?: Record<string, Parallel>
  variables?: Variable[]
  /** The block whose position filters the suggestions. */
  referencingBlockId?: string
}): WorkflowReferenceScope {
  const blocks = params.blocks ?? EMPTY_BLOCKS
  return {
    workflowId: params.workflowId,
    blocks,
    edges: params.edges ?? EMPTY_EDGES,
    loops: params.loops ?? EMPTY_LOOPS,
    parallels: params.parallels ?? EMPTY_PARALLELS,
    subBlockValues: EMPTY_SUBBLOCK_VALUES,
    variables: params.variables ?? EMPTY_VARIABLES,
    unrestricted: !params.referencingBlockId || !blocks[params.referencingBlockId],
  }
}
