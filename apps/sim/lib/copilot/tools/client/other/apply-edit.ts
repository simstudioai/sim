import { Loader2, Pencil, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

interface ApplyEditArgs {
  instruction: string
}

/**
 * Apply Edit tool that spawns a subagent to apply code/workflow edits.
 * This tool auto-executes and the actual work is done by the apply_edit subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class ApplyEditClientTool extends BaseClientTool {
  static readonly id = 'apply_edit'

  constructor(toolCallId: string) {
    super(toolCallId, ApplyEditClientTool.id, ApplyEditClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing edit', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Applying edit', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Applying edit', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Edit applied', icon: Pencil },
      [ClientToolCallState.error]: { text: 'Failed to apply edit', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Edit skipped', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Edit aborted', icon: XCircle },
    },
  }

  /**
   * Execute the apply_edit tool.
   * This just marks the tool as executing - the actual edit work is done server-side
   * by the apply_edit subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: ApplyEditArgs): Promise<void> {
    // Immediately transition to executing state - no user confirmation needed
    this.setState(ClientToolCallState.executing)
    // The tool result will come from the server via tool_result event
    // when the apply_edit subagent completes its work
  }
}

