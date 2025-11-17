import { Loader2, MinusCircle, Search, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetExamplesRagClientTool extends BaseClientTool {
  static readonly id = 'get_examples_rag'

  constructor(toolCallId: string) {
    super(toolCallId, GetExamplesRagClientTool.id, GetExamplesRagClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching examples', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching examples', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Fetching examples', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Fetched examples', icon: Search },
      [ClientToolCallState.error]: { text: 'Failed to fetch examples', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted getting examples', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped getting examples', icon: MinusCircle },
    },
    interrupt: undefined,
    getDynamicText: (params, state) => {
      if (params?.query && typeof params.query === 'string') {
        const query = params.query
        const truncated = query.length > 40 ? `${query.slice(0, 40)}...` : query
        
        switch (state) {
          case ClientToolCallState.success:
            return `Found examples for ${truncated}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Searching examples for ${truncated}`
          case ClientToolCallState.error:
            return `Failed to find examples for ${truncated}`
          case ClientToolCallState.aborted:
            return `Aborted searching examples for ${truncated}`
          case ClientToolCallState.rejected:
            return `Skipped searching examples for ${truncated}`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
