import { Loader2, Wrench, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

interface CustomToolArgs {
  instruction: string
}

/**
 * Custom tool that spawns a subagent to manage custom tools.
 * This tool auto-executes and the actual work is done by the custom_tool subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class CustomToolClientTool extends BaseClientTool {
  static readonly id = 'custom_tool'

  constructor(toolCallId: string) {
    super(toolCallId, CustomToolClientTool.id, CustomToolClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Managing custom tool', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Managing custom tool', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Managing custom tool', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Custom tool managed', icon: Wrench },
      [ClientToolCallState.error]: { text: 'Custom tool failed', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Custom tool skipped', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Custom tool aborted', icon: XCircle },
    },
  }

  /**
   * Execute the custom_tool tool.
   * This just marks the tool as executing - the actual custom tool work is done server-side
   * by the custom_tool subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: CustomToolArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}
