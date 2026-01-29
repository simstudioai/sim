import { Loader2, Workflow as WorkflowIcon, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export class GetUserWorkflowClientTool extends BaseClientTool {
  static readonly id = 'get_user_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, GetUserWorkflowClientTool.id, GetUserWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Reading your workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading your workflow', icon: WorkflowIcon },
      [ClientToolCallState.executing]: { text: 'Reading your workflow', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted reading your workflow', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Read your workflow', icon: WorkflowIcon },
      [ClientToolCallState.error]: { text: 'Failed to read your workflow', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped reading your workflow', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
      if (workflowId) {
        const workflowName = useWorkflowRegistry.getState().workflows[workflowId]?.name
        if (workflowName) {
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
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
