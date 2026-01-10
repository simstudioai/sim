import { Bug, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface DebugArgs {
  error_description: string
  context?: string
}

/**
 * Debug tool that spawns a subagent to diagnose workflow issues.
 * This tool auto-executes and the actual work is done by the debug subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class DebugClientTool extends BaseClientTool {
  static readonly id = 'debug'

  constructor(toolCallId: string) {
    super(toolCallId, DebugClientTool.id, DebugClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Debugging', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Debugging', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Debugging', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Debugged', icon: Bug },
      [ClientToolCallState.error]: { text: 'Failed to debug', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped debug', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted debug', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Debugging',
        completedLabel: 'Debugged',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the debug tool.
   * This just marks the tool as executing - the actual debug work is done server-side
   * by the debug subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: DebugArgs): Promise<void> {
    // Immediately transition to executing state - no user confirmation needed
    this.setState(ClientToolCallState.executing)
    // The tool result will come from the server via tool_result event
    // when the debug subagent completes its work
  }
}

// Register UI config at module load
registerToolUIConfig(DebugClientTool.id, DebugClientTool.metadata.uiConfig!)
