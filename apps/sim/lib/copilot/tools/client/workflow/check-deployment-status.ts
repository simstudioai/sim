import { Loader2, Rocket, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class CheckDeploymentStatusClientTool extends BaseClientTool {
  static readonly id = 'check_deployment_status'

  constructor(toolCallId: string) {
    super(toolCallId, CheckDeploymentStatusClientTool.id, CheckDeploymentStatusClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Checking deployment status',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Checking deployment status', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Checking deployment status', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Checked deployment status', icon: Rocket },
      [ClientToolCallState.error]: { text: 'Failed to check deployment status', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted checking deployment status',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped checking deployment status',
        icon: XCircle,
      },
    },
    interrupt: undefined,
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
