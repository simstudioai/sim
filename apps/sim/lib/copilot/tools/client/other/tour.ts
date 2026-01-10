import { Compass, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface TourArgs {
  instruction: string
}

/**
 * Tour tool that spawns a subagent to guide the user.
 * This tool auto-executes and the actual work is done by the tour subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class TourClientTool extends BaseClientTool {
  static readonly id = 'tour'

  constructor(toolCallId: string) {
    super(toolCallId, TourClientTool.id, TourClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Touring', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Touring', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Touring', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Completed tour', icon: Compass },
      [ClientToolCallState.error]: { text: 'Failed tour', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped tour', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted tour', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Touring',
        completedLabel: 'Tour complete',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the tour tool.
   * This just marks the tool as executing - the actual tour work is done server-side
   * by the tour subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: TourArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(TourClientTool.id, TourClientTool.metadata.uiConfig!)
