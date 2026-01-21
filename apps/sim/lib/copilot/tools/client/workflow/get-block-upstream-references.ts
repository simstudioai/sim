import { createLogger } from '@sim/logger'
import { GitBranch, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  computeBlockOutputPaths,
  formatOutputsWithPrefix,
  getSubflowInsidePaths,
  getWorkflowSubBlockValues,
  getWorkflowVariables,
} from '@/lib/copilot/tools/client/workflow/block-output-utils'
import {
  GetBlockUpstreamReferencesResult,
  type GetBlockUpstreamReferencesResultType,
} from '@/lib/copilot/tools/shared/schemas'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'

const logger = createLogger('GetBlockUpstreamReferencesClientTool')

interface GetBlockUpstreamReferencesArgs {
  blockIds: string[]
}

export class GetBlockUpstreamReferencesClientTool extends BaseClientTool {
  static readonly id = 'get_block_upstream_references'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      GetBlockUpstreamReferencesClientTool.id,
      GetBlockUpstreamReferencesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting upstream references', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting upstream references', icon: GitBranch },
      [ClientToolCallState.executing]: { text: 'Getting upstream references', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted getting references', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved upstream references', icon: GitBranch },
      [ClientToolCallState.error]: { text: 'Failed to get references', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped getting references', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const blockIds = params?.blockIds
      if (blockIds && Array.isArray(blockIds) && blockIds.length > 0) {
        const count = blockIds.length
        switch (state) {
          case ClientToolCallState.success:
            return `Retrieved references for ${count} block${count > 1 ? 's' : ''}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Getting references for ${count} block${count > 1 ? 's' : ''}`
          case ClientToolCallState.error:
            return `Failed to get references for ${count} block${count > 1 ? 's' : ''}`
        }
      }
      return undefined
    },
  }

  async execute(args?: GetBlockUpstreamReferencesArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      if (!args?.blockIds || args.blockIds.length === 0) {
        await this.markToolComplete(400, 'blockIds array is required')
        this.setState(ClientToolCallState.error)
        return
      }

      const { activeWorkflowId } = useWorkflowRegistry.getState()
      if (!activeWorkflowId) {
        await this.markToolComplete(400, 'No active workflow found')
        this.setState(ClientToolCallState.error)
        return
      }

      const workflowStore = useWorkflowStore.getState()
      const blocks = workflowStore.blocks || {}
      const edges = workflowStore.edges || []
      const loops = workflowStore.loops || {}
      const parallels = workflowStore.parallels || {}
      const subBlockValues = getWorkflowSubBlockValues(activeWorkflowId)

      const ctx = { workflowId: activeWorkflowId, blocks, loops, parallels, subBlockValues }
      const variableOutputs = getWorkflowVariables(activeWorkflowId)
      const graphEdges = edges.map((edge) => ({ source: edge.source, target: edge.target }))

      const results: GetBlockUpstreamReferencesResultType['results'] = []

      for (const blockId of args.blockIds) {
        const targetBlock = blocks[blockId]
        if (!targetBlock) {
          logger.warn(`Block ${blockId} not found`)
          continue
        }

        const insideSubflows: { blockId: string; blockName: string; blockType: string }[] = []
        const containingLoopIds = new Set<string>()
        const containingParallelIds = new Set<string>()

        Object.values(loops as Record<string, Loop>).forEach((loop) => {
          if (loop?.nodes?.includes(blockId)) {
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
        })

        Object.values(parallels as Record<string, Parallel>).forEach((parallel) => {
          if (parallel?.nodes?.includes(blockId)) {
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
        })

        const ancestorIds = BlockPathCalculator.findAllPathNodes(graphEdges, blockId)
        const accessibleIds = new Set<string>(ancestorIds)
        accessibleIds.add(blockId)

        const starterBlock = Object.values(blocks).find((b) => isInputDefinitionTrigger(b.type))
        if (starterBlock && ancestorIds.includes(starterBlock.id)) {
          accessibleIds.add(starterBlock.id)
        }

        containingLoopIds.forEach((loopId) => {
          accessibleIds.add(loopId)
          loops[loopId]?.nodes?.forEach((nodeId) => accessibleIds.add(nodeId))
        })

        containingParallelIds.forEach((parallelId) => {
          accessibleIds.add(parallelId)
          parallels[parallelId]?.nodes?.forEach((nodeId) => accessibleIds.add(nodeId))
        })

        const accessibleBlocks: GetBlockUpstreamReferencesResultType['results'][0]['accessibleBlocks'] =
          []

        for (const accessibleBlockId of accessibleIds) {
          const block = blocks[accessibleBlockId]
          if (!block?.type) continue

          const canSelfReference = block.type === 'approval' || block.type === 'human_in_the_loop'
          if (accessibleBlockId === blockId && !canSelfReference) continue

          const blockName = block.name || block.type
          let accessContext: 'inside' | 'outside' | undefined
          let outputPaths: string[]

          if (block.type === 'loop' || block.type === 'parallel') {
            const isInside =
              (block.type === 'loop' && containingLoopIds.has(accessibleBlockId)) ||
              (block.type === 'parallel' && containingParallelIds.has(accessibleBlockId))

            accessContext = isInside ? 'inside' : 'outside'
            outputPaths = isInside
              ? getSubflowInsidePaths(block.type, accessibleBlockId, loops, parallels)
              : ['results']
          } else {
            outputPaths = computeBlockOutputPaths(block, ctx)
          }

          const formattedOutputs = formatOutputsWithPrefix(outputPaths, blockName)

          const entry: GetBlockUpstreamReferencesResultType['results'][0]['accessibleBlocks'][0] = {
            blockId: accessibleBlockId,
            blockName,
            blockType: block.type,
            outputs: formattedOutputs,
          }

          // Include triggerMode if the block is in trigger mode
          if (block.triggerMode) {
            entry.triggerMode = true
          }

          if (accessContext) entry.accessContext = accessContext
          accessibleBlocks.push(entry)
        }

        const resultEntry: GetBlockUpstreamReferencesResultType['results'][0] = {
          blockId,
          blockName: targetBlock.name || targetBlock.type,
          accessibleBlocks,
          variables: variableOutputs,
        }

        if (insideSubflows.length > 0) resultEntry.insideSubflows = insideSubflows
        results.push(resultEntry)
      }

      const result = GetBlockUpstreamReferencesResult.parse({ results })

      logger.info('Retrieved upstream references', {
        blockIds: args.blockIds,
        resultCount: results.length,
      })

      await this.markToolComplete(200, 'Retrieved upstream references', result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Error in tool execution', { toolCallId: this.toolCallId, error, message })
      await this.markToolComplete(500, message || 'Failed to get upstream references')
      this.setState(ClientToolCallState.error)
    }
  }
}
