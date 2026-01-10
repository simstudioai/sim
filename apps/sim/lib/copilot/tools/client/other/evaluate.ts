import { ClipboardCheck, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface EvaluateArgs {
  instruction: string
}

/**
 * Evaluate tool that spawns a subagent to evaluate workflows or outputs.
 * This tool auto-executes and the actual work is done by the evaluate subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class EvaluateClientTool extends BaseClientTool {
  static readonly id = 'evaluate'

  constructor(toolCallId: string) {
    super(toolCallId, EvaluateClientTool.id, EvaluateClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Evaluating', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Evaluating', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Evaluating', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Evaluated', icon: ClipboardCheck },
      [ClientToolCallState.error]: { text: 'Failed to evaluate', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped evaluation', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted evaluation', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Evaluating',
        completedLabel: 'Evaluated',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the evaluate tool.
   * This just marks the tool as executing - the actual evaluation work is done server-side
   * by the evaluate subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: EvaluateArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(EvaluateClientTool.id, EvaluateClientTool.metadata.uiConfig!)
