import type { Principal } from '@sim/auth/principal'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import type { Loop, Parallel } from '@sim/workflow-types/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { getEffectiveBlockOutputPaths } from '@/lib/workflows/blocks/block-outputs'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import { getBlockReferenceTags } from '@/lib/workflows/blocks/block-reference-tags'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { resolveTriggerRunOptions, toPublicRunOption } from '@/lib/workflows/triggers/run-options'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { getBlock } from '@/blocks/registry'
import { normalizeName } from '@/executor/constants'

const MAX_COPILOT_BLOCK_IDS = 100

interface CopilotWorkflowQueryInput {
  workflowId: string
  assertedWorkspaceId?: string
}

interface WorkflowVariableReference {
  id: string
  name: string
  type: string
  tag: string
}

interface AccessibleBlockEntry {
  blockId: string
  blockName: string
  blockType: string
  outputs: string[]
  triggerMode?: boolean
  accessContext?: 'inside' | 'outside'
}

function resolveWorkflowContext<I extends CopilotWorkflowQueryInput>({
  principal,
  input,
}: {
  principal: Principal
  input: I
}) {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
}

async function loadDraftWorkflow(workflowId: string) {
  const state = await loadWorkflowFromNormalizedTables(workflowId)
  if (!state) throw new OrchestrationError('not_found', 'Workflow has no saved state')
  return state
}

function workflowVariables(value: unknown): WorkflowVariableReference[] {
  const variablesRecord = (value as Record<string, unknown>) || {}
  return Object.values(variablesRecord)
    .filter((variable): variable is Record<string, unknown> => {
      if (!variable || typeof variable !== 'object') return false
      const record = variable as Record<string, unknown>
      return Boolean(record.name && String(record.name).trim())
    })
    .map((variable) => ({
      id: String(variable.id || ''),
      name: String(variable.name || ''),
      type: String(variable.type || 'plain'),
      tag: `variable.${normalizeName(String(variable.name || ''))}`,
    }))
}

function subflowInsidePaths(
  blockType: 'loop' | 'parallel',
  blockId: string,
  loops: Record<string, Loop>,
  parallels: Record<string, Parallel>
): string[] {
  const paths = ['index']
  if (blockType === 'loop') {
    if ((loops[blockId]?.loopType || 'for') === 'forEach') paths.push('currentItem', 'items')
  } else if ((parallels[blockId]?.parallelType || 'count') === 'collection') {
    paths.push('currentItem', 'items')
  }
  return paths
}

function displayOutputs(paths: string[], blockName: string): string[] {
  const normalizedName = normalizeName(blockName)
  return paths.map((path) => `${normalizedName}.${path}`)
}

function assertBlockIdBound(blockIds: string[]): void {
  if (blockIds.length > MAX_COPILOT_BLOCK_IDS) {
    throw new OrchestrationError(
      'validation',
      `blockIds cannot contain more than ${MAX_COPILOT_BLOCK_IDS} entries`
    )
  }
}

export interface ReadCopilotWorkflowRunOptionsInput extends CopilotWorkflowQueryInput {}

export const readCopilotWorkflowRunOptions = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readCopilotRunOptions,
  resolveContext: resolveWorkflowContext<ReadCopilotWorkflowRunOptionsInput>,
  async execute({ context }) {
    const state = await loadDraftWorkflow(context.workflowId)
    const merged = mergeSubblockStateWithValues(state.blocks)
    const options = resolveTriggerRunOptions(merged, state.edges)
    return {
      options: options.map((option) => toPublicRunOption(option)),
    }
  },
})

export interface ReadCopilotWorkflowBlockOutputsInput extends CopilotWorkflowQueryInput {
  blockIds?: string[]
}

export const readCopilotWorkflowBlockOutputs = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readCopilotBlockOutputs,
  resolveContext: resolveWorkflowContext<ReadCopilotWorkflowBlockOutputsInput>,
  async execute({ input, context }) {
    if (input.blockIds) assertBlockIdBound(input.blockIds)
    const state = await loadDraftWorkflow(context.workflowId)
    const blocks = state.blocks || {}
    const loops = (state.loops || {}) as Record<string, Loop>
    const parallels = (state.parallels || {}) as Record<string, Parallel>
    const blockIds = input.blockIds?.length ? input.blockIds : Object.keys(blocks)
    assertBlockIdBound(blockIds)

    const results = []
    for (const blockId of blockIds) {
      const block = blocks[blockId]
      if (!block?.type) continue
      const blockName = block.name || block.type
      if (block.type === 'loop' || block.type === 'parallel') {
        const insidePaths = subflowInsidePaths(block.type, blockId, loops, parallels)
        results.push({
          blockId,
          blockName,
          blockType: block.type,
          outputs: [],
          relativeOutputs: [],
          insideSubflowOutputs: displayOutputs(insidePaths, blockName),
          outsideSubflowOutputs: displayOutputs(['results'], blockName),
          relativeInsideSubflowOutputs: insidePaths,
          relativeOutsideSubflowOutputs: ['results'],
          triggerMode: block.triggerMode,
        })
        continue
      }

      const blockConfig = getBlock(block.type)
      const triggerMode = Boolean(
        block.triggerMode && blockConfig && hasTriggerCapability(blockConfig)
      )
      const outputs = getEffectiveBlockOutputPaths(block.type, block.subBlocks, {
        triggerMode,
        preferToolOutputs: !triggerMode,
      })
      results.push({
        blockId,
        blockName,
        blockType: block.type,
        outputs: displayOutputs(outputs, blockName),
        relativeOutputs: outputs,
        triggerMode: block.triggerMode,
      })
    }

    return { blocks: results, variables: workflowVariables(context.workflow.variables) }
  },
})

