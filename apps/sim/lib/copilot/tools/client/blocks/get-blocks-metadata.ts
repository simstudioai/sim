import { ListFilter, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetBlocksMetadataClientTool extends BaseClientTool {
  static readonly id = 'get_blocks_metadata'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlocksMetadataClientTool.id, GetBlocksMetadataClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching block choices', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching block choices', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching block choices', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Searched block choices', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to search block choices', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted searching block choices', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped searching block choices',
        icon: MinusCircle,
      },
    },
    getDynamicText: (params, state) => {
      if (params?.blockIds && Array.isArray(params.blockIds) && params.blockIds.length > 0) {
        const blockList = params.blockIds
          .slice(0, 3)
          .map((blockId) => blockId.replace(/_/g, ' '))
          .join(', ')
        const more = params.blockIds.length > 3 ? '...' : ''
        const blocks = `${blockList}${more}`

        switch (state) {
          case ClientToolCallState.success:
            return `Searched ${blocks}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Searching ${blocks}`
          case ClientToolCallState.error:
            return `Failed to search ${blocks}`
          case ClientToolCallState.aborted:
            return `Aborted searching ${blocks}`
          case ClientToolCallState.rejected:
            return `Skipped searching ${blocks}`
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
