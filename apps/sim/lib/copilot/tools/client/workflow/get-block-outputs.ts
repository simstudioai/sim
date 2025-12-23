import { Loader2, Tag, X, XCircle } from 'lucide-react'
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
  GetBlockOutputsResult,
  type GetBlockOutputsResultType,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { normalizeName } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('GetBlockOutputsClientTool')

interface GetBlockOutputsArgs {
  blockIds?: string[]
}

export class GetBlockOutputsClientTool extends BaseClientTool {
  static readonly id = 'get_block_outputs'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlockOutputsClientTool.id, GetBlockOutputsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting block outputs', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting block outputs', icon: Tag },
      [ClientToolCallState.executing]: { text: 'Getting block outputs', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted getting outputs', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved block outputs', icon: Tag },
      [ClientToolCallState.error]: { text: 'Failed to get outputs', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped getting outputs', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const blockIds = params?.blockIds
      if (blockIds && Array.isArray(blockIds) && blockIds.length > 0) {
        const count = blockIds.length
        switch (state) {
          case ClientToolCallState.success:
            return `Retrieved outputs for ${count} block${count > 1 ? 's' : ''}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Getting outputs for ${count} block${count > 1 ? 's' : ''}`
          case ClientToolCallState.error:
            return `Failed to get outputs for ${count} block${count > 1 ? 's' : ''}`
        }
      }
      return undefined
    },
  }

  async execute(args?: GetBlockOutputsArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      const { activeWorkflowId } = useWorkflowRegistry.getState()
      if (!activeWorkflowId) {
        await this.markToolComplete(400, 'No active workflow found')
        this.setState(ClientToolCallState.error)
        return
      }

      const workflowStore = useWorkflowStore.getState()
      const blocks = workflowStore.blocks || {}
      const loops = workflowStore.loops || {}
      const parallels = workflowStore.parallels || {}
      const subBlockValues = getWorkflowSubBlockValues(activeWorkflowId)

      const ctx = { workflowId: activeWorkflowId, blocks, loops, parallels, subBlockValues }
      const targetBlockIds =
        args?.blockIds && args.blockIds.length > 0 ? args.blockIds : Object.keys(blocks)

      const blockOutputs: GetBlockOutputsResultType['blocks'] = []

      for (const blockId of targetBlockIds) {
        const block = blocks[blockId]
        if (!block?.type) continue

        const blockName = block.name || block.type
        const normalizedBlockName = normalizeName(blockName)

        let insideSubflowOutputs: string[] | undefined
        let outsideSubflowOutputs: string[] | undefined

        if (block.type === 'loop' || block.type === 'parallel') {
          const insidePaths = getSubflowInsidePaths(block.type, blockId, loops, parallels)
          insideSubflowOutputs = formatOutputsWithPrefix(insidePaths, blockName)
          outsideSubflowOutputs = formatOutputsWithPrefix(['results'], blockName)
        }

        const outputPaths = computeBlockOutputPaths(block, ctx)
        const formattedOutputs = formatOutputsWithPrefix(outputPaths, blockName)

        const blockOutput: GetBlockOutputsResultType['blocks'][0] = {
          blockId,
          blockName,
          blockType: block.type,
          outputs: formattedOutputs,
        }

        if (insideSubflowOutputs) blockOutput.insideSubflowOutputs = insideSubflowOutputs
        if (outsideSubflowOutputs) blockOutput.outsideSubflowOutputs = outsideSubflowOutputs

        blockOutputs.push(blockOutput)
      }

      const variableOutputs = getWorkflowVariables(activeWorkflowId)

      const result = GetBlockOutputsResult.parse({
        blocks: blockOutputs,
        variables: variableOutputs,
      })

      logger.info('Retrieved block outputs', {
        blockCount: blockOutputs.length,
        variableCount: variableOutputs.length,
      })

      await this.markToolComplete(200, 'Retrieved block outputs', result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Error in tool execution', { toolCallId: this.toolCallId, error, message })
      await this.markToolComplete(500, message || 'Failed to get block outputs')
      this.setState(ClientToolCallState.error)
    }
  }
}
