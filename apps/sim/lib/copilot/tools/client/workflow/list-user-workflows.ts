import { ListChecks, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class ListUserWorkflowsClientTool extends BaseClientTool {
  static readonly id = 'list_user_workflows'

  constructor(toolCallId: string) {
    super(toolCallId, ListUserWorkflowsClientTool.id, ListUserWorkflowsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Listing your workflows', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Listing your workflows', icon: ListChecks },
      [ClientToolCallState.executing]: { text: 'Listing your workflows', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted listing workflows', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Listed your workflows', icon: ListChecks },
      [ClientToolCallState.error]: { text: 'Failed to list workflows', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped listing workflows', icon: XCircle },
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
