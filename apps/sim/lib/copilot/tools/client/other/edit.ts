import { Loader2, Pencil, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

interface EditArgs {
  instruction: string
}

/**
 * Edit tool that spawns a subagent to apply code/workflow edits.
 * This tool auto-executes and the actual work is done by the edit subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class EditClientTool extends BaseClientTool {
  static readonly id = 'edit'

  constructor(toolCallId: string) {
    super(toolCallId, EditClientTool.id, EditClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Editing', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Editing', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Editing', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Edited', icon: Pencil },
      [ClientToolCallState.error]: { text: 'Failed to apply edit', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Edit skipped', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Edit aborted', icon: XCircle },
    },
  }

  /**
   * Execute the edit tool.
   * This just marks the tool as executing - the actual edit work is done server-side
   * by the edit subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: EditArgs): Promise<void> {
    // Immediately transition to executing state - no user confirmation needed
    this.setState(ClientToolCallState.executing)
    // The tool result will come from the server via tool_result event
    // when the edit subagent completes its work
  }
}
