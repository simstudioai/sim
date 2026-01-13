import { BookOpen, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class SearchLibraryDocsClientTool extends BaseClientTool {
  static readonly id = 'search_library_docs'

  constructor(toolCallId: string) {
    super(toolCallId, SearchLibraryDocsClientTool.id, SearchLibraryDocsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading docs', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading docs', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Reading docs', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read docs', icon: BookOpen },
      [ClientToolCallState.error]: { text: 'Failed to read docs', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted reading docs', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped reading docs', icon: MinusCircle },
    },
    getDynamicText: (params, state) => {
      const libraryName = params?.library_name
      if (libraryName && typeof libraryName === 'string') {
        switch (state) {
          case ClientToolCallState.success:
            return `Read ${libraryName} docs`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Reading ${libraryName} docs`
          case ClientToolCallState.error:
            return `Failed to read ${libraryName} docs`
          case ClientToolCallState.aborted:
            return `Aborted reading ${libraryName} docs`
          case ClientToolCallState.rejected:
            return `Skipped reading ${libraryName} docs`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
