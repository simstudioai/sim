import { BookOpen, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class SearchDocumentationClientTool extends BaseClientTool {
  static readonly id = 'search_documentation'

  constructor(toolCallId: string) {
    super(toolCallId, SearchDocumentationClientTool.id, SearchDocumentationClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Completed documentation search', icon: BookOpen },
      [ClientToolCallState.error]: { text: 'Failed to search docs', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted documentation search', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped documentation search', icon: MinusCircle },
    },
    getDynamicText: (params, state) => {
      if (params?.query && typeof params.query === 'string') {
        const query = params.query

        switch (state) {
          case ClientToolCallState.success:
            return `Searched docs for ${query}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Searching docs for ${query}`
          case ClientToolCallState.error:
            return `Failed to search docs for ${query}`
          case ClientToolCallState.aborted:
            return `Aborted searching docs for ${query}`
          case ClientToolCallState.rejected:
            return `Skipped searching docs for ${query}`
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
