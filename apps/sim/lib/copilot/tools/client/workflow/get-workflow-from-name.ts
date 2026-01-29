import { FileText, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetWorkflowFromNameClientTool extends BaseClientTool {
  static readonly id = 'get_workflow_from_name'

  constructor(toolCallId: string) {
    super(toolCallId, GetWorkflowFromNameClientTool.id, GetWorkflowFromNameClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading workflow', icon: FileText },
      [ClientToolCallState.executing]: { text: 'Reading workflow', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted reading workflow', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Read workflow', icon: FileText },
      [ClientToolCallState.error]: { text: 'Failed to read workflow', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped reading workflow', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      if (params?.workflow_name && typeof params.workflow_name === 'string') {
        const workflowName = params.workflow_name

        switch (state) {
          case ClientToolCallState.success:
            return `Read ${workflowName}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Reading ${workflowName}`
          case ClientToolCallState.error:
            return `Failed to read ${workflowName}`
          case ClientToolCallState.aborted:
            return `Aborted reading ${workflowName}`
          case ClientToolCallState.rejected:
            return `Skipped reading ${workflowName}`
        }
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
