import { Loader2, Rocket, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class RedeployClientTool extends BaseClientTool {
  static readonly id = 'redeploy'

  constructor(toolCallId: string) {
    super(toolCallId, RedeployClientTool.id, RedeployClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Redeploying workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Redeploy workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Redeploying workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Redeployed workflow', icon: Rocket },
      [ClientToolCallState.error]: { text: 'Failed to redeploy workflow', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted redeploy', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped redeploy', icon: XCircle },
    },
    interrupt: undefined,
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
