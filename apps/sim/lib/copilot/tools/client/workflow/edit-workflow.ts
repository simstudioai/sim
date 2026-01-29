import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export class EditWorkflowClientTool extends BaseClientTool {
  static readonly id = 'edit_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, EditWorkflowClientTool.id, EditWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Editing your workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Editing your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Edited your workflow', icon: Grid2x2Check },
      [ClientToolCallState.error]: { text: 'Failed to edit your workflow', icon: XCircle },
      [ClientToolCallState.review]: { text: 'Review your workflow changes', icon: Grid2x2 },
      [ClientToolCallState.rejected]: { text: 'Rejected workflow changes', icon: Grid2x2X },
      [ClientToolCallState.aborted]: { text: 'Aborted editing your workflow', icon: MinusCircle },
      [ClientToolCallState.pending]: { text: 'Editing your workflow', icon: Loader2 },
    },
    uiConfig: {
      isSpecial: true,
      customRenderer: 'edit_summary',
    },
    getDynamicText: (params, state) => {
      const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
      if (workflowId) {
        const workflowName = useWorkflowRegistry.getState().workflows[workflowId]?.name
        if (workflowName) {
          switch (state) {
            case ClientToolCallState.success:
              return `Edited ${workflowName}`
            case ClientToolCallState.executing:
            case ClientToolCallState.generating:
            case ClientToolCallState.pending:
              return `Editing ${workflowName}`
            case ClientToolCallState.error:
              return `Failed to edit ${workflowName}`
            case ClientToolCallState.review:
              return `Review changes to ${workflowName}`
            case ClientToolCallState.rejected:
              return `Rejected changes to ${workflowName}`
            case ClientToolCallState.aborted:
              return `Aborted editing ${workflowName}`
          }
        }
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only for rendering tool call cards
  // The server applies workflow changes directly in headless mode
}

// Register UI config at module load
registerToolUIConfig(EditWorkflowClientTool.id, EditWorkflowClientTool.metadata.uiConfig!)
