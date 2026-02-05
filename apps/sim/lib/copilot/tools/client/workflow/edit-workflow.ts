import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

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
  }

  async handleAccept(): Promise<void> {
    // Diff store calls this after review acceptance.
    this.setState(ClientToolCallState.success)
  }

  async execute(): Promise<void> {
    // Tool execution is handled server-side by the orchestrator.
    // The store's tool_result SSE handler applies the diff preview
    // via diffStore.setProposedChanges() when the result arrives.
    this.setState(ClientToolCallState.success)
  }
}

// Register UI config at module load
registerToolUIConfig(EditWorkflowClientTool.id, EditWorkflowClientTool.metadata.uiConfig!)
