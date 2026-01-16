import { KeyRound, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface AuthArgs {
  instruction: string
}

/**
 * Auth tool that spawns a subagent to handle authentication setup.
 * This tool auto-executes and the actual work is done by the auth subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class AuthClientTool extends BaseClientTool {
  static readonly id = 'auth'

  constructor(toolCallId: string) {
    super(toolCallId, AuthClientTool.id, AuthClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Authenticating', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Authenticating', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Authenticating', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Authenticated', icon: KeyRound },
      [ClientToolCallState.error]: { text: 'Failed to authenticate', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped auth', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted auth', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Authenticating',
        completedLabel: 'Authenticated',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the auth tool.
   * This just marks the tool as executing - the actual auth work is done server-side
   * by the auth subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: AuthArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(AuthClientTool.id, AuthClientTool.metadata.uiConfig!)
