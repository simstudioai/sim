import { Loader2, Rocket, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface DeployArgs {
  instruction: string
}

/**
 * Deploy tool that spawns a subagent to handle deployment.
 * This tool auto-executes and the actual work is done by the deploy subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class DeployClientTool extends BaseClientTool {
  static readonly id = 'deploy'

  constructor(toolCallId: string) {
    super(toolCallId, DeployClientTool.id, DeployClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Deploying', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Deploying', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Deploying', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Deployed', icon: Rocket },
      [ClientToolCallState.error]: { text: 'Failed to deploy', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped deploy', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted deploy', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Deploying',
        completedLabel: 'Deployed',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the deploy tool.
   * This just marks the tool as executing - the actual deploy work is done server-side
   * by the deploy subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: DeployArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(DeployClientTool.id, DeployClientTool.metadata.uiConfig!)
