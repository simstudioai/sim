import { Info, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface InfoArgs {
  instruction: string
}

/**
 * Info tool that spawns a subagent to retrieve information.
 * This tool auto-executes and the actual work is done by the info subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class InfoClientTool extends BaseClientTool {
  static readonly id = 'info'

  constructor(toolCallId: string) {
    super(toolCallId, InfoClientTool.id, InfoClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting info', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting info', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Getting info', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved info', icon: Info },
      [ClientToolCallState.error]: { text: 'Failed to get info', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped info', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted info', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Getting info',
        completedLabel: 'Info retrieved',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the info tool.
   * This just marks the tool as executing - the actual info work is done server-side
   * by the info subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: InfoArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(InfoClientTool.id, InfoClientTool.metadata.uiConfig!)
