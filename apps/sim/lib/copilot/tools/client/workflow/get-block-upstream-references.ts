import { GitBranch, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

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

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
