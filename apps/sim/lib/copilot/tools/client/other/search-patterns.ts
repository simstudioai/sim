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
  }

  async execute(): Promise<void> {
    return
  }
}

