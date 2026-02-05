import { ListFilter, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { getLatestBlock } from '@/blocks/registry'

export class GetBlockOptionsClientTool extends BaseClientTool {
  static readonly id = 'get_block_options'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlockOptionsClientTool.id, GetBlockOptionsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting block operations', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting block operations', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Getting block operations', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved block operations', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to get block operations', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted getting block operations', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped getting block operations',
        icon: MinusCircle,
      },
    },
    getDynamicText: (params, state) => {
      const blockId =
        (params as any)?.blockId ||
        (params as any)?.blockType ||
        (params as any)?.block_id ||
        (params as any)?.block_type
      if (typeof blockId === 'string') {
        const blockConfig = getLatestBlock(blockId)
        const blockName = (blockConfig?.name ?? blockId.replace(/_/g, ' ')).toLowerCase()

        switch (state) {
          case ClientToolCallState.success:
            return `Retrieved ${blockName} operations`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Retrieving ${blockName} operations`
          case ClientToolCallState.error:
            return `Failed to retrieve ${blockName} operations`
          case ClientToolCallState.aborted:
            return `Aborted retrieving ${blockName} operations`
          case ClientToolCallState.rejected:
            return `Skipped retrieving ${blockName} operations`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    // Tool execution is handled server-side by the orchestrator.
    // Client tool classes are retained for UI display configuration only.
    this.setState(ClientToolCallState.success)
  }
}
