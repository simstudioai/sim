import { Compass, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

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
      [ClientToolCallState.success]: { text: 'Tour complete', icon: Compass },
      [ClientToolCallState.error]: { text: 'Tour failed', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Tour skipped', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Tour aborted', icon: XCircle },
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
