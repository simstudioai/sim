import { Loader2, Sparkles, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface SuperagentArgs {
  instruction: string
}

/**
 * Superagent tool that spawns a powerful subagent for complex tasks.
 * This tool auto-executes and the actual work is done by the superagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class SuperagentClientTool extends BaseClientTool {
  static readonly id = 'superagent'

  constructor(toolCallId: string) {
    super(toolCallId, SuperagentClientTool.id, SuperagentClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Superagent working', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Superagent working', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Superagent working', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Superagent completed', icon: Sparkles },
      [ClientToolCallState.error]: { text: 'Superagent failed', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Superagent skipped', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Superagent aborted', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Superagent working',
        completedLabel: 'Superagent completed',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the superagent tool.
   * This just marks the tool as executing - the actual work is done server-side
   * by the superagent, and its output is streamed as subagent events.
   */
  async execute(_args?: SuperagentArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(SuperagentClientTool.id, SuperagentClientTool.metadata.uiConfig!)