export interface ReadCopilotWorkflowUpstreamReferencesInput extends CopilotWorkflowQueryInput {
  blockIds: string[]
}

export const readCopilotWorkflowUpstreamReferences = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readCopilotUpstreamReferences,
  resolveContext: resolveWorkflowContext<ReadCopilotWorkflowUpstreamReferencesInput>,
  async execute({ input, context }) {
    assertBlockIdBound(input.blockIds)
    const state = await loadDraftWorkflow(context.workflowId)
    const blocks = state.blocks || {}
    const loops = (state.loops || {}) as Record<string, Loop>
    const parallels = (state.parallels || {}) as Record<string, Parallel>
    const graphEdges = (state.edges || []).map((edge) => ({
      source: edge.source,
      target: edge.target,
    }))
    const variables = workflowVariables(context.workflow.variables)
    const results = []

    for (const blockId of input.blockIds) {
      const targetBlock = blocks[blockId]
      if (!targetBlock) continue

      const insideSubflows: Array<{ blockId: string; blockName: string; blockType: string }> = []
      const containingLoopIds = new Set<string>()
      const containingParallelIds = new Set<string>()

      for (const loop of Object.values(loops)) {
        if (!loop?.nodes?.includes(blockId)) continue
        containingLoopIds.add(loop.id)
        const loopBlock = blocks[loop.id]
        if (loopBlock) {
          insideSubflows.push({
            blockId: loop.id,
            blockName: loopBlock.name || loopBlock.type,
            blockType: 'loop',
          })
        }
      }

      for (const parallel of Object.values(parallels)) {
        if (!parallel?.nodes?.includes(blockId)) continue
        containingParallelIds.add(parallel.id)
        const parallelBlock = blocks[parallel.id]
        if (parallelBlock) {
          insideSubflows.push({
            blockId: parallel.id,
            blockName: parallelBlock.name || parallelBlock.type,
            blockType: 'parallel',
          })
        }
      }

      const accessibleIds = new Set(BlockPathCalculator.findAllPathNodes(graphEdges, blockId))
      accessibleIds.add(blockId)
      for (const loopId of containingLoopIds) accessibleIds.add(loopId)
      for (const parallelId of containingParallelIds) accessibleIds.add(parallelId)

      const accessibleBlocks: AccessibleBlockEntry[] = []
      for (const accessibleBlockId of accessibleIds) {
        const block = blocks[accessibleBlockId]
        if (!block?.type) continue
        const canSelfReference = block.type === 'approval' || block.type === 'human_in_the_loop'
        if (accessibleBlockId === blockId && !canSelfReference) continue

        const blockName = block.name || block.type
        let accessContext: 'inside' | 'outside' | undefined
        let outputs: string[]
        if (block.type === 'loop' || block.type === 'parallel') {
          const isInside =
            (block.type === 'loop' && containingLoopIds.has(accessibleBlockId)) ||
            (block.type === 'parallel' && containingParallelIds.has(accessibleBlockId))
          accessContext = isInside ? 'inside' : 'outside'
          outputs = displayOutputs(
            isInside
              ? subflowInsidePaths(block.type, accessibleBlockId, loops, parallels)
              : ['results'],
            blockName
          )
        } else {
          outputs = getBlockReferenceTags({
            block: {
              id: accessibleBlockId,
              type: block.type,
              name: block.name,
              triggerMode: block.triggerMode,
              subBlocks: block.subBlocks,
            },
            currentBlockId: blockId,
          })
        }
        accessibleBlocks.push({
          blockId: accessibleBlockId,
          blockName,
          blockType: block.type,
          outputs,
          ...(block.triggerMode ? { triggerMode: true } : {}),
          ...(accessContext ? { accessContext } : {}),
        })
      }

      results.push({
        blockId,
        blockName: targetBlock.name || targetBlock.type,
        blockType: targetBlock.type,
        accessibleBlocks,
        insideSubflows,
        variables,
      })
    }

    return { results }
  },
})
