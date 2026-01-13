import { FileText, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetPageContentsClientTool extends BaseClientTool {
  static readonly id = 'get_page_contents'

  constructor(toolCallId: string) {
    super(toolCallId, GetPageContentsClientTool.id, GetPageContentsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting page contents', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting page contents', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Getting page contents', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved page contents', icon: FileText },
      [ClientToolCallState.error]: { text: 'Failed to get page contents', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted getting page contents', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped getting page contents', icon: MinusCircle },
    },
    interrupt: undefined,
    getDynamicText: (params, state) => {
      if (params?.urls && Array.isArray(params.urls) && params.urls.length > 0) {
        const firstUrl = String(params.urls[0])
        const truncated = firstUrl.length > 40 ? `${firstUrl.slice(0, 40)}...` : firstUrl
        const count = params.urls.length

        switch (state) {
          case ClientToolCallState.success:
            return count > 1 ? `Retrieved ${count} pages` : `Retrieved ${truncated}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return count > 1 ? `Getting ${count} pages` : `Getting ${truncated}`
          case ClientToolCallState.error:
            return count > 1 ? `Failed to get ${count} pages` : `Failed to get ${truncated}`
          case ClientToolCallState.aborted:
            return count > 1 ? `Aborted getting ${count} pages` : `Aborted getting ${truncated}`
          case ClientToolCallState.rejected:
            return count > 1 ? `Skipped getting ${count} pages` : `Skipped getting ${truncated}`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
