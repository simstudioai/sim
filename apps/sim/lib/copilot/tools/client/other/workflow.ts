import { GitBranch, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface WorkflowArgs {
  instruction: string
}

/**
 * Workflow tool that spawns a subagent to manage workflows.
 * This tool auto-executes and the actual work is done by the workflow subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class WorkflowClientTool extends BaseClientTool {
  static readonly id = 'workflow'

  constructor(toolCallId: string) {
    super(toolCallId, WorkflowClientTool.id, WorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Managing workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Managing workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Managing workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed workflow', icon: GitBranch },
      [ClientToolCallState.error]: { text: 'Failed to manage workflow', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped workflow', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted workflow', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Managing workflow',
        completedLabel: 'Workflow managed',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the workflow tool.
   * This just marks the tool as executing - the actual workflow work is done server-side
   * by the workflow subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: WorkflowArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(WorkflowClientTool.id, WorkflowClientTool.metadata.uiConfig!)
