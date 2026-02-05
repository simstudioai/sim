import { ListFilter, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetTriggerBlocksClientTool extends BaseClientTool {
  static readonly id = 'get_trigger_blocks'

  constructor(toolCallId: string) {
    super(toolCallId, GetTriggerBlocksClientTool.id, GetTriggerBlocksClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Finding trigger blocks', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Finding trigger blocks', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Finding trigger blocks', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Found trigger blocks', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to find trigger blocks', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted finding trigger blocks', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped finding trigger blocks', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    // Tool execution is handled server-side by the orchestrator.
    // Client tool classes are retained for UI display configuration only.
    this.setState(ClientToolCallState.success)
  }
}
