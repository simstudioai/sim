import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { flattenWorkflowOutputs } from '@/lib/workflows/blocks/flatten-outputs'
import { scopeOutputBlockId } from '@/lib/workflows/streaming/output-selector'
import { normalizeName } from '@/executor/constants'

const WORKFLOW_BLOCK_TYPES = new Set(['workflow', 'workflow_input'])

export interface WorkflowOutputOption {
  id: string
  label: string
  blockId: string
  blockName: string
  blockType: string
  groupKey: string
  groupLabel: string
  path: string
  menuPath: WorkflowOutputMenuSegment[]
}

export interface WorkflowOutputMenuSegment {
  blockId: string
  blockName: string
  blockType: string
}

export interface WorkflowOutputMenuNode extends WorkflowOutputMenuSegment {
  outputs: WorkflowOutputOption[]
  children: WorkflowOutputMenuNode[]
}

type OutputWorkflowState = Pick<WorkflowState, 'blocks' | 'edges'>

function unwrapSubBlockValue(value: unknown): unknown {
  return value && typeof value === 'object' && 'value' in value
    ? (value as { value: unknown }).value
    : value
}

/** Resolves the active literal child workflow selected by a regular Workflow block. */
export function getWorkflowInvocationTarget(block: BlockState): string | undefined {
  if (!WORKFLOW_BLOCK_TYPES.has(block.type)) return undefined

  const basicValue = unwrapSubBlockValue(block.subBlocks.workflowId)
  const advancedValue = unwrapSubBlockValue(block.subBlocks.manualWorkflowId)
  const mode = block.data?.canonicalModes?.workflowId
  const selected =
    mode === 'advanced'
      ? advancedValue
      : mode === 'basic'
        ? basicValue
        : typeof basicValue === 'string' && basicValue
          ? basicValue
          : advancedValue

  return typeof selected === 'string' && selected.trim() ? selected.trim() : undefined
}

export function collectReferencedWorkflowIds(
  states: Iterable<OutputWorkflowState | null | undefined>
): string[] {
  const workflowIds = new Set<string>()
  for (const state of states) {
    if (!state) continue
    for (const block of Object.values(state.blocks)) {
      const workflowId = getWorkflowInvocationTarget(block)
      if (workflowId) workflowIds.add(workflowId)
    }
  }
  return [...workflowIds]
}

interface BuildWorkflowOutputOptionsInput {
  rootWorkflowId: string
  rootState: OutputWorkflowState
  workflowStates: ReadonlyMap<string, OutputWorkflowState | null>
  maxChildDepth: number
}

/** Builds selectable outputs across regular child-workflow invocation paths. */
export function buildWorkflowOutputOptions({
  rootWorkflowId,
  rootState,
  workflowStates,
  maxChildDepth,
}: BuildWorkflowOutputOptionsInput): WorkflowOutputOption[] {
  const options: WorkflowOutputOption[] = []

  const visit = (
    workflowId: string,
    state: OutputWorkflowState,
    invocationPath: WorkflowOutputMenuSegment[],
    childDepth: number,
    callChain: ReadonlySet<string>
  ): void => {
    const flattened = flattenWorkflowOutputs(Object.values(state.blocks), state.edges)
    for (const output of flattened) {
      const parentBlockId = invocationPath.at(-1)?.blockId
      const blockId = parentBlockId
        ? scopeOutputBlockId(parentBlockId, output.blockId)
        : output.blockId
      const displayBlockName = normalizeName(output.blockName || `block-${output.blockId}`)
      const invocationNames = invocationPath.map((segment) => segment.blockName)
      const groupLabel =
        invocationNames.length > 0
          ? `${invocationNames.join(' / ')} / ${output.blockName}`
          : output.blockName
      options.push({
        id: `${blockId}_${output.path}`,
        label: `${[...invocationNames.map(normalizeName), displayBlockName, output.path].join('.')}`,
        blockId,
        blockName: output.blockName,
        blockType: output.blockType,
        groupKey: blockId,
        groupLabel,
        path: output.path,
        menuPath: [
          ...invocationPath,
          {
            blockId,
            blockName: output.blockName,
            blockType: output.blockType,
          },
        ],
      })
    }

    if (childDepth >= maxChildDepth) return

    for (const block of Object.values(state.blocks)) {
      const childWorkflowId = getWorkflowInvocationTarget(block)
      if (!childWorkflowId || callChain.has(childWorkflowId)) continue
      const childState = workflowStates.get(childWorkflowId)
      if (!childState) continue
      const parentBlockId = invocationPath.at(-1)?.blockId
      const blockId = parentBlockId ? scopeOutputBlockId(parentBlockId, block.id) : block.id
      visit(
        childWorkflowId,
        childState,
        [
          ...invocationPath,
          {
            blockId,
            blockName: block.name,
            blockType: block.type,
          },
        ],
        childDepth + 1,
        new Set([...callChain, childWorkflowId])
      )
    }
  }

  visit(rootWorkflowId, rootState, [], 0, new Set([rootWorkflowId]))
  return options
}

export function buildWorkflowOutputMenu(
  options: readonly WorkflowOutputOption[]
): WorkflowOutputMenuNode[] {
  const roots: WorkflowOutputMenuNode[] = []

  for (const option of options) {
    let siblings = roots
    let node: WorkflowOutputMenuNode | undefined

    for (const segment of option.menuPath) {
      node = siblings.find((candidate) => candidate.blockId === segment.blockId)
      if (!node) {
        node = { ...segment, outputs: [], children: [] }
        siblings.push(node)
      }
      siblings = node.children
    }

    if (!node) {
      throw new Error(`Workflow output is missing its menu path: ${option.id}`)
    }
    node.outputs.push(option)
  }

  return roots
}
