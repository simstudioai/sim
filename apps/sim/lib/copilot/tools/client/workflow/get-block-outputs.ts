import { Loader2, Tag, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

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

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
