import { Key, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetCredentialsClientTool extends BaseClientTool {
  static readonly id = 'get_credentials'

  constructor(toolCallId: string) {
    super(toolCallId, GetCredentialsClientTool.id, GetCredentialsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching connected integrations', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching connected integrations', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Fetching connected integrations', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Fetched connected integrations', icon: Key },
      [ClientToolCallState.error]: {
        text: 'Failed to fetch connected integrations',
        icon: XCircle,
      },
      [ClientToolCallState.aborted]: {
        text: 'Aborted fetching connected integrations',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped fetching connected integrations',
        icon: MinusCircle,
      },
    },
  }

  async execute(): Promise<void> {
    // Tool execution is handled server-side by the orchestrator.
    // Client tool classes are retained for UI display configuration only.
    this.setState(ClientToolCallState.success)
  }
}
