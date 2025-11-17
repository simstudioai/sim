import { Loader2, MinusCircle, Search, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class SearchPatternsClientTool extends BaseClientTool {
  static readonly id = 'search_patterns'

  constructor(toolCallId: string) {
    super(toolCallId, SearchPatternsClientTool.id, SearchPatternsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching workflow patterns', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching workflow patterns', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching workflow patterns', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Found workflow patterns', icon: Search },
      [ClientToolCallState.error]: { text: 'Failed to search patterns', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted pattern search', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped pattern search', icon: MinusCircle },
    },
    interrupt: undefined,
    getDynamicText: (params, state) => {
      if (params?.queries && Array.isArray(params.queries) && params.queries.length > 0) {
        const firstQuery = String(params.queries[0])
        const truncated = firstQuery.length > 50 ? `${firstQuery.slice(0, 50)}...` : firstQuery
        
        switch (state) {
          case ClientToolCallState.success:
            return `Searched ${truncated}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Searching ${truncated}`
          case ClientToolCallState.error:
            return `Failed to search ${truncated}`
          case ClientToolCallState.aborted:
            return `Aborted searching ${truncated}`
          case ClientToolCallState.rejected:
            return `Skipped searching ${truncated}`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}

