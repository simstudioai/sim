import { Bug, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class SearchErrorsClientTool extends BaseClientTool {
  static readonly id = 'search_errors'

  constructor(toolCallId: string) {
    super(toolCallId, SearchErrorsClientTool.id, SearchErrorsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Debugging', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Debugging', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Debugging', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Debugged', icon: Bug },
      [ClientToolCallState.error]: { text: 'Failed to debug', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted debugging', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped debugging', icon: MinusCircle },
    },
    interrupt: undefined,
    getDynamicText: (params, state) => {
      if (params?.query && typeof params.query === 'string') {
        const query = params.query

        switch (state) {
          case ClientToolCallState.success:
            return `Debugged ${query}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Debugging ${query}`
          case ClientToolCallState.error:
            return `Failed to debug ${query}`
          case ClientToolCallState.aborted:
            return `Aborted debugging ${query}`
          case ClientToolCallState.rejected:
            return `Skipped debugging ${query}`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
