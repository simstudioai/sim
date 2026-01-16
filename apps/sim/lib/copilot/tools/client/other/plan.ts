import { ListTodo, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface PlanArgs {
  request: string
}

/**
 * Plan tool that spawns a subagent to plan an approach.
 * This tool auto-executes and the actual work is done by the plan subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class PlanClientTool extends BaseClientTool {
  static readonly id = 'plan'

  constructor(toolCallId: string) {
    super(toolCallId, PlanClientTool.id, PlanClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Planning', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Planning', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Planning', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Planned', icon: ListTodo },
      [ClientToolCallState.error]: { text: 'Failed to plan', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped plan', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted plan', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Planning',
        completedLabel: 'Planned',
        shouldCollapse: true,
        outputArtifacts: ['plan'],
      },
    },
  }

  /**
   * Execute the plan tool.
   * This just marks the tool as executing - the actual planning work is done server-side
   * by the plan subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: PlanArgs): Promise<void> {
    // Immediately transition to executing state - no user confirmation needed
    this.setState(ClientToolCallState.executing)
    // The tool result will come from the server via tool_result event
    // when the plan subagent completes its work
  }
}

// Register UI config at module load
registerToolUIConfig(PlanClientTool.id, PlanClientTool.metadata.uiConfig!)
