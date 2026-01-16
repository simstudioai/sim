import { Loader2, Search, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface ResearchArgs {
  instruction: string
}

/**
 * Research tool that spawns a subagent to research information.
 * This tool auto-executes and the actual work is done by the research subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class ResearchClientTool extends BaseClientTool {
  static readonly id = 'research'

  constructor(toolCallId: string) {
    super(toolCallId, ResearchClientTool.id, ResearchClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Researching', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Researching', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Researching', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Researched', icon: Search },
      [ClientToolCallState.error]: { text: 'Failed to research', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped research', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted research', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Researching',
        completedLabel: 'Researched',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the research tool.
   * This just marks the tool as executing - the actual research work is done server-side
   * by the research subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: ResearchArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(ResearchClientTool.id, ResearchClientTool.metadata.uiConfig!)
