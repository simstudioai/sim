import { Globe, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class SearchOnlineClientTool extends BaseClientTool {
  static readonly id = 'search_online'

  constructor(toolCallId: string) {
    super(toolCallId, SearchOnlineClientTool.id, SearchOnlineClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Completed online search', icon: Globe },
      [ClientToolCallState.error]: { text: 'Failed to search online', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped online search', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted online search', icon: XCircle },
    },
    interrupt: undefined,
    getDynamicText: (params, state) => {
      if (params?.query && typeof params.query === 'string') {
        const query = params.query

        switch (state) {
          case ClientToolCallState.success:
            return `Searched online for ${query}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Searching online for ${query}`
          case ClientToolCallState.error:
            return `Failed to search online for ${query}`
          case ClientToolCallState.aborted:
            return `Aborted searching online for ${query}`
          case ClientToolCallState.rejected:
            return `Skipped searching online for ${query}`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
